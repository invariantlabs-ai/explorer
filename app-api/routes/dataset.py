"""Defines routes for APIs related to dataset."""

import copy
import datetime
import json
import re
import uuid
from typing import Annotated
from enum import Enum
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from models.datasets_and_traces import (
    Annotation,
    Dataset,
    DatasetPolicy,
    SavedQueries,
    SharedLinks,
    Trace,
    User,
    db,
)
from models.importers import import_jsonl
from models.queries import (
    dataset_to_json,
    get_savedqueries,
    load_annoations,
    load_dataset,
    load_trace,
    query_traces,
    search_term_mappings,
    trace_to_exported_json,
    trace_to_json,
)
from pydantic import ValidationError
from routes.apikeys import APIIdentity, UserOrAPIIdentity
from routes.auth import AuthenticatedUserIdentity, UserIdentity
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.sql import func, exists
from util.util import validate_dataset_name
from uuid import UUID
import os

homepage_dataset_ids = json.load(open("homepage_datasets.json"))
homepage_dataset_ids = homepage_dataset_ids["DEV"] if os.getenv("DEV_MODE") == "true" else homepage_dataset_ids["PROD"]

# dataset routes
dataset = FastAPI()

def is_duplicate(user_id, name) -> bool:
    """Check if a dataset with the same name already exists."""
    with Session(db()) as session:
        dataset = (
            session.query(Dataset)
            .filter(and_(Dataset.user_id == user_id, Dataset.name == name))
            .first()
        )
        if dataset is not None:
            return True
    return False

def handle_dataset_creation_integrity_error(error: IntegrityError):
    """Handle integrity error for dataset creation."""
    if "_user_id_name_uc" in str(error.orig):
        raise HTTPException(
            status_code=400, detail="Dataset with the same name already exists"
        ) from error
    raise HTTPException(
        status_code=400, detail="An integrity error occurred"
    ) from error

def str_to_bool(key: str, value: str) -> bool:
    """Convert a string to a boolean."""
    if isinstance(value, bool):  # If already a boolean, return as is
        return value
    value_lower = value.lower()
    if value_lower == "true":
        return True
    if value_lower == "false":
        return False
    raise HTTPException(
        status_code=400,
        detail=f"{key} must be a string representing a boolean like 'true' or 'false'"
    )

@dataset.post("/create")
async def create(
    request: Request, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]
):
    """Create a dataset."""
    user_id = userinfo["sub"]
    if user_id is None:
        raise HTTPException(
            status_code=401, detail="Must be authenticated to create a dataset"
        )

    data = await request.json()
    name = data.get("name")
    if name is None:
        raise HTTPException(status_code=400, detail="name must be provided")
    if not isinstance(name, str):
        raise HTTPException(status_code=400, detail="name must be a string")
    validate_dataset_name(name)

    metadata = data.get("metadata", dict())
    if not isinstance(metadata, dict):
        raise HTTPException(status_code=400, detail="metadata must be a dictionary")
    metadata["created_on"] = str(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    is_public = data.get("is_public", False)
    if not isinstance(is_public, bool):
        raise HTTPException(status_code=400, detail="is_public must be a boolean")

    with Session(db()) as session:
        dataset = Dataset(
            id=uuid.uuid4(),
            user_id=user_id,
            name=name,
            is_public=is_public,
            extra_metadata=metadata,
        )
        dataset.extra_metadata = metadata
        session.add(dataset)
        try:
            session.commit()
        except IntegrityError as e:
            session.rollback()
            handle_dataset_creation_integrity_error(e)
        return dataset_to_json(dataset)

@dataset.post("/upload")
async def upload_file(
    request: Request,
    userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)],
    file: UploadFile = File(...),
):
    """Create a dataset via file upload."""
    # get name and is_public from the form
    form = await request.form()
    name = form.get("name")
    # is_public is a string because of Multipart request, convert to boolean
    is_public = str_to_bool("is_public", form.get("is_public", "false"))
    
    user_id = userinfo["sub"]
    if user_id is None:
        raise HTTPException(
            status_code=401, detail="Must be authenticated to upload a dataset"
        )
    validate_dataset_name(name)

    # Fail eagerly if a dataset with the same name already exists with some traces
    existing_dataset = None
    with Session(db()) as session:
        existing_dataset = (
            session.query(Dataset)
            .filter(and_(Dataset.user_id == user_id, Dataset.name == name))
            .first()
        )
        if existing_dataset is not None:
            trace_count = (
                session.query(Trace).filter(Trace.dataset_id == existing_dataset.id).count()
            )
            if trace_count > 0:
                raise HTTPException(
                    status_code=400,
                    detail="Dataset with the same name already exists with traces, to add new traces use the push API",
                )

    with Session(db()) as session:
        lines = file.file.readlines()
        dataset = import_jsonl(
            session,
            name,
            user_id,
            lines,
            existing_dataset=existing_dataset,
            is_public=is_public,
        )
        session.commit()
        return dataset_to_json(dataset)

