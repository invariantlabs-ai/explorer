import asyncio
import base64
import datetime
import json
import re
import uuid
from typing import Any, List
from uuid import UUID, uuid4

import aiofiles
import sqlalchemy.sql.sqltypes as sqltypes
from fastapi import HTTPException, Request
from models.analyzer_model import Annotation as AnalyzerAnnotation
from models.analyzer_model import InputSample as AnalyzerInputSample
from models.analyzer_model import Sample as AnalyzerSample
from models.datasets_and_traces import (
    Annotation,
    Dataset,
    DatasetJob,
    SavedQueries,
    SharedLinks,
    Trace,
    User,
)
from models.importers import import_jsonl
from pydantic import BaseModel
from sqlalchemy import and_
from sqlalchemy.dialects.sqlite import insert as sqlite_upsert
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from sqlalchemy.sql.expression import cast
from util.config import config
from util.util import get_gravatar_hash, truncate_trace_content


class ExportConfig(BaseModel):
    # whether to include trace IDs in the export trace JSON
    include_trace_ids: bool = False
    only_annotated: bool = False
    include_trace_metadata: bool = True
    include_annotations: bool = True

    @staticmethod
    def from_request(request: Request) -> "ExportConfig":
        include_trace_ids = (
            request.query_params.get("include_trace_ids", "false") == "true"
        )
        only_annotated = request.query_params.get("only_annotated", "false") == "true"

        return ExportConfig(
            include_trace_ids=include_trace_ids, only_annotated=only_annotated
        )


class DBJSONEncoder(json.JSONEncoder):
    """
    JSON encoder that can handle UUIDs and datetime objects.
    """

    def default(self, obj):
        if isinstance(obj, uuid.UUID):
            return str(obj)
        if isinstance(obj, datetime.datetime):
            return obj.isoformat()
        return json.JSONEncoder.default(self, obj)


