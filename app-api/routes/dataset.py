import hashlib
import os
import re
import json
import datetime
import traceback

from sqlalchemy.orm import DeclarativeBase

from sqlalchemy import String, Integer, Column, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import Session
from sqlalchemy import create_engine, or_

import uuid
from sqlalchemy.dialects.postgresql import UUID
from fastapi import FastAPI, File, UploadFile, Request, HTTPException

from models.datasets_and_traces import Dataset, db, Trace, Annotation, User

# dataset routes
dataset = FastAPI()

# upload a new dataset
@dataset.post("/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    try:
        # get name from the form
        name = (await request.form()).get("name")
        # save the file to the user's directory
        # /srv/datasets
        userid = request.state.userinfo["sub"]
        if userid is None:
            raise HTTPException(status_code=401, detail="Unauthorized upload")
        uuid_to_ensure_it_is_unique = hashlib.sha256(file.filename.encode()).hexdigest()
        
        # check that there is not a dataset with the same name
        with Session(db()) as session:
            dataset = session.query(Dataset).filter(Dataset.name == name).first()
            if dataset is not None:
                raise HTTPException(status_code=400, detail="Dataset with the same name already exists")

        # make sure user directory exists
        os.makedirs(os.path.join("/srv/datasets", userid), exist_ok=True)
        path = os.path.join("/srv/datasets", userid, uuid_to_ensure_it_is_unique)
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
                user_id=userid,
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
                        trace = Trace(
                            id=uuid.uuid4(),
                            index=i,
                            dataset_id=dataset.id,
                            content=line,
                            extra_metadata=json.dumps({
                                "num_messages": len(object) if type(object) is list else 1
                            })
                        )
                        session.add(trace)
            
            session.commit()
            
            return {
                "id": dataset.id,
                "path": path,
                "extra_metadata": metadata
            }
    except Exception as e:
        import traceback
        traceback.print_exc()
        if type(e) == HTTPException:
            raise e
        raise HTTPException(status_code=500, detail="Failed to upload file")
    
# list all datasets, but without their traces
@dataset.get("/list")
def list_datasets(request: Request):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized list")
    
    with Session(db()) as session:
        datasets = session.query(Dataset, User).join(User, User.id == Dataset.user_id).filter(or_(Dataset.user_id == userid, Dataset.is_public)).all()
        
        return [{
            "id": dataset.id, 
            "name": dataset.name, 
            "path": dataset.path, 
            "extra_metadata": dataset.extra_metadata,
            "is_public": dataset.is_public,
            "user": {
                "id": user.id,
                "username": user.username
            }
        } for dataset, user in datasets]

# delete a dataset
@dataset.delete("/{id}")
def delete_dataset(request: Request, id: str):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized delete")
    
    with Session(db()) as session:
        dataset = session.query(Dataset).filter(Dataset.id == id).first()
        if dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if dataset.user_id != userid:
            raise HTTPException(status_code=401, detail="Unauthorized delete")
        
        # delete dataset file
        if os.path.exists(dataset.path):
            os.remove(dataset.path)
        
        # delete all traces
        session.query(Trace).filter(Trace.dataset_id == id).delete()

        # delete all annotations
        session.query(Annotation).filter(Annotation.trace_id == id).delete()

        # delete dataset
        session.delete(dataset)
        
        session.commit()
        return {"message": "Deleted"}

# returns the collections of a dataset
def get_collections(dataset: Dataset, num_traces: int):
    # get number of traces with at least one annotation
    with Session(db()) as session:
        num_annotated = session.query(Trace).filter(Trace.dataset_id == dataset.id)\
            .join(Annotation, Trace.id == Annotation.trace_id).count()
    
    return [
        {
            "id": "all",
            "name": "All",
            "count": num_traces
        },
        {
            "id": "annotated",
            "name": "Annotated",
            "count": num_annotated
        },
        {
            "id": "unannotated",
            "name": "Unannotated",
            "count": num_traces - num_annotated
        }
    ]

# gets details on a dataset (including collections, but without traces)
@dataset.get("/{id}")
def get_dataset(request: Request, id: str):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    with Session(db()) as session:
        dataset = session.query(Dataset).filter(Dataset.id == id).first()
        
        if dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if str(dataset.user_id) != userid and not dataset.is_public:
            raise HTTPException(status_code=401, detail="Unauthorized get: Dataset is private")
        
        # count all traces
        num_traces = session.query(Trace).filter(Trace.dataset_id == id).count()

        return {
            "id": dataset.id, 
            "name": dataset.name, 
            "extra_metadata": dataset.extra_metadata,
            "num_traces": num_traces,
            "is_public": dataset.is_public,
            "buckets": get_collections(dataset, num_traces)
        }

# update the dataset, currently only allows to change the visibility
@dataset.put("/{id}")
async def update_dataset(request: Request, id: str):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
  
    with Session(db()) as session:
        dataset = session.query(Dataset).filter(Dataset.id == id).first()
        print(dataset)
        
        if dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if str(dataset.user_id) != userid:
            raise HTTPException(status_code=401, detail="Unauthorized get")


        payload = await request.json()
        is_public = bool(payload.get("content"))
        dataset.is_public = is_public        
        session.commit()
        # count all traces
        num_traces = session.query(Trace).filter(Trace.dataset_id == id).count()

        return {
            "id": dataset.id, 
            "name": dataset.name, 
            "extra_metadata": dataset.extra_metadata,
            "num_traces": num_traces,
            "is_public": dataset.is_public,
            "buckets": get_collections(dataset, num_traces)
        }



# get all traces of a dataset in the given collection (formerly known as bucket)
@dataset.get("/{id}/{bucket}")
def get_traces(request: Request, id: str, bucket: str):
    try:
        # extra query parameter to filter by index
        limit = request.query_params.get("limit")
        offset = request.query_params.get("offset")

        userid = request.state.userinfo["sub"]
        if userid is None:
            raise HTTPException(status_code=401, detail="Unauthorized request")
        
        with Session(db()) as session:
            dataset = session.query(Dataset).filter(Dataset.id == id).first()
            
            if dataset is None:
                raise HTTPException(status_code=404, detail="Dataset not found")
            if str(dataset.user_id) != userid and not dataset.is_public:
                raise HTTPException(status_code=401, detail="Unauthorized get: Dataset is private")
 
            
            if bucket == "all":
                traces = session.query(Trace).filter(Trace.dataset_id == id)
            elif bucket == "annotated" or bucket == "unannotated":
                # same as above
                traces = session.query(Trace).filter(Trace.dataset_id == id)
            else:
                raise HTTPException(status_code=404, detail="Bucket not found")
            
            print("traces is", traces)

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
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to get annotated traces")