########################################
# list all datasets, but without their traces
########################################

class DatasetKind(Enum):
    PRIVATE = "private"
    PUBLIC = "public"
    HOMEPAGE = "homepage"
    ANY = "any"


@dataset.get("/list")
def list_datasets(kind: DatasetKind, user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)], limit: int | None = None):
    with Session(db()) as session:
        query = session.query(Dataset, User)\
            .join(User, User.id == Dataset.user_id)
        if kind == DatasetKind.PRIVATE:
            query = query.filter(Dataset.user_id == user_id)
        elif kind == DatasetKind.PUBLIC:
            query = query.filter(Dataset.is_public)
        elif kind == DatasetKind.HOMEPAGE:
            query = query.filter(and_(Dataset.is_public,Dataset.id.in_(homepage_dataset_ids)))
        elif kind == DatasetKind.ANY:
            query = query.filter(or_(Dataset.is_public,Dataset.user_id == user_id))

        datasets = query.order_by(Dataset.time_created.desc())\
            .limit(limit)\
            .all()
        return [dataset_to_json(dataset, user) for dataset, user in datasets]

@dataset.get("/list/byuser/{user_name}")
def list_datasets_by_user(request: Request, user_name: str, user: Annotated[dict, Depends(UserIdentity)]):
    with Session(db()) as session:
        user_exists = session.query(exists().where(User.username == user_name)).scalar()
        if not user_exists:
            raise HTTPException(status_code=404, detail="User not found")
        datasets = session.query(Dataset, User).join(User, User.id == Dataset.user_id).filter(and_(User.username == user_name, Dataset.is_public)).all()
        return [dataset_to_json(dataset, user) for dataset, user in datasets]
    
########################################
# delete dataset
########################################

def delete_dataset(by: dict, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    user_id = userinfo["sub"]
    
    with Session(db()) as session:
        dataset = load_dataset(session, by, user_id)
        
        # delete all traces
        traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).all()

        # delete all annotations
        session.query(Annotation).filter(Annotation.trace_id.in_([trace.id for trace in traces])).delete()
        # delete all shared links
        session.query(SharedLinks).filter(SharedLinks.trace_id.in_([trace.id for trace in traces])).delete()
        # delete all traces
        session.query(Trace).filter(Trace.dataset_id == dataset.id).delete()

        # delete dataset
        session.delete(dataset)
        
        session.commit()
        
        return {"message": "Deleted"}
    
@dataset.delete("/byid/{id}")
def delete_dataset_by_id(request: Request, id: str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    return delete_dataset({"id": id}, userinfo)

@dataset.delete("/byuser/{username}/{dataset_name}")
def delete_dataset_by_name(request: Request, username:str, dataset_name:str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    return delete_dataset({'User.username': username, 'name': dataset_name}, userinfo)

########################################
# gets details on a dataset (including collections, but without traces)
########################################

def get_dataset(by: dict, user_id: UUID | None) -> dict:
    # may be None in case of anonymous users/public datasets or traces
    
    with Session(db()) as session:
        dataset, user = load_dataset(session, by, user_id, allow_public=True, return_user=True)
        # count all traces
        num_traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).count()
        return dataset_to_json(dataset, user,
                               num_traces=num_traces,
                               queries=get_savedqueries(session, dataset, user_id, num_traces))


@dataset.get("/byid/{id}")
def get_dataset_by_id(request: Request, id: str, user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)]):
    return get_dataset({"id": id}, user_id=user_id)