class AnalyzerTraceExporter:
    def __init__(self, user_id: str, dataset_id: str, dataset_name: str | None = None):
        self.user_id = user_id
        self.dataset_id = dataset_id
        self.dataset_name = dataset_name

    @classmethod
    def is_annotation_for_analyzer(cls, content: str) -> bool:
        return bool(re.search(r"\[.*\]", content)) or "@Invariant" in content

    @classmethod
    def get_content_severity(cls, content: str) -> tuple[str, float]:
        match = re.search(
            r"severity=([0-1](?:\.\d+)?)", content
        )  # Matches severity values from 0 to 1
        if match:
            severity = float(match.group(1))
            content = re.sub(r",?\s*severity=[0-1](?:\.\d+)?", "", content).strip()
            return content, severity
        return content, None  # Return original string with severity=None if not found

    async def get_traces_by_ids(
        self, session: Session, trace_ids: list[str]
    ) -> list[Any]:
        """
        Fetch raw traces by their IDs for policy generation.

        Args:
            session (Session): The database session
            trace_ids (list[str]): List of trace IDs to fetch

        Returns:
            list[Any]: List of trace contents in OpenAI message format
        """
        if not trace_ids:
            return []

        # Convert string IDs to UUID objects
        uuid_ids = [UUID(id) for id in trace_ids]

        # Query traces by their IDs
        traces = (
            session.query(Trace)
            .filter(Trace.id.in_(uuid_ids))
            .filter(Trace.dataset_id == self.dataset_id)
            .all()
        )

        # Extract and format trace content
        trace_contents = []
        for trace in traces:
            try:
                # Assuming trace.content contains the trace data in a format
                # that can be converted to policy generation input
                trace_contents.append(trace.content)
            except Exception as e:
                import traceback

                print(
                    f"Error extracting trace content: {e}",
                    traceback.format_exc(),
                    flush=True,
                )

        return trace_contents

    async def analyzer_model_input(
        self, session: Session, input_trace_id: UUID | None = None
    ) -> tuple[list[AnalyzerInputSample], list[AnalyzerSample]]:
        """
        Retrieves trace data and annotations for the analyzer model input.

        Args:
            session (Session): The database session used for querying.
            input_trace_id (UUID | None): The ID of a specific trace to fetch.
                - If None, includes all traces in the input samples and only annotated traces in the context samples.
                - If provided, includes only the specified trace as a single-element list in the input samples, with all annotated traces in the context.

        Returns:
            tuple[list[AnalyzerInputSample], list[AnalyzerSample]]:
                - A list of `AnalyzerInputSample` representing the input traces.
                - A list of `AnalyzerSample` representing the annotated traces (context).
        """
        try:
            results = (
                session.query(Trace, Annotation)
                .outerjoin(
                    Annotation,
                    (Trace.id == Annotation.trace_id)
                    & (Annotation.user_id == self.user_id),
                )
                .filter(Trace.dataset_id == self.dataset_id)
                .all()
            )
            # Group the results by trace
            samples_by_id: dict[str, AnalyzerSample] = {}
            push_ds_name = self.dataset_name if self.dataset_name else "unknown_dataset"

            for row in results:
                trace, annotation = row.tuple()
                samples_by_id.setdefault(
                    str(trace.id),
                    AnalyzerSample(
                        trace=json.dumps(trace.content),
                        id=str(trace.id),
                        annotations=[],
                        domain=[push_ds_name] + trace.hierarchy_path + [str(trace.id)],
                    ),
                )
                if not annotation:
                    continue
                if annotation.extra_metadata and (
                    annotation.extra_metadata.get("source") == "analyzer-model"
                    or annotation.extra_metadata.get("source")
                    == "accepted-analyzer-model"
                ):
                    if (
                        annotation.extra_metadata.get("status") != "accepted"
                        and annotation.extra_metadata.get("status") != "rejected"
                    ):
                        continue

                if not AnalyzerTraceExporter.is_annotation_for_analyzer(
                    annotation.content
                ):
                    continue
                content, severity = AnalyzerTraceExporter.get_content_severity(
                    annotation.content
                )
                status = "user-annotated"
                if (
                    annotation.extra_metadata
                    and annotation.extra_metadata.get("status") == "rejected"
                ):
                    status = "user-rejected"
                elif (
                    annotation.extra_metadata
                    and annotation.extra_metadata.get("status") == "accepted"
                ):
                    status = "user-accepted"

                # check for existing duplicates
                samples_by_id[str(trace.id)].annotations.append(
                    AnalyzerAnnotation(
                        content=content,
                        location=annotation.address,
                        severity=severity,
                        status=status,
                    )
                )

            if input_trace_id:
                if str(input_trace_id) not in samples_by_id:
                    raise HTTPException(
                        status_code=404, detail="Trace not found within dataset"
                    )
                analyser_input_samples = [
                    AnalyzerInputSample(
                        trace=samples_by_id[str(input_trace_id)].trace,
                        id=str(input_trace_id),
                        domain=samples_by_id[str(input_trace_id)].domain,
                    )
                ]
            else:
                analyser_input_samples = [
                    AnalyzerInputSample(
                        trace=sample.trace, id=sample.id, domain=sample.domain
                    )
                    for sample in samples_by_id.values()
                ]

            # only send context with annotated samples
            analyser_context_samples = [
                sample for sample in samples_by_id.values() if sample.annotations
            ]
        except Exception as e:
            import traceback

            print("Error handling job", e, traceback.format_exc(), flush=True)
        return analyser_input_samples, analyser_context_samples


