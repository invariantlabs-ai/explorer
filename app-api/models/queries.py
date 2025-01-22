import datetime
import json
import re
import uuid

import sqlalchemy.sql.sqltypes as sqltypes
from fastapi import HTTPException
from models.datasets_and_traces import (
    Annotation,
    Dataset,
    SavedQueries,
    SharedLinks,
    Trace,
    User,
)
from models.importers import import_jsonl
from sqlalchemy import and_
from sqlalchemy.dialects.sqlite import insert as sqlite_upsert
from sqlalchemy.sql import func
from sqlalchemy.sql.expression import cast
from util.config import config
from util.util import get_gravatar_hash, truncate_trace_content

import asyncio

def load_trace(
    session, by, user_id, allow_shared=False, allow_public=False, return_user=False
):
    try:
        by = uuid.UUID(str(by))
    except ValueError:
        raise HTTPException(status_code=404, detail="Trace not a valid UUID")
    query_filter = get_query_filter(by, Trace, User)
    if return_user:
        # join on user_id to get real user name
        result = (
            session.query(Trace, User)
            .filter(query_filter)
            .join(User, User.id == Trace.user_id)
            .first()
        )
        if result is None:
            raise HTTPException(status_code=404, detail="Trace not found")
        else:
            trace, user = result
    else:
        trace = session.query(Trace).filter(query_filter).first()
    if trace is None:
        raise HTTPException(status_code=404, detail="Trace not found")

    dataset = session.query(Dataset).filter(Dataset.id == trace.dataset_id).first()

    if not (
        str(trace.user_id) == str(user_id)  # correct user
        or (allow_shared and has_link_sharing(session, trace.id))  # in sharing mode
        or (
            dataset is not None and allow_public and dataset.is_public
        )  # public dataset
    ):
        raise HTTPException(status_code=401, detail="Unauthorized get")

    # store in session that this is authenticated
    trace.authenticated = True

    if return_user:
        return trace, user
    else:
        return trace


# TODO: Fix typo in the function name
def load_annoations(session, by):
    query_filter = get_query_filter(by, Annotation, User, default_key="trace_id")
    return (
        session.query(Annotation, User)
        .filter(query_filter)
        .join(User, User.id == Annotation.user_id)
        .all()
    )


def get_query_filter(by, main_object, *other_objects, default_key="id"):
    if not isinstance(by, dict):
        by = {default_key: by}
    objects = {o.__objectname__: o for o in [main_object, *other_objects]}
    query_filter = []
    for k, v in by.items():
        if "." in k:
            object_name, field = k.split(".")
            object = objects[object_name]
        else:
            field = k
            object = main_object
        query_filter.append(getattr(object, field) == v)
    return and_(*query_filter)