@dataset.get("/byuser/{username}/{dataset_name}")
def get_dataset_by_name(request: Request, username: str, dataset_name:str, user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)]):
    return get_dataset({'User.username': username, 'name': dataset_name}, user_id=user_id)

########################################
# search
########################################

@dataset.get("/byuser/{username}/{dataset_name}/s")
def search_dataset_by_name(request: Request, username:str, dataset_name:str, userinfo: Annotated[dict, Depends(UserIdentity)], query:str = None):
    user_id = userinfo['sub']
    with Session(db()) as session:
        by = {'User.username': username, 'name': dataset_name}
        dataset, _ = load_dataset(session, by, user_id, allow_public=True, return_user=True)

        mappings = {} 
        result = {}
        result['Other Traces'] = {'traces': [],
                                  'description': 'Traces without Analyzer results',
                                  'severity': 0}

        if query.strip() == 'is:invariant': 
            pattern = re.compile(r"[a-zA-Z]+\((.*)\)")
            traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).all()
            for trace in traces:
                annotations = load_annoations(session, trace.id)
                trace_with_match = False
                for annotation, _ in annotations:
                    # TODO replace with actual parsing
                    if annotation.content.startswith('Invariant analyzer result'):
                        violations = annotation.content[len('Invariant analyzer result: '):].strip()
                        for line in violations.split('\n'):
                            line = line.strip()
                            if match := pattern.match(line):
                                trace_with_match = True
                                title = match.group(1).split(',')[0]
                                if title not in result: result[title] = {'traces': []}
                                result[title]['traces'].append(trace.index)
                if not trace_with_match:
                    result['Other Traces']['traces'].append(trace.index)
        elif query.strip().startswith("filter"):
            # e.g. query=filter:some message:16,21,25,26,35
            filter_query = query.strip()[len("filter:"):].strip()
            filter_message, indices = filter_query.split(":")
            indices = [int(i) for i in indices.split(",")]
            result["Filtered Traces"] = {
                "traces": indices,
                "description": filter_message
            }
        else:
            selected_traces, search_term, filter_terms = query_traces(session, dataset, query)
            for trace in selected_traces:
                mappings[trace.index] = search_term_mappings(trace, search_term)
                
            result[query] = {}
            result[query]['traces'] = list(sorted([trace.index for trace in selected_traces]))
            has_search_term = search_term is not None and len(search_term) > 0 
            has_filter = len(filter_terms) > 0
            if has_search_term and has_filter:
                result[query]['description'] = 'filtered search result'
            elif has_search_term:
                result[query]['description'] = 'search result'
            elif has_filter:
                result[query]['description'] = 'filtered result'

        return {'result': result, 'mappings': mappings}
    