class TraceExporter:
    def __init__(self, user_id: str, dataset_id: str, export_config: ExportConfig):
        self.user_id = user_id
        self.dataset_id = dataset_id
        self.export_config = export_config

    async def prepare(self, session: Session):
        dataset, user = load_dataset(
            session,
            {"id": self.dataset_id},
            self.user_id,
            allow_public=True,
            return_user=True,
        )
        dataset_info = dataset_to_json(dataset)
        dataset_metadata = {
            "metadata": {**dataset_info["extra_metadata"]},
        }

        async def trace_generator():
            if self.export_config.include_trace_metadata:
                # write out metadata message
                yield json.dumps(dataset_metadata) + "\n"

            if self.export_config.only_annotated:
                traces = (
                    session.query(Trace)
                    .filter(Trace.dataset_id == self.dataset_id)
                    .join(Annotation, Trace.id == Annotation.trace_id)
                    .group_by(Trace.id)
                    .having(func.count(Annotation.id) > 0)
                    .order_by(Trace.index)
                    .all()
                )
            else:
                traces = (
                    session.query(Trace)
                    .filter(Trace.dataset_id == self.dataset_id)
                    .order_by(Trace.index)
                    .all()
                )

            # write out traces
            for trace in traces:
                # load annotations for this trace
                annotations = (
                    load_annotations(session, trace.id)
                    if self.export_config.include_annotations
                    else None
                )
                json_dict = await trace_to_exported_json(
                    trace, annotations, self.export_config
                )
                yield json.dumps(json_dict, cls=DBJSONEncoder) + "\n"

                # NOTE: if this operation becomes blocking, we can use asyncio.sleep(0) to yield control back to the event loop

        return user, dataset_info, trace_generator

    async def traces(self, session: Session):
        """
        Async generator that yields JSON strings for each trace in the dataset according to the export configuration.
        """
        _, _, trace_generator = await self.prepare(session)

        async for trace in trace_generator():
            yield trace

    async def stream(self, session: Session):
        """
        Streaming FastAPI response that streams JSON lines for each trace in the dataset according to the export configuration.
        """
        from fastapi.responses import StreamingResponse

        _, dataset_info, trace_generator = await self.prepare(session)

        return StreamingResponse(
            trace_generator(),
            media_type="application/json",
            headers={
                "Content-Disposition": 'attachment; filename="'
                + dataset_info["name"]
                + '.jsonl"'
            },
        )


