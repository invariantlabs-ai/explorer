import copy
import json
import datetime
import uuid
import asyncio

from fastapi import Depends
from fastapi.responses import StreamingResponse

from invariant.policy import Policy
from invariant.runtime.input import mask_json_paths

from sqlalchemy.orm import DeclarativeBase

from sqlalchemy import String, Integer, Column, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import Session
from sqlalchemy import create_engine, or_, and_

from sqlalchemy.dialects.postgresql import UUID
from fastapi import FastAPI, File, UploadFile, Request, HTTPException

from models.importers import import_jsonl
from models.datasets_and_traces import Dataset, db, Trace, Annotation, User
from models.queries import *

from typing import Annotated
from routes.auth import UserIdentity, AuthenticatedUserIdentity

# dataset routes
dataset = FastAPI()

def is_duplicate(user_id, name) -> bool:
    """Check if a dataset with the same name already exists."""
    with Session(db()) as session:
        dataset = session.query(Dataset).filter(and_(Dataset.user_id == user_id, Dataset.name == name)).first()
        if dataset is not None:
            return True
            # raise HTTPException(status_code=400, detail="Dataset with the same name already exists")
    return False


@dataset.post("/create")
async def create(request: Request, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    user_id = userinfo["sub"]
    if user_id is None:
        raise HTTPException(status_code=401, detail="Must be authenticated to create a dataset")

    data = await request.json()
    name = data.get("name")
    if name is None:
        raise HTTPException(status_code=400, detail="Name must be provided")
    if is_duplicate(user_id, name):
        raise HTTPException(status_code=400, detail="Dataset with the same name already exists")

    metadata = data.get("metadata", dict())
    metadata["created_on"] = str(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    with Session(db()) as session:
        dataset = Dataset(
            id=uuid.uuid4(),
            user_id=user_id,
            name=name,
            extra_metadata=metadata
        )
        dataset.extra_metadata = metadata
        session.add(dataset)
        session.commit()
        return dataset_to_json(dataset)

@dataset.post("/upload")
async def upload_file(request: Request, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)], file: UploadFile = File(...)):
    # get name from the form
    name = (await request.form()).get("name")
    user_id = userinfo["sub"]
    if user_id is None:
        raise HTTPException(status_code=401, detail="Must be authenticated to upload a dataset")
    if is_duplicate(user_id, name):
        raise HTTPException(status_code=400, detail="Dataset with the same name already exists")

    with Session(db()) as session:
        lines = file.file.readlines()
        dataset = import_jsonl(session, name, user_id, lines)
        session.commit()
    
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
# summarize
########################################

@dataset.post("/byid/{id}/summarize")
async def summarize(request: Request, id: str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    user_id = userinfo['sub']
    with Session(db()) as session:
        by = {'id': id}
        dataset, user = load_dataset(session, by, user_id, allow_public=True, return_user=True)
        traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).all()
        from openai import AsyncOpenAI
        api_key = os.getenv("OPENAI_API_KEY")
        client = AsyncOpenAI(api_key=api_key)
        def to_text(message):
            if 'role' in message:
                return f"{message['role']}: {message['content']}"
            elif 'type' in message:
                return f"function call {message['type']}"
        summaries = []
        for trace in traces:
            text = "\n".join([to_text(m) for m in trace.content])
            chat = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{'role': 'system', 'content': 'Provide a 1-sentence summary of the following conversation. Be very concise.'},
                          {'role': 'user', 'content': text}],
            )
            summaries.append(chat)
        for i, trace in enumerate(traces):
            summary = await summaries[i]
            summary = summary.choices[0].message.content
            emd = deepcopy(trace.extra_metadata)
            emd['summary'] = summary
            trace.extra_metadata = emd
        session.commit()


########################################
# search
########################################

@dataset.get("/byuser/{username}/{dataset_name}/s")
def serach_dataset_by_name(request: Request, username:str, dataset_name:str, userinfo: Annotated[dict, Depends(UserIdentity)], query:str = None):
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
            selected_traces, search_term = query_traces(session, dataset, query, return_search_term=True)
            for trace in selected_traces:
                mappings[trace.index] = search_term_mappings(trace, search_term)
            result[query] = {}
            result[query]['traces'] = list(sorted([trace.index for trace in selected_traces]))
            result[query]['description'] = 'search result'

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

def get_traces(request: Request, by: dict, userinfo: Annotated[dict, Depends(UserIdentity)]):
    # extra query parameter to filter by index
    limit = request.query_params.get("limit")
    offset = request.query_params.get("offset")

    # users can be anonymous
    user_id = userinfo["sub"]
    
    with Session(db()) as session:
        dataset, user = load_dataset(session, by, user_id, allow_public=True, return_user=True)
        
        traces = session.query(Trace).filter(Trace.dataset_id == dataset.id)
                
        # with join, count number of annotations per trace
        traces = traces\
            .outerjoin(Annotation, Trace.id == Annotation.trace_id)\
            .group_by(Trace.id)\
            .add_columns(Trace.id, Trace.index, Trace.content, Trace.extra_metadata, func.count(Annotation.id).label("num_annotations"))
        
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
            "extra_metadata": trace.extra_metadata
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
    overwrite = bool(payload.get("overwrite", True))
    policy_str = payload.get("policy_str", "")

    # analysis stats
    total_errors = 0

    with Session(db()) as session:
        for trace in traces:
            trace_id = trace["id"]
            trace = load_trace(session, {"id": trace_id}, user_id)
            # Replace the parameters in the policy string with the parameters in the trace metadata
            analysis_params = {k: v for k, v in trace.extra_metadata.items() if type(k) is str and type(v) is str}
            trace_policy_str = policy_str.format(**analysis_params)

            if overwrite:
                # delete all existing annotations where source is the analyzer
                annotations = load_annoations(session, trace_id)
                for annotation, _ in annotations:
                    if annotation.extra_metadata and annotation.extra_metadata.get("source") == "analyzer":
                        session.delete(annotation)

            policy = Policy.from_string(trace_policy_str)
            messages = trace.content
            res = policy.analyze(messages)

            total_errors += len(res.errors)

            if len(res.errors) > 0:
                metadata = copy.copy(trace.extra_metadata) if trace.extra_metadata is not None else {}
                for error in res.errors:
                    if error.kwargs.get("is_moderated", False):
                        json_paths = [range.json_path for range in error.ranges]
                        moderated_messages = mask_json_paths(messages, json_paths, lambda x: "*" * len(x))
                        metadata["moderated"] = True
                if metadata.get("moderated", False):
                    trace.content = json.dumps(moderated_messages)
                    trace.extra_metadata = metadata

            for error in res.errors:
                metadata = {"source": "analyzer"}
                for range in error.ranges:
                    range_annotation = Annotation(
                        trace_id=trace_id,
                        user_id=user_id,
                        address="messages." + str(range.json_path),
                        content=str(error),
                        extra_metadata=metadata)
                    session.add(range_annotation)

            analyzer_msg = "Invariant analyzer result:\n\n" + str(res)
            main_annotation = Annotation(
                trace_id=trace_id,
                user_id=user_id,
                address="messages[0].content:L0", # TODO: This is now hardcoded, but should be shown in separate analyzer card
                content=analyzer_msg,
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
    return get_traces(request, {'User.username': username, 'name': dataset_name}, userinfo)

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
