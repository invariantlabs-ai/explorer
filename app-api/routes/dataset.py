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

# upload a new dataset
@dataset.post("/upload")
async def upload_file(request: Request, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)], file: UploadFile = File(...)):
    # get name from the form
    name = (await request.form()).get("name")
    # save the file to the user's directory
    # /srv/datasets
    user_id = userinfo["sub"]
    if user_id is None:
        raise HTTPException(status_code=401, detail="Must be authenticated to upload a dataset")
    uuid_to_ensure_it_is_unique = hashlib.sha256(file.filename.encode()).hexdigest()
    
    # check that there is not a dataset with the same name
    with Session(db()) as session:
        dataset = session.query(Dataset).filter(and_(Dataset.user_id == user_id, Dataset.name == name)).first()
        if dataset is not None:
            raise HTTPException(status_code=400, detail="Dataset with the same name already exists")

    # make sure user directory exists
    os.makedirs(os.path.join("/srv/datasets", user_id), exist_ok=True)
    path = os.path.join("/srv/datasets", user_id, uuid_to_ensure_it_is_unique)
    with open(path, "wb") as f:
        f.write(file.file.read())
    
    # determine file size
    file_size = os.path.getsize(path)
    # number of lines
    num_lines = sum(1 for line in open(path))
    # create metadata
    metadata = {
        "file_size": file_size,
        "num_lines": num_lines,
        "created_on": str(datetime.datetime.now())
    }
    
    # save the metadata to the database
    with Session(db()) as session:
        # create the dataset object
        dataset = Dataset(
            id=uuid.uuid4(),
            user_id=user_id,
            name=name,
            path=path,
            extra_metadata=json.dumps(metadata)
        )
        session.add(dataset)
        
        # load jsonl file
        with open(path, "r") as f:
            for i, line in enumerate(f):
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
                        extra_metadata=json.dumps(trace_metadata)
                    )
                    session.add(trace)
        
        print("metadata", metadata, flush=True)

        dataset.extra_metadata = json.dumps(metadata)

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
                               buckets=get_collections(session, dataset, num_traces))


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
    if query is None:
        return {"message": "Please provide a query"}
    user_id = userinfo['sub']
    with Session(db()) as session:
        by = {'User.username': username, 'name': dataset_name}
        dataset, _ = load_dataset(session, by, user_id, allow_public=True, return_user=True)


        from lark import Lark, Transformer
        grammar = r"""
        query: (term WS*)+ 
        term: filter_term | quoted_term | simple_term
        filter_term: WORD ":" WORD
        quoted_term: "\"" /[^\"]+/ "\""
        simple_term: WORD
        WS: /\s/
        %import common.WORD
        """
        class QueryTransformer(Transformer): 
            def __init__(self):
                super().__init__()
                self.search_terms = []
                self.filters = []  
            
            def simple_term(self, items):
                self.search_terms.append(items[0].value)
            
            def quoted_term(self, items):
                self.search_terms.append(" ".join(map(lambda x: x.value, items)))
                
            def filter_term(self, items):
                self.filters.append((items[0].value, items[1].value))


        selected_traces = session.query(Trace).filter(Trace.dataset_id == dataset.id)
        try:
            parser = Lark(grammar, parser='lalr', start='query')
            query_parse_tree = parser.parse(query)
            transformer = QueryTransformer()
            transformer.transform(query_parse_tree)

            if len(transformer.search_terms) > 0: 
                selected_traces = selected_traces.filter(or_(Trace.content.contains(term) for term in transformer.search_terms))
            for filter in transformer.filters:
                if filter[0] == 'is' and filter[1] == 'annotated':
                    selected_traces = selected_traces.join(Annotation, Trace.id == Annotation.trace_id).group_by(Trace.id).having(func.count(Annotation.id) > 0)
                elif filter[0] == 'not' and filter[1] == 'annotated':
                    selected_traces = selected_traces.outerjoin(Annotation, Trace.id == Annotation.trace_id).group_by(Trace.id).having(func.count(Annotation.id) == 0)
                else:
                    raise Exception("Invalid filter")
        except Exception as e:
            print(e) # we still want these searches to go through 
        
        selected_traces = selected_traces.all()
        return [{'id': trace.id, 'address':'@'} for trace in selected_traces]




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
        return dataset_to_json(dataset, num_traces=num_traces, buckets=get_collections(session, dataset, num_traces))

@dataset.put("/byid/{id}")
async def update_dataset_by_id(request: Request, id: str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    return await update_dataset(request, {'id': id}, userinfo)

@dataset.put("/byuser/{username}/{dataset_name}")
async def update_dataset_by_name(request: Request, username:str, dataset_name:str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    return await update_dataset(request, {'User.username': username, 'name': dataset_name}, userinfo)

########################################
# get all traces of a dataset in the given collection (formerly known as bucket)
########################################

def get_traces(request: Request, by: dict, bucket: str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    # extra query parameter to filter by index
    limit = request.query_params.get("limit")
    offset = request.query_params.get("offset")

    # users can be anonymous
    user_id = userinfo["sub"]
    
    with Session(db()) as session:
        dataset, user = load_dataset(session, by, user_id, allow_public=True, return_user=True)
        
        if bucket == "all":
            traces = session.query(Trace).filter(Trace.dataset_id == dataset.id)
        elif bucket == "annotated" or bucket == "unannotated":
            # same as above
            traces = session.query(Trace).filter(Trace.dataset_id == dataset.id)
        else:
            raise HTTPException(status_code=404, detail="Bucket not found")
        
        # with join, count number of annotations per trace
        traces = traces\
            .outerjoin(Annotation, Trace.id == Annotation.trace_id)\
            .group_by(Trace.id)\
            .add_columns(Trace.id, Trace.index, Trace.content, Trace.extra_metadata, func.count(Annotation.id).label("num_annotations"))

        # 
        if bucket == "annotated":
            traces = traces.having(func.count(Annotation.id) > 0)
        elif bucket == "unannotated":
            traces = traces.having(func.count(Annotation.id) == 0)
        
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


@dataset.get("/byid/{id}/{bucket}")
def get_traces_by_id(request: Request, id: str, bucket: str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    if bucket == 'full':
        return get_all_traces({'id': id}, userinfo)
    return get_traces(request, {'id': id}, bucket, userinfo)

@dataset.get("/byuser/{username}/{dataset_name}/{bucket}")
def get_traces_by_name(request: Request, username:str, dataset_name:str, bucket: str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    if bucket == 'full':
        return get_all_traces({'User.username': username, 'name': dataset_name}, userinfo)

    return get_traces(request, {'User.username': username, 'name': dataset_name}, bucket, userinfo)

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
