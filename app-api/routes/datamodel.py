import hashlib
import os
import re
import json
import datetime
from sqlalchemy import String, Integer, Column, ForeignKey
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import Session
from sqlalchemy import create_engine

from sqlalchemy.dialects.postgresql import UUID
import uuid

from fastapi import FastAPI, File, UploadFile, Request, HTTPException

class Base(DeclarativeBase):
    pass

class Dataset(Base):
    __tablename__ = "datasets"

    # key is uuid that auto creates
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = mapped_column(String, nullable=False)
    name = mapped_column(String, nullable=False)
    # path to the dataset relative to the user's directory
    path = mapped_column(String, nullable=False)
    # JSON object of the metadata parsed at ingestion
    extra_metadata = mapped_column(String, nullable=False)

class Trace(Base):
    __tablename__ = "traces"

    # key is uuid that auto creates
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # int index of trace in dataset
    index = mapped_column(Integer, nullable=False)
    # foreign dataset id that this trace belongs to
    dataset_id = mapped_column(UUID(as_uuid=True), ForeignKey("datasets.id"), nullable=False)
    content = mapped_column(String, nullable=False)
    extra_metadata = mapped_column(String, nullable=False)

class Annotation(Base):
    __tablename__ = "annotations"

    # key is uuid that auto creates
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # foreign trace id that this annotation belongs to
    trace_id = mapped_column(UUID(as_uuid=True), ForeignKey("traces.id"), nullable=False)
    # foreign user id that this annotation belongs to
    user_id = mapped_column(String, nullable=False)
    # JSON object of the annotation
    content = mapped_column(String, nullable=False)
    # address within the trace that this annotation belongs to (e.g. message, offset, etc.)
    address = mapped_column(String, nullable=False)
    # JSON object of the metadata parsed at ingestion
    extra_metadata = mapped_column(String, nullable=False)

# tags can be contained in an annotation and always map to a trace 
class Tag(Base):
    __tablename__ = "tags"

    # key is uuid that auto creates
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # foreign annotation id that this tag belongs to
    annotation_id = mapped_column(UUID(as_uuid=True), ForeignKey("annotations.id"), nullable=False)
    # foreign trace id that this tag belongs to
    trace_id = mapped_column(UUID(as_uuid=True), ForeignKey("traces.id"), nullable=False)
    # tag name
    name = mapped_column(String, nullable=False)

def db():
    client = create_engine("postgresql://{}:{}@database:5432/{}".format(
        os.environ["POSTGRES_USER"], os.environ["POSTGRES_PASSWORD"], os.environ["POSTGRES_DB"]
    ))

    Base.metadata.create_all(client)

    return client

# dataset routes
dataset = FastAPI()

# now the relevant fastapi endpoints for that
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
    
@dataset.get("/list")
def list_datasets(request: Request):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized list")
    
    with Session(db()) as session:
        datasets = session.query(Dataset).filter(Dataset.user_id == userid).all()
        return [{
            "id": dataset.id, 
            "name": dataset.name, 
            "path": dataset.path, 
            "extra_metadata": dataset.extra_metadata
        } for dataset in datasets]

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

@dataset.get("/{id}")
def get_dataset(request: Request, id: str):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    with Session(db()) as session:
        dataset = session.query(Dataset).filter(Dataset.id == id).first()
        
        if dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if dataset.user_id != userid:
            raise HTTPException(status_code=401, detail="Unauthorized get")
        
        # count all traces
        num_traces = session.query(Trace).filter(Trace.dataset_id == id).count()

        return {
            "id": dataset.id, 
            "name": dataset.name, 
            "extra_metadata": dataset.extra_metadata,
            "num_traces": num_traces
        }

def safe_load(content):
    try:
        r = json.loads(content)
        return r
    except:
        return [{"role": "system", "content": "failed to load message data"}]

@dataset.get("/{id}/{bucket}")
def get_traces(request: Request, id: str, bucket: str):
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
        if dataset.user_id != userid:
            raise HTTPException(status_code=401, detail="Unauthorized get")
        
        if bucket == "all":
            traces = session.query(Trace).filter(Trace.dataset_id == id)
        else:
            raise HTTPException(status_code=404, detail="Bucket not found")
        
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
            "extra_metadata": trace.extra_metadata
        } for trace in traces]

trace = FastAPI()

@trace.get("/{id}")
def get_trace(request: Request, id: str):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    with Session(db()) as session:
        trace = session.query(Trace).filter(Trace.id == id).first()
        
        if trace is None:
            raise HTTPException(status_code=404, detail="Trace not found")
        
        dataset = session.query(Dataset).filter(Dataset.id == trace.dataset_id).first()
        
        if dataset.user_id != userid:
            raise HTTPException(status_code=401, detail="Unauthorized get")
        
        return {
            "id": trace.id,
            "index": trace.index,
            "messages": message_load(trace.content),
            "extra_metadata": trace.extra_metadata
        }
    
def message_load(content):
    try:
        messages = json.loads(content)
        messages = [translate_leaves_to_annotation_tokens(message, prefix=f"message[{i}]") for i, message in enumerate(messages)]
        return messages
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"role": "system", "content": "failed to load message data"}
    