def load_trace(
    session: Session,
    by: UUID | str,
    user_id: UUID,
    allow_shared: bool = False,
    allow_public: bool = False,
    return_user: bool = False,
):
    if not isinstance(by, UUID):
        try:
            by = UUID(str(by))
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
            trace, user = result.tuple()
    else:
        trace = session.query(Trace).filter(query_filter).first()
    if trace is None:
        raise HTTPException(status_code=404, detail="Trace not found")

    dataset = session.query(Dataset).filter(Dataset.id == trace.dataset_id).first()
    if not (
        trace.user_id == user_id  # correct user
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


def load_jobs(
    session: Session, dataset_id: UUID, user_id: UUID, return_user: bool = False
) -> List[DatasetJob]:
    query_filter = get_query_filter(
        {"dataset_id": dataset_id, "user_id": user_id}, DatasetJob
    )
    if return_user:
        result = (
            session.query(DatasetJob, User)
            .filter(query_filter)
            .join(User, User.id == DatasetJob.user_id)
            .all()
        )
    else:
        result = session.query(DatasetJob).filter(query_filter).all()

    return result


def get_all_jobs(session: Session, user_id: UUID = None) -> List[DatasetJob]:
    if user_id is not None:
        # Only return jobs owned by the specified user
        result = session.query(DatasetJob).filter(DatasetJob.user_id == user_id).all()
    else:
        # Return all jobs (should only be used by admin operations)
        result = session.query(DatasetJob).all()
    return result


def load_annotations(session: Session, by):
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


def load_dataset(
    session: Session, by: dict, user_id: UUID, allow_public=False, return_user=False
):
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
    dataset, user = result.tuple()

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


def has_link_sharing(session: Session, trace_id: UUID):
    try:
        trace = (
            session.query(SharedLinks).filter(SharedLinks.trace_id == trace_id).first()
        )
        return trace is not None
    except Exception:
        return False


def save_user(session, userinfo):
    print(userinfo, flush=True)
    user = {
        "id": userinfo["sub"],
        "username": userinfo.get("username", userinfo.get("preferred_username")),
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
            id=uuid4(),
            user_id=user["id"],
            name="Welcome-to-Explorer",
            extra_metadata=metadata,
        )
        session.add(dataset)

        asyncio.run(
            import_jsonl(
                session,
                "Welcome-to-Explorer",
                user["id"],
                sample_jsonl,
                existing_dataset=dataset,
            )
        )


def trace_to_json(trace, annotations=None, user=None, max_length=None):
    if max_length is None:
        max_length = config("server_truncation_limit")
    if "uploader" in trace.extra_metadata:
        trace.extra_metadata.pop("uploader")
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
        "time_last_pushed": trace.time_last_pushed,
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


async def convert_local_image_link_to_base64(image_link, use_data_prefix=False):
    """Given an image link of the format: `local_img_link: /path/to/image.png` or `/path/to/image.png`,
    find the image from the local path and convert it to base64.
    """
    image_path = image_link
    if image_link.startswith("local_img_link:"):
        image_path = image_link.split(":")[1].strip()
    try:
        async with aiofiles.open(image_path, "rb") as image_file:
            file_content = await image_file.read()
            base64_image = base64.b64encode(file_content).decode("utf-8")
        if not use_data_prefix:
            return "local_base64_img: " + base64_image
        return f"data:image/png;base64,{base64_image}"
    except FileNotFoundError:
        print(f"Image not found at path: {image_path}")
        return None


async def images_to_base64(trace):
    """Converts local image links in the trace content to base64 encoded strings in place."""
    if "uploader" in trace.extra_metadata:
        trace.extra_metadata.pop("uploader")

    image_tasks = []

    for i, message in enumerate(trace.content):
        # Either the message content is a string and starts with "local_img_link"
        if (
            isinstance(message, dict)
            and "content" in message
            and isinstance(message.get("content"), str)
            and message.get("content").startswith("local_img_link")
        ):
            image_tasks.append(
                (convert_local_image_link_to_base64(message.get("content")), i)
            )
        # Or the message content is a list of content objects, and one of them is
        # an image_url type object with a local image link
        elif (
            isinstance(message, dict)
            and "content" in message
            and isinstance(message.get("content"), list)
        ):
            for j, content in enumerate(message.get("content")):
                if (
                    isinstance(content, dict)
                    and content.get("type") == "image_url"
                    and isinstance(content.get("image_url"), dict)
                    and content.get("image_url").get("url", "")
                    # Check if the image URL is a local image link
                    # Some older images are stored as base64 strings, so we skip those here
                    and not content.get("image_url")
                    .get("url")
                    .startswith("data:image/")
                ):
                    image_tasks.append(
                        (
                            convert_local_image_link_to_base64(
                                content.get("image_url").get("url"),
                                use_data_prefix=True,
                            ),
                            i,
                            j,
                        )
                    )

    images = await asyncio.gather(*[task[0] for task in image_tasks])

    for i, image in enumerate(images):
        if image is not None:
            message_index = image_tasks[i][1]
            if len(image_tasks[i]) == 2:
                trace.content[message_index]["content"] = image
            elif len(image_tasks[i]) == 3:
                content_index = image_tasks[i][2]
                trace.content[message_index]["content"][content_index]["image_url"][
                    "url"
                ] = image


async def trace_to_exported_json(trace, annotations=None, config: ExportConfig = None):
    # Convert local image links to base64 encoded strings
    await images_to_base64(trace)

    out = {
        "index": trace.index,
        "messages": trace.content,
        "metadata": trace.extra_metadata,
    }

    if config is not None and config.include_trace_ids:
        out["id"] = trace.id

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


def user_to_json(user: User):
    return {
        "id": user.id,
        "username": user.username,
        "image_url_hash": user.image_url_hash,
    }


def dataset_to_json(dataset, user=None, include_metadata=True, **kwargs):
    out = {
        "id": dataset.id,
        "name": dataset.name,
        **({"extra_metadata": dataset.extra_metadata} if include_metadata else {}),
        "is_public": dataset.is_public,
        "user_id": dataset.user_id,
        "time_created": dataset.time_created,
        "latest_trace_time": dataset.time_last_pushed,
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
                        except Exception:
                            pass
                        try:
                            rhs = int(rhs)
                            rhs_type = "int"
                        except Exception:
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