def load_dataset(session, by, user_id, allow_public=False, return_user=False):
    query_filter = get_query_filter(by, Dataset, User)

    # join on user_id to get real user name
    result = (
        session.query(Dataset, User)
        .filter(query_filter)
        .join(User, User.id == Dataset.user_id)
        .first()
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    dataset, user = result

    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if not (allow_public and dataset.is_public or str(dataset.user_id) == str(user_id)):
        raise HTTPException(status_code=401, detail="Unauthorized get")
    # If the dataset is public but the requestor is not the owner, remove the policies from the dataset response.
    if dataset.is_public and str(dataset.user_id) != str(user_id):
        dataset.extra_metadata.pop("policies", None)
    if return_user:
        return dataset, user
    else:
        return dataset


# returns the collections of a dataset
def get_savedqueries(session, dataset: Dataset, user_id, num_traces: int):
    # get number of traces with at least one annotation
    num_annotated, _, _ = query_traces(session, dataset, "is:annotated", count=True)
    queries = [
        {
            "id": "all",
            "name": "All",
            "count": num_traces,
            "query": None,
            "deletable": False,
        },
        {
            "id": "annotated",
            "name": "Annotated",
            "count": num_annotated,
            "query": "is:annotated",
            "deletable": False,
        },
        {
            "id": "unannotated",
            "name": "Unannotated",
            "count": num_traces - num_annotated,
            "query": "not:annotated",
            "deletable": False,
        },
    ]

    savedqueries = (
        session.query(SavedQueries)
        .filter(SavedQueries.user_id == user_id)
        .filter(SavedQueries.dataset_id == dataset.id)
        .all()
    )
    for query in savedqueries:
        count, _, _ = query_traces(session, dataset, query.query, count=True)
        queries.append(
            {
                "id": query.id,
                "name": query.name,
                "count": count,
                "query": query.query,
                "deletable": True,
            }
        )

    return queries


def has_link_sharing(session, trace_id):
    try:
        trace = (
            session.query(SharedLinks).filter(SharedLinks.trace_id == trace_id).first()
        )
        return trace is not None
    except Exception:
        return False


def save_user(session, userinfo):
    user = {
        "id": userinfo["sub"],
        "username": userinfo["preferred_username"],
        "image_url_hash": get_gravatar_hash(userinfo["email"]),
    }
    stmt = sqlite_upsert(User).values([user])
    stmt = stmt.on_conflict_do_update(
        index_elements=[User.id], set_={k: user[k] for k in user if k != "id"}
    )
    result = session.execute(stmt)

    # Check if this was an insert (new user) rather than an update
    if result.rowcount > 0:
        sample_data = []
        with open("assets/sample_data.jsonl", "r") as f:
            for line in f:
                sample_data.append(json.loads(line))
        for data in sample_data:
            if "annotations" in data:
                for ann in data["annotations"]:
                    ann["user"] = user
        sample_jsonl = [json.dumps(item) + "\n" for item in sample_data]

        # Create metadata for the dataset
        metadata = {
            "created_on": str(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
            "topic": "question-answering",
        }

        # Create the dataset
        dataset = Dataset(
            id=uuid.uuid4(),
            user_id=user["id"],
            name="Welcome-to-Explorer",
            extra_metadata=metadata,
        )
        session.add(dataset)

        # Import the sample traces
        loop = asyncio.get_event_loop()

        loop.run_until_complete(import_jsonl(
            session,
            "Welcome-to-Explorer",
            user["id"],
            sample_jsonl,
            existing_dataset=dataset,
        ))


def trace_to_json(trace, annotations=None, user=None, max_length=None):
    if max_length is None:
        max_length = config("server_truncation_limit")
    out = {
        "id": trace.id,
        "index": trace.index,
        "messages": truncate_trace_content(trace.content, max_length),
        "dataset": trace.dataset_id,
        "user_id": trace.user_id,
        "name": trace.name,
        "hierarchy_path": trace.hierarchy_path,
        **({"user": user} if user is not None else {}),
        "extra_metadata": trace.extra_metadata,
        "time_created": trace.time_created,
    }
    if annotations is not None:
        out["annotations"] = [
            annotation_to_json(annotation, user=user)
            for annotation, user in annotations
        ]
    return out


def annotation_to_json(annotation, user=None, **kwargs):
    out = {
        "id": annotation.id,
        "trace_id": annotation.trace_id,
        "content": annotation.content,
        "address": annotation.address,
        "time_created": annotation.time_created,
        "extra_metadata": annotation.extra_metadata,
    }
    out = {**out, **kwargs}
    if user is not None:
        out["user"] = user_to_json(user)
    return out


###
# Custom JSON serialization for exporting data out of the database (exclude internal IDs and user information)
###


def trace_to_exported_json(trace, annotations=None, user=None):
    out = {
        "index": trace.index,
        "messages": trace.content,
        "metadata": trace.extra_metadata,
    }
    if annotations is not None:
        out["annotations"] = [
            annotation_to_exported_json(annotation, user=user)
            for annotation, user in annotations
        ]
    return out


def annotation_to_exported_json(annotation, user=None, **kwargs):
    out = {
        "content": annotation.content,
        "address": annotation.address,
        "extra_metadata": annotation.extra_metadata,
    }
    out = {**out, **kwargs}
    return out


def user_to_json(user):
    return {
        "id": user.id,
        "username": user.username,
        "image_url_hash": user.image_url_hash,
    }


def dataset_to_json(dataset, user=None, **kwargs):
    out = {
        "id": dataset.id,
        "name": dataset.name,
        "extra_metadata": dataset.extra_metadata,
        "is_public": dataset.is_public,
        "user_id": dataset.user_id,
    }
    out = {**out, **kwargs}
    if user:
        out["user"] = user_to_json(user)
    return out


def query_traces(session, dataset, query, count=False):
    filter_pattern = re.compile(r"(is|not|meta):([^:\s]+)")
    meta_filter_pattern = re.compile(r"([^\s><=\:]+)(<|>|<=|>=|=|==|%)([^\s><=]+)")
    selected_traces = session.query(Trace).filter(Trace.dataset_id == dataset.id)
    search_term = None

    if query is not None and len(query.strip()) > 0:
        try:
            search_terms = []
            filters = []
            for term in query.split(" "):
                if match := filter_pattern.match(term):
                    filters.append(match)
                else:
                    search_terms.append(term)

            if len(search_terms) > 0:
                search_term = " ".join(search_terms)
                selected_traces = selected_traces.filter(
                    func.lower(cast(Trace.content, sqltypes.String)).contains(
                        search_term.lower()
                    )
                )

            for filter in filters:
                filter_type, filter_term = filter.group(1), filter.group(2)
                if filter_type == "is" and filter_term == "annotated":
                    selected_traces = (
                        selected_traces.join(
                            Annotation, Trace.id == Annotation.trace_id
                        )
                        .group_by(Trace.id)
                        .having(func.count(Annotation.id) > 0)
                    )
                elif filter_type == "no" and filter_term == "annotated":
                    selected_traces = (
                        selected_traces.outerjoin(
                            Annotation, Trace.id == Annotation.trace_id
                        )
                        .group_by(Trace.id)
                        .having(func.count(Annotation.id) == 0)
                    )
                elif (
                    match := meta_filter_pattern.match(filter_term)
                ) and filter_type == "meta":
                    # we are in the setting where the user wants to filter by metadata

                    # parse the filter we got
                    lhs, op, rhs = match.group(1), match.group(2), match.group(3)

                    # discover the type of the rhs
                    rhs_type = "str"
                    if op != "%":
                        try:
                            rhs = float(rhs)
                            rhs_type = "float"
                        except:
                            pass
                        try:
                            rhs = int(rhs)
                            rhs_type = "int"
                        except:
                            pass

                    if rhs_type == "str":
                        rhs = str(rhs)

                    # retrieve the lhs from the metadata
                    # and based on the type of rhs also cast the lhs
                    try:
                        type_cast = {
                            "int": "as_integer",
                            "float": "as_float",
                            "str": "as_string",
                        }[rhs_type]
                        lhs = Trace.extra_metadata[lhs]
                        lhs = getattr(lhs, type_cast)()
                    except Exception as e:
                        raise Exception("can not fetch filter LHS from metadata") from e

                    # execute the operator
                    if op == "==" or op == "=":
                        criteria = lhs == rhs
                    elif op == ">":
                        criteria = lhs > rhs
                    elif op == "<":
                        criteria = lhs < rhs
                    elif op == ">=":
                        criteria = lhs >= rhs
                    elif op == "<=":
                        criteria = lhs <= rhs
                    elif op == "%":  # contains/fuzzy search
                        criteria = func.lower(lhs).contains(rhs.lower())
                    else:
                        raise Exception("Invalid operator")

                    # apply the filter
                    # if we have multiple filters, we want to apply them all (i.e. AND)
                    selected_traces = selected_traces.filter(criteria)
                else:
                    raise Exception("Invalid filter")
        except Exception as e:
            print(
                f"Error in query: >{query}<", e
            )  # we still want these searches to go through

    out = selected_traces.count() if count else selected_traces.all()
    return out, search_term, filters


def search_term_mappings(trace, search_term):
    mappings = dict()

    def traverse(o, term, path=""):
        if isinstance(o, dict):
            for key in o.keys():
                traverse(o[key], term, path=path + f".{key}")
        elif isinstance(o, list):
            for i in range(len(o)):
                traverse(o[i], term, path=path + f".{i}")
        else:
            s = str(o).lower()
            if term in s:
                begin = 0
                while True:
                    start = s.find(term, begin)
                    if start == -1:
                        break
                    end = start + len(term)
                    mappings[f"{path}:{start}-{end}"] = {
                        "content": term,
                        "source": "search",
                    }
                    begin = end

    if search_term is not None:
        term = search_term.lower()
        content_object = trace.content
        traverse(content_object, term, path="messages")
    return mappings