def translate_leaves_to_annotation_tokens(object, prefix=""):
    if type(object) is dict:
        return {k: translate_leaves_to_annotation_tokens(v, prefix + "." + k) if k != 'role' else v for k, v in object.items()}
    if type(object) is list:
        return [translate_leaves_to_annotation_tokens(v, prefix + "[" + str(i) + "]") for i, v in enumerate(object)]
    if type(object) is str:
        if prefix.endswith(".content") or prefix.endswith(".function.name") or ".function.arguments" in prefix:
            # split by ' ' or '\n' and create a list of tokens
            return [{"token": token, "address": prefix + "." + str(i)} for i, token in enumerate(split(object, r"[\n]+"))]
    return object

def split(text, pattern):
    """
    Splits by pattern, but does not remove the pattern.

    Example:
    split("hello world", r"[\s]+") -> ["hello", " ", "world"]
    """
    def generator():
        nonlocal text
        while True:
            match = re.search(pattern, text)
            if match is None:
                break
            yield text[:match.end()]
            text = text[match.end():]
        yield text
    result = [t for t in generator()]
    return result

@trace.post("/{id}/annotate")
async def annotate_trace(request: Request, id: str):
    try:
        userid = request.state.userinfo["sub"]
        if userid is None:
            raise HTTPException(status_code=401, detail="Unauthorized request")
        
        with Session(db()) as session:
            trace = session.query(Trace).filter(Trace.id == id).first()
            
            if trace is None:
                raise HTTPException(status_code=404, detail="Trace not found")
            
            dataset = session.query(Dataset).filter(Dataset.id == trace.dataset_id).first()
            
            if dataset.user_id != userid:
                raise HTTPException(status_code=401, detail="Unauthorized annotate")
            
            payload = await request.json()
            content = payload.get("content")
            address = payload.get("address")
            
            annotation = Annotation(
                id=uuid.uuid4(),
                trace_id=trace.id,
                user_id=userid,
                address=address,
                content=str(content),
                extra_metadata=json.dumps({
                    "created_on": str(datetime.datetime.now())
                })
            )
            
            session.add(annotation)
            session.commit()
            
            return {
                "id": annotation.id,
                "content": content,
                "address": address
            }
    except Exception as e:
        import traceback
        traceback.print_exc()
        if type(e) == HTTPException:
            raise e
        raise HTTPException(status_code=500, detail="Failed to annotate trace")

@trace.get("/{id}/annotations")
def get_annotations(request: Request, id: str):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    with Session(db()) as session:
        trace = session.query(Trace).filter(Trace.id == id).first()
        
        if trace is None:
            raise HTTPException(status_code=404, detail="Trace not found")
        
        dataset = session.query(Dataset).filter(Dataset.id == trace.dataset_id).first()
        
        if dataset.user_id != userid:
            raise HTTPException(status_code=401, detail="Unauthorized get")
        
        annotations = session.query(Annotation).filter(Annotation.trace_id == id).all()
        
        return [{
            "id": annotation.id,
            "content": annotation.content,
            "address": annotation.address,
            "extra_metadata": annotation.extra_metadata
        } for annotation in annotations]
    
@trace.delete("/{id}/annotation/{annotation_id}")
def delete_annotation(request: Request, id: str, annotation_id: str):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    with Session(db()) as session:
        trace = session.query(Trace).filter(Trace.id == id).first()
        
        if trace is None:
            raise HTTPException(status_code=404, detail="Trace not found")
        
        dataset = session.query(Dataset).filter(Dataset.id == trace.dataset_id).first()
        
        if dataset.user_id != userid:
            raise HTTPException(status_code=401, detail="Unauthorized delete")
        
        annotation = session.query(Annotation).filter(Annotation.id == annotation_id).first()
        
        if annotation is None:
            raise HTTPException(status_code=404, detail="Annotation not found")
        
        session.delete(annotation)
        session.commit()
        
        return {"message": "deleted"}
    
# update annotation
@trace.put("/{id}/annotation/{annotation_id}")
async def update_annotation(request: Request, id: str, annotation_id: str):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    try:
        with Session(db()) as session:
            trace = session.query(Trace).filter(Trace.id == id).first()
            
            if trace is None:
                raise HTTPException(status_code=404, detail="Trace not found")
            
            dataset = session.query(Dataset).filter(Dataset.id == trace.dataset_id).first()
            
            if dataset.user_id != userid:
                raise HTTPException(status_code=401, detail="Unauthorized update")
            
            annotation = session.query(Annotation).filter(Annotation.id == annotation_id).first()
            
            if annotation is None:
                raise HTTPException(status_code=404, detail="Annotation not found")
            
            payload = await request.json()
            content = payload.get("content")
            
            annotation.content = content
            session.commit()
            
            return {
                "id": annotation.id,
                "content": content,
                "address": annotation.address
            }
    except Exception as e:
        import traceback
        traceback.print_exc()
        if type(e) == HTTPException:
            raise e
        raise HTTPException(status_code=500, detail="Failed to update annotation")