@dataset.put("/byuser/{username}/{dataset_name}/s")
async def save_query(request: Request, username:str, dataset_name:str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    user_id = userinfo['sub']
    with Session(db()) as session:
        by = {'User.username': username, 'name': dataset_name}
        dataset, _ = load_dataset(session, by, user_id, allow_public=True, return_user=True)
        data = await request.json()
        savedquery = SavedQueries(user_id=user_id,
                                  dataset_id=dataset.id,
                                  query=data['query'],
                                  name=data['name'])
        session.add(savedquery)
        session.commit()

@dataset.delete("/query/{query_id}")
async def delete_query(request: Request, query_id:str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    user_id = userinfo['sub']
    with Session(db()) as session:
        query = session.query(SavedQueries).filter(SavedQueries.id == query_id).first()
        
        if str(query.user_id) != user_id:
            raise HTTPException(status_code=403, detail="Not allowed to delete query")
      
        session.delete(query)  
        session.commit()


########################################
# update the dataset, currently only allows to change the visibility
########################################

async def update_dataset(request: Request, by: dict, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    # never None, 'userinfo' is authenticated
    user_id = userinfo["sub"]
  
    with Session(db()) as session:
        dataset, user = load_dataset(session, by, user_id, return_user=True)
        payload = await request.json()
        is_public = bool(payload.get("content"))
        dataset.is_public = is_public        
        session.commit()
        
        # count all traces
        num_traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).count()
        return dataset_to_json(dataset, num_traces=num_traces,
                               queries=get_savedqueries(session, dataset, user_id, num_traces))

@dataset.put("/byid/{id}")
async def update_dataset_by_id(request: Request, id: str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    return await update_dataset(request, {'id': id}, userinfo)

@dataset.put("/byuser/{username}/{dataset_name}")
async def update_dataset_by_name(request: Request, username:str, dataset_name:str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    return await update_dataset(request, {'User.username': username, 'name': dataset_name}, userinfo)

########################################
# get all traces of a dataset 
########################################

"""
Get all traces corresponding to a given filtering parameter 'by'.

Only returns the traces, if the provided user has access to corresponding dataset.

Parameters:
- by: dictionary of filtering parameters
- user_id: user identity information, None for non authenticated users
- indices: list of trace indices to filter by (optional)
"""
def get_traces(request: Request, by: dict, user_id: UUID | None, indices: list[int] = None):
    # extra query parameter to filter by index
    limit = request.query_params.get("limit")
    offset = request.query_params.get("offset")

    # users can be anonymous, so user_id can be None
    
    with Session(db()) as session:
        dataset, user = load_dataset(session, by, user_id, allow_public=True, return_user=True)
        
        traces = session.query(Trace).filter(Trace.dataset_id == dataset.id)

        # if indices are provided, filter by them (match on column 'index')
        if indices is not None:
            traces = traces.filter(Trace.index.in_(indices))
                
        # with join, count number of annotations per trace
        traces = traces\
            .outerjoin(Annotation, Trace.id == Annotation.trace_id)\
            .group_by(Trace.id)\
            .add_columns(Trace.name, Trace.hierarchy_path, Trace.id, Trace.index, Trace.extra_metadata, func.count(Annotation.id).label("num_annotations"))
        
        if limit is not None:
            traces = traces.limit(int(limit))
        if offset is not None:
            traces = traces.offset(int(offset))

        # order by index
        traces = traces.order_by(Trace.index)
        
        traces = traces.all()
        
        return [{
            "id": trace.id,
            "index": trace.index,
            "messages": [],
            "num_annotations": trace.num_annotations,
            "extra_metadata": trace.extra_metadata,
            "name": trace.name,
            "hierarchy_path": trace.hierarchy_path,
        } for trace in traces]


@dataset.get("/byid/{id}/traces")
def get_traces_by_id(request: Request, id: str, user_id: Annotated[UUID | None, Depends(UserIdentity)]):
    return get_traces(request, {'id': id}, user_id=user_id)

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

"""
Used to stream out the trace data as JSONL to download the dataset.
"""
async def stream_jsonl(session, dataset_id: str, dataset_info: dict, user_id: str):
    # write out metadata message
    yield json.dumps(dataset_info) + "\n"

    traces = session.query(Trace).filter(Trace.dataset_id == dataset_id).order_by(Trace.index).all()
    for trace in traces:
        # load annotations for this trace
        annotations = load_annoations(session, trace.id)
        json_dict = trace_to_exported_json(trace, annotations)
        yield json.dumps(json_dict, cls=DBJSONEncoder) + "\n"

        # NOTE: if this operation becomes blocking, we can use asyncio.sleep(0) to yield control back to the event loop


"""
Download the dataset in JSONL format.
"""
@dataset.get("/byid/{id}/download")
async def get_traces_by_id(request: Request, id: str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    with Session(db()) as session:
        dataset, user = load_dataset(session, {'id': id}, userinfo['sub'], allow_public=True, 
        return_user=True)
        internal_dataset_info = dataset_to_json(dataset)
        dataset_info = {
            "metadata": {**internal_dataset_info["extra_metadata"]},
        }

        # streaming response, but triggers a download
        return StreamingResponse(stream_jsonl(session, id, dataset_info, userinfo['sub']), media_type='application/json', headers={'Content-Disposition': 'attachment; filename="' + internal_dataset_info['name'] + '.jsonl"'})


@dataset.get("/byuser/{username}/{dataset_name}/traces")
def get_traces_by_name(request: Request, username:str, dataset_name:str, user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)]):
    indices = request.query_params.get("indices")
    indices = [int(i) for i in indices.split(",")] if indices is not None else None
    return get_traces(request, {'User.username': username, 'name': dataset_name}, user_id=user_id, indices=indices)

# lightweight version of /traces above that only returns the indices+ids (saving performance on the full join and prevents loading all columns of the traces table)
@dataset.get("/byuser/{username}/{dataset_name}/indices")
def get_trace_indices_by_name(request: Request, username:str, dataset_name:str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    with Session(db()) as session:
        user_id = userinfo['sub']
        dataset, user = load_dataset(session, {'User.username': username, 'name': dataset_name}, user_id, allow_public=True, return_user=True)
        # traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).order_by(Trace.index).offset(offset).limit(limit)
        # only select the index
        trace_rows = session.query(Trace.index, Trace.id, Trace.name, Trace.hierarchy_path).filter(Trace.dataset_id == dataset.id).order_by(Trace.index).all()
        return [{'index': row[0], 'id': row[1], 'name': row[2], 'messages': [], "hierarchy_path": row[3]} for row in trace_rows]

@dataset.get("/byuser/{username}/{dataset_name}/full")
def get_traces_by_name(request: Request, username:str, dataset_name:str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    return get_all_traces({'User.username': username, 'name': dataset_name}, userinfo)


########################################
# get the full dataset with all traces and annotations
########################################

def get_all_traces(by: dict,  user: Annotated[dict, Depends(UserIdentity)]):
    with Session(db()) as session:
        dataset, user = load_dataset(session, by, user['sub'], allow_public=True, return_user=True)
        
        out = dataset_to_json(dataset) 
        out['traces'] = []

        traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).all()
        for trace in traces:
            annotations = load_annoations(session, trace.id)
            out['traces'].append(trace_to_json(trace, annotations))
        return out

@dataset.post("/{dataset_id}/policy")
async def create_policy(
    request: Request,
    dataset_id: str,
    userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]
):
    """Creates a new policy for a dataset."""
    user_id = userinfo["sub"]

    with Session(db()) as session:
        dataset = load_dataset(session, dataset_id, user_id, allow_public=True, return_user=False)
        # Only the owner of the dataset can create a policy for the dataset.
        if str(dataset.user_id) != user_id:
            raise HTTPException(status_code=403, detail="Not allowed to create policy for this dataset")
        payload = await request.json()

        # Validate payload
        if not payload:
            raise HTTPException(status_code=400, detail="Request should not be empty")
        if not payload.get("name"):
            raise HTTPException(status_code=400, detail="Name must be provided and non-empty")
        if not payload.get("policy"):
            raise HTTPException(status_code=400, detail="Policy content must be provided and non-empty")


        policies = dataset.extra_metadata.get("policies", [])
        try:
            policies.append(DatasetPolicy(
                id=str(uuid.uuid4()),
                name=payload.get("name"),
                content=payload.get("policy"),
            ).to_dict())
        except ValidationError as e:
            raise HTTPException(status_code=400, detail="Invalid Policy string") from e

        dataset.extra_metadata["policies"] = policies
        flag_modified(dataset, 'extra_metadata')
        session.commit()
        return dataset_to_json(dataset)


@dataset.put("/{dataset_id}/policy/{policy_id}")
async def update_policy(
    request: Request,
    dataset_id: str,
    policy_id: str,
    userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]
):
    """Updates a policy for a dataset."""
    user_id = userinfo["sub"]

    with Session(db()) as session:
        dataset = load_dataset(session, dataset_id, user_id, allow_public=True, return_user=False)
        # Only the owner of the dataset can update a policy for the dataset.
        if str(dataset.user_id) != user_id:
            raise HTTPException(status_code=403, detail="Not allowed to update policy for this dataset")
        payload = await request.json()

        # Validate payload
        if not payload:
            raise HTTPException(status_code=400, detail="Request should not be empty")
        if "name" in payload and not payload["name"]:
            raise HTTPException(status_code=400, detail="Name must be non-empty if provided")
        if "policy" in payload and not payload["policy"]:
            raise HTTPException(status_code=400, detail="Policy must be non-empty if provided")

        policies = dataset.extra_metadata.get("policies", [])
        existing_policy = next((p for p in policies if p["id"] == policy_id), None)
        if not existing_policy:
            raise HTTPException(status_code=404, detail="Policy to update not found")

        try:
            # Update the name and policy content if provided in the payload.
            updated_policy = DatasetPolicy(
                id=existing_policy["id"],
                name=payload.get("name", existing_policy["name"]),
                content=payload.get("policy", existing_policy["content"])
            ).to_dict()
            policies.append(updated_policy)
            policies.remove(existing_policy)
        except ValidationError as e:
            raise HTTPException(status_code=400, detail="Invalid Policy string") from e

        flag_modified(dataset, 'extra_metadata')
        session.commit()
        return dataset_to_json(dataset)

@dataset.delete("/{dataset_id}/policy/{policy_id}")
async def delete_policy(
    dataset_id: str,
    policy_id: str,
    userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]
):
    """Deletes a policy for a dataset."""
    user_id = userinfo["sub"]

    with Session(db()) as session:
        dataset = load_dataset(session, dataset_id, user_id, allow_public=True, return_user=False)
        # Only the owner of the dataset can delete a policy for the dataset.
        if str(dataset.user_id) != user_id:
            raise HTTPException(status_code=403, detail="Not allowed to delete policy for this dataset")
        policies = dataset.extra_metadata.get("policies", [])

        policy = next((p for p in policies if p["id"] == policy_id), None)
        if not policy:
            raise HTTPException(status_code=404, detail="Policy not found")
        policies.remove(policy)
        dataset.extra_metadata["policies"] = policies

        flag_modified(dataset, 'extra_metadata')
        session.commit()
        return dataset_to_json(dataset)

@dataset.get("/metadata/{dataset_name}")
async def get_metadata(
    dataset_name: str, userinfo: Annotated[dict, Depends(APIIdentity)]
):
    """Get metadata for a dataset."""
    assert userinfo.get("sub") is not None, "cannot resolve API key to user identity"
    user_id = userinfo.get("sub")

    with Session(db()) as session:
        dataset_response = load_dataset(
            session, {"name": dataset_name}, user_id, allow_public=True, return_user=False
        )
        metadata_response = dataset_response.extra_metadata
        metadata_response.pop("policies", None)
        return {
            **metadata_response,
        }


@dataset.put("/metadata/{dataset_name}")
async def update_metadata(
    dataset_name: str, request: Request, userinfo: Annotated[dict, Depends(APIIdentity)]
):
    """Update metadata for a dataset."""
    assert userinfo.get("sub") is not None, "cannot resolve API key to user identity"
    user_id = userinfo.get("sub")

    payload = await request.json()
    metadata = payload.get("metadata", {})
    if not isinstance(metadata, dict):
        raise HTTPException(status_code=400, detail="metadata must be a dictionary")
    # When replace_all is False:
    # * If a field doesn't exist or is None in the payload, ignore it.
    # * Otherwise, update the field in extra_metadata with the new value.
    # When replace_all is True:
    # * If a field doesn't exist or is None in the payload, delete the field from extra_metadata.
    # * Otherwise, update the field in extra_metadata with the new value.
    # This holds true for nested objects like invariant.test_results too.
    # Thus the caller cannot update only a part of the nested object - they need to provide the
    # full object.
    replace_all = payload.get("replace_all", False)
    if not isinstance(replace_all, bool):
        raise HTTPException(status_code=400, detail="replace_all must be a boolean")

    invariant_test_results = metadata.get("invariant.test_results")
    if invariant_test_results is not None and not isinstance(
        invariant_test_results, dict
    ):
        raise HTTPException(
            status_code=400,
            detail="invariant.test_results must be a dictionary if provided",
        )
    # Filter out invalid keys.
    invariant_test_results = (
        {
            k: v
            for k, v in invariant_test_results.items()
            if k in ["num_tests", "num_passed"]
        }
        if invariant_test_results is not None
        else None
    )

    # Validate payload.
    # If the benchmark field is provided, it must be a non-empty string.
    # If the accuracy field is provided, it must be a non-negative float or int.
    # If the name field is provided, it must be a non-empty string.
    # If invariant.test_results is provided, it must be a dictionary with keys num_tests
    # and num_passed. num_tests and num_passed must be of type int if provided.
    if metadata.get("benchmark") is not None and (
        not isinstance(metadata.get("benchmark"), str)
        or not metadata.get("benchmark").strip()
    ):
        raise HTTPException(
            status_code=400, detail="Benchmark must be a non-empty string if provided"
        )
    if metadata.get("name") is not None and (
        not isinstance(metadata.get("name"), str) or not metadata.get("name").strip()
    ):
        raise HTTPException(
            status_code=400, detail="Name must be a non-empty string if provided"
        )
    if metadata.get("accuracy") is not None and (
        not isinstance(metadata.get("accuracy"), (int, float))
        or metadata.get("accuracy") < 0
    ):
        raise HTTPException(
            status_code=400,
            detail="Accuracy score must be a non-negative float or int if provided",
        )
    if invariant_test_results is not None:
        if not invariant_test_results:
            raise HTTPException(
                status_code=400,
                detail="invariant.test_results must not be empty if provided",
            )
        for key_and_type in [
            {"key": "num_tests", "type": int},
            {"key": "num_passed", "type": int},
        ]:
            if (
                invariant_test_results.get(key_and_type["key"])
                is not None
            ):
                if not isinstance(
                    invariant_test_results.get(key_and_type["key"]),
                    key_and_type["type"],
                ):
                    raise HTTPException(
                        status_code=400,
                        detail=f"invariant.test_results.{key_and_type['key']} must be of type {key_and_type['type'].__name__} if provided",
                    )

    with Session(db()) as session:
        dataset_response = load_dataset(
            session,
            {"name": dataset_name},
            user_id,
            allow_public=True,
            return_user=False,
        )
        if str(dataset_response.user_id) != user_id:
            raise HTTPException(
                status_code=403,
                detail="Not allowed to update metadata for this dataset",
            )
        if replace_all:
            # Delete the fields in extra_metadata if they are not provided in
            # the payload when replace_all is True.
            if metadata.get("benchmark") is None:
                dataset_response.extra_metadata.pop("benchmark", None)
            if metadata.get("accuracy") is None:
                dataset_response.extra_metadata.pop("accuracy", None)
            if metadata.get("name") is None:
                dataset_response.extra_metadata.pop("name", None)
            if metadata.get("invariant.test_results") is None:
                dataset_response.extra_metadata.pop("invariant.test_results", None)
        # Update the fields in extra_metadata whose value is not None in the payload.
        if metadata.get("benchmark") is not None:
            dataset_response.extra_metadata["benchmark"] = metadata.get("benchmark")
        if metadata.get("accuracy") is not None:
            dataset_response.extra_metadata["accuracy"] = metadata.get("accuracy")
        if metadata.get("name") is not None:
            dataset_response.extra_metadata["name"] = metadata.get("name")
        if metadata.get("invariant.test_results") is not None:
            dataset_response.extra_metadata["invariant.test_results"] = {}
            for key in ["num_tests", "num_passed"]:
                if metadata.get("invariant.test_results").get(key) is not None:
                    dataset_response.extra_metadata["invariant.test_results"][
                        key
                    ] = metadata.get("invariant.test_results").get(key)

        flag_modified(dataset_response, "extra_metadata")
        session.commit()
        metadata_response = dataset_response.extra_metadata
        metadata_response.pop("policies", None)
        return {
            **metadata_response,
        }
