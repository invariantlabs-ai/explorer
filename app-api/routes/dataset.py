import hashlib
import os
import re
import json
import datetime
import traceback
from fastapi import Depends

from sqlalchemy.orm import DeclarativeBase

from sqlalchemy import String, Integer, Column, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import Session
from sqlalchemy import create_engine, or_, and_

import uuid
from sqlalchemy.dialects.postgresql import UUID
from fastapi import FastAPI, File, UploadFile, Request, HTTPException

from models.datasets_and_traces import Dataset, db, Trace, Annotation, User
from models.queries import *

from typing import Annotated
from routes.auth import UserIdentity, AuthenticatedUserIdentity

# dataset routes
dataset = FastAPI()

def create_dataset(user_id, name, metadata):
    """Create a dataset with given parameters."""
    dataset = Dataset(
        id=uuid.uuid4(),
        user_id=user_id,
        name=name,
        path="",
        extra_metadata=metadata
    )
    dataset.extra_metadata = metadata
    return dataset


@dataset.post("/upload")
async def upload_file(request: Request, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)], file: UploadFile = File(...)):
    # get name from the form
    name = (await request.form()).get("name")
    user_id = userinfo["sub"]
    if user_id is None:
        raise HTTPException(status_code=401, detail="Must be authenticated to upload a dataset")
    
    # check that there is not a dataset with the same name
    with Session(db()) as session:
        dataset = session.query(Dataset).filter(and_(Dataset.user_id == user_id, Dataset.name == name)).first()
        if dataset is not None:
            raise HTTPException(status_code=400, detail="Dataset with the same name already exists")

    lines = file.file.readlines()
    
    metadata = {
        "file_size": "{:.2f} kB".format(file.size / 1024),
        "num_lines": len(lines),
        "created_on": str(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    }

    # save the metadata to the database
    with Session(db()) as session:
        dataset = create_dataset(user_id, name, metadata)
        session.add(dataset)
        
        i = 0
        for line in lines:
            object = json.loads(line)
            if i == 0 and type(object) is dict and "metadata" in object.keys():
                metadata = {**metadata, **object["metadata"]}
                continue
            else:
                # extra trace metadata if present
                if type(object) is list and len(object) > 0 and "metadata" in object[0].keys():
                    trace_metadata = {**object[0]["metadata"]}
                    object = object[1:]
                else:
                    trace_metadata = {}
                # make sure to capture the number of messages
                trace_metadata["num_messages"] = len(object) if type(object) is list else 1
                trace = Trace(
                    id=uuid.uuid4(),
                    index=i,
                    user_id=user_id,
                    dataset_id=dataset.id,
                    content=json.dumps(object),
                    extra_metadata=trace_metadata
                )
                session.add(trace)
                i = i + 1

        print("metadata", metadata, flush=True)

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
        # delete dataset file
        if os.path.exists(dataset.path):
            os.remove(dataset.path)
        
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
def get_dataset_by_name(request: Request, username:str, dataset_name:str, userinfo: Annotated[dict, Depends(UserIdentity)], query:str = None):
    user_id = userinfo['sub']
    with Session(db()) as session:
        by = {'User.username': username, 'name': dataset_name}
        dataset, _ = load_dataset(session, by, user_id, allow_public=True, return_user=True)
        selected_traces, search_term = query_traces(session, dataset, query, return_search_term=True)
        return [{'index': trace.index,
                 'mapping': search_term_mappings(trace, [search_term])} for trace in selected_traces]
    
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


@dataset.get("/byid/{id}/traces")
def get_traces_by_id(request: Request, id: str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    return get_traces(request, {'id': id}, userinfo)

@dataset.get("/byid/{id}/full")
def get_traces_by_id(request: Request, id: str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    return get_all_traces({'id': id}, userinfo)

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
