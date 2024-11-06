"""Defines routes for APIs related to dataset."""

import copy
import datetime
import json
import re
import uuid
from typing import Annotated
from fastapi import Depends, FastAPI, File, UploadFile, Request, HTTPException
from fastapi.responses import StreamingResponse
from invariant.policy import AnalysisResult, Policy
from invariant.runtime.input import mask_json_paths
from models.datasets_and_traces import (Annotation, Dataset, DatasetPolicy,
                                        SavedQueries, SharedLinks, Trace, User,
                                        db)
from models.importers import import_jsonl
from models.queries import (dataset_to_json, get_savedqueries, load_annoations,
                            load_dataset, load_trace, query_traces,
                            search_term_mappings, trace_to_exported_json,
                            trace_to_json)
from pydantic import ValidationError
from routes.apikeys import APIIdentity
from routes.auth import AuthenticatedUserIdentity, UserIdentity
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.sql import func
from util.util import validate_dataset_name

# dataset routes
dataset = FastAPI()

def handle_dataset_creation_integrity_error(error: IntegrityError):
    """Handle integrity error for dataset creation."""
    if "_user_id_name_uc" in str(error.orig):
        raise HTTPException(
            status_code=400, detail="Dataset with the same name already exists"
        ) from error
    raise HTTPException(
        status_code=400, detail="An integrity error occurred"
    ) from error


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
        raise HTTPException(status_code=400, detail="Name must be provided")
    validate_dataset_name(name)

    metadata = data.get("metadata", dict())
    metadata["created_on"] = str(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    with Session(db()) as session:
        dataset = Dataset(
            id=uuid.uuid4(), user_id=user_id, name=name, extra_metadata=metadata
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
    # get name from the form
    name = (await request.form()).get("name")
    user_id = userinfo["sub"]
    if user_id is None:
        raise HTTPException(
            status_code=401, detail="Must be authenticated to upload a dataset"
        )
    validate_dataset_name(name)

    with Session(db()) as session:
        lines = file.file.readlines()
        dataset = import_jsonl(session, name, user_id, lines)
        try:
            session.commit()
        except IntegrityError as e:
            session.rollback()
            handle_dataset_creation_integrity_error(e)
        return dataset_to_json(dataset)

########################################
# list all datasets, but without their traces
########################################

@dataset.get("/list")
def list_datasets(request: Request, user: Annotated[dict, Depends(UserIdentity)]):
    user_id = user.get("sub")
    
    limit = request.query_params.get("limit")
    limit = limit if limit != '' else None
    
    with Session(db()) as session:
        datasets = session.query(Dataset, User)\
            .join(User, User.id == Dataset.user_id)\
            .filter(or_(Dataset.user_id == user_id, Dataset.is_public))\
            .order_by(Dataset.time_created.desc())\
            .limit(limit)\
            .all()
        
        return [dataset_to_json(dataset, user) for dataset, user in datasets]

@dataset.get("/list/byuser/{user_name}")
def list_datasets_by_user(request: Request, user_name: str, user: Annotated[dict, Depends(UserIdentity)]):
    with Session(db()) as session:
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

def get_dataset(by: dict, userinfo: Annotated[dict, Depends(UserIdentity)]):
    # may be None in case of anonymous users/public datasets or traces
    user_id = userinfo["sub"]
    
    with Session(db()) as session:
        dataset, user = load_dataset(session, by, user_id, allow_public=True, return_user=True)
        # count all traces
        num_traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).count()
        return dataset_to_json(dataset, user,
                               num_traces=num_traces,
                               queries=get_savedqueries(session, dataset, user_id, num_traces))


@dataset.get("/byid/{id}")
def get_dataset_by_id(request: Request, id: str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    return get_dataset({"id": id}, userinfo)

@dataset.get("/byuser/{username}/{dataset_name}")
def get_dataset_by_name(request: Request, username:str, dataset_name:str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    return get_dataset({'User.username': username, 'name': dataset_name}, userinfo)

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
            for key in result.keys():
                if key == 'Other Traces': continue
                result[key]['description'] = 'Invariant Analyzer'

                # TODO: replace with permanent solution
                if key == "Forgot to call a tool":
                    result[key]['severity'] = 1
                    result[key]['icon'] = 'tools'
                elif key == "Wrong tool arguments":
                    result[key]['severity'] = 3
                    result[key]['icon'] = 'tools'
                elif key == "Infinite loop":
                    result[key]['icon'] = 'exclamation'
                    result[key]['severity'] = 4
                elif key == "Missing information in the response":
                    result[key]['severity'] = 1
                    result[key]['icon'] = 'info'
                elif key == "Moderated content":
                    result[key]['severity'] = 1
                    result[key]['icon'] = 'info'
                elif key == "Secret code in the discord message":
                    result[key]['severity'] = 5
                    result[key]['icon'] = 'exclamation-large'
                elif key == "URL sent to discord":
                    result[key]['severity'] = 2
                    result[key]['icon'] = 'info'
                elif key == "User message contains URL":
                    result[key]['severity'] = 1
                    result[key]['icon'] = 'exclamation'
                elif key == "Hallucination":
                    result[key]['severity'] = 4
                    result[key]['icon'] = 'exclamation'
                elif key == "Wrong tool argument format":
                    result[key]['severity'] = 2
                    result[key]['icon'] = 'tools'
                elif key == "Action plan flawed":
                    result[key]['severity'] = 2
                    result[key]['icon'] = 'tools'
                
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
async def save_query(request: Request, query_id:str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
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
- userinfo: user identity information
- indices: list of trace indices to filter by (optional)
"""
def get_traces(request: Request, by: dict, userinfo: Annotated[dict, Depends(UserIdentity)], indices: list[int] = None):
    # extra query parameter to filter by index
    limit = request.query_params.get("limit")
    offset = request.query_params.get("offset")

    # users can be anonymous
    user_id = userinfo["sub"]
    
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

@dataset.post("/analyze/{id}")
async def analyze_dataset_by_id(request: Request, id: str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    """Analyzes all traces in the dataset using invariant analyzer and adds the ranges that correspond to errors as annotations that
    can be highlighted in the UI.
    TODO: Right now we run analysis locally, but in the future this will be remote call (so it's fine to block for now).

    Args:
        request: The HTTP request containing the policy as a string, and a boolean flag that determines whether the existing annotations
                produced by the analyzer should be overwritten.
        id: The ID of the dataset to analyze.
        userinfo: The user's identity information.

    Returns:
        A dictionary containing the analysis result.
    """
    user_id = userinfo['sub']

    # get all traces of the dataset id
    traces = get_traces(request, {'id': id}, userinfo)
    
    payload = await request.json()
    overwrite = payload.get("overwrite", True)
    skip_analyzed = payload.get("skip_analyzed", True)
    policy_str = payload.get("policy_str", "")
    analysis_host = payload.get("analysis_host", "local")
    batch_size = payload.get("batch_size", None)

    # analysis stats
    total_errors = 0

    if analysis_host == "modal":
        modal_func = modal.Function.lookup("invariant-analyzer", "run_analysis")

    with Session(db()) as session:
        traces = [load_trace(session, {"id": trace["id"]}, user_id) for trace in traces]
        all_messages = []
        for idx, trace in enumerate(traces):
            # Replace the parameters in the policy string with the parameters in the trace metadata
            analysis_params = {k: v for k, v in trace.extra_metadata.items() if type(k) is str and type(v) is str}

            annotations = load_annoations(session, trace.id)
            if skip_analyzed and len(annotations) > 0:
                continue
            if overwrite:
                # delete all existing annotations where source is the analyzer
                for annotation, _ in annotations:
                    if annotation.extra_metadata and annotation.extra_metadata.get("source") == "analyzer":
                        session.delete(annotation)

            all_messages.append((idx, trace.content, analysis_params))

        if analysis_host == "modal":
            step = len(all_messages) if batch_size is None else batch_size
            results = []
            for i in range(0, len(all_messages), step):
                batch_results = await asyncio.gather(*[modal_func.remote.aio(policy_str, messages, analysis_params) 
                                                       for _, messages, analysis_params in all_messages[i:i+step]])
                results.extend(batch_results)
            new_results = []
            # Some results might not be valid if the analysis failed (e.g. timeout or other errors)
            for r in results:
                try:
                    new_results.append(AnalysisResult.model_validate_json(r))
                except ValidationError as e:
                    print("Got validation error: ", str(e))
                    new_results.append(None)
            results = new_results
        elif analysis_host == "local":
            results = []
            for _, messages, analysis_params in all_messages:
                policy = Policy.from_string(policy_str)
                results.append(policy.analyze(messages, **analysis_params))
        else:
            raise ValueError(f"Invalid analysis host: {analysis_host}")

        for i, res in enumerate(results):
            if res is None:
                continue
            idx, messages, _ = all_messages[i]
            trace = traces[idx]

            total_errors += len(res.errors)

            if len(res.errors) > 0:
                metadata = copy.copy(trace.extra_metadata) if trace.extra_metadata is not None else {}
                for error in res.errors:
                    if error.kwargs.get("is_moderated", False):
                        json_paths = [range.json_path for range in error.ranges]
                        moderated_messages = mask_json_paths(messages, json_paths, lambda x: "*" * len(x))
                        metadata["moderated"] = True
                if metadata.get("moderated", False):
                    trace.content = moderated_messages
                    trace.extra_metadata = metadata

            for error in res.errors:
                metadata = {"source": "analyzer"}
                for rng in error.ranges:
                    range_annotation = Annotation(
                        trace_id=trace.id,
                        user_id=user_id,
                        address="messages." + str(rng.json_path),
                        content=error.model_dump_json(),
                        extra_metadata=metadata)
                    session.add(range_annotation)

            main_annotation = Annotation(
                trace_id=trace.id,
                user_id=user_id,
                address="messages[0].content:L0", # TODO: This is now hardcoded, but should be shown in separate analyzer card
                content=res.model_dump_json(),
                extra_metadata={"source": "analyzer"}
            )
            session.add(main_annotation)
        session.commit()

    return {"result": "success", "total_errors": total_errors}
@dataset.get("/byid/{id}/traces")
def get_traces_by_id(request: Request, id: str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    return get_traces(request, {'id': id}, userinfo)

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

    traces = session.query(Trace).filter(Trace.dataset_id == dataset_id).all()
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
def get_traces_by_name(request: Request, username:str, dataset_name:str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    indices = request.query_params.get("indices")
    indices = [int(i) for i in indices.split(",")] if indices is not None else None
    return get_traces(request, {'User.username': username, 'name': dataset_name}, userinfo, indices=indices)

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

    # Validate payload.
    # Only allow updating the benchmark and accuracy fields.
    # If the benchmark field is provided, it must be a non-empty string.
    # If the accuracy field is provided, it must be a non-negative float or int.
    if "benchmark" not in payload and "accuracy" not in payload:
        raise HTTPException(
            status_code=400,
            detail="Request must contain at least one of 'benchmark' or 'accuracy'",
        )
    if "benchmark" in payload and (
        not isinstance(payload["benchmark"], str) or not payload["benchmark"].strip()
    ):
        raise HTTPException(
            status_code=400, detail="Benchmark must be a non-empty string if provided"
        )
    if "accuracy" in payload and (
        not isinstance(payload["accuracy"], (int, float))
        or payload["accuracy"] < 0
    ):
        raise HTTPException(
            status_code=400,
            detail="Accuracy score must be a non-negative float or int if provided",
        )

    with Session(db()) as session:
        dataset_response = load_dataset(
            session, {"name": dataset_name}, user_id, allow_public=True, return_user=False
        )
        if str(dataset_response.user_id) != user_id:
            raise HTTPException(
                status_code=403,
                detail="Not allowed to update metadata for this dataset",
            )

        if "benchmark" in payload:
            dataset_response.extra_metadata["benchmark"] = payload["benchmark"]
        if "accuracy" in payload:
            dataset_response.extra_metadata["accuracy"] = payload[
                "accuracy"
            ]

        flag_modified(dataset_response, "extra_metadata")
        session.commit()
        metadata_response = dataset_response.extra_metadata
        metadata_response.pop("policies", None)
        return {
            **metadata_response,
        }
