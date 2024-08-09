import hashlib
import os
import re
import uuid
import json
import datetime

from sqlalchemy.orm import Session
from fastapi import FastAPI, Request, HTTPException

from models.datasets_and_traces import Dataset, db, Trace, Annotation, SharedLinks

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
        
        if dataset.user_id != userid and not (userid == 'anonymous' and has_link_sharing(id)):
            raise HTTPException(status_code=401, detail="Unauthorized get")
        
        return {
            "id": trace.id,
            "index": trace.index,
            "messages": message_load(trace.content),
            "dataset": trace.dataset_id,
            "extra_metadata": trace.extra_metadata
        }

@trace.get("/{id}/shared")
def get_trace_sharing(request: Request, id: str):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    return {"shared": has_link_sharing(id)}

def has_link_sharing(trace_id):
    try:
        with Session(db()) as session:
            trace = session.query(SharedLinks).filter(SharedLinks.trace_id == trace_id).first()
            return trace is not None
    except Exception as e:
        import traceback
        traceback.print_exc()
        print("failed to check if trace is shared", e)
        return False

@trace.put("/{id}/shared")
def share_trace(request: Request, id: str):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    with Session(db()) as session:
        trace = session.query(Trace).filter(Trace.id == id).first()
        
        if trace is None:
            raise HTTPException(status_code=404, detail="Trace not found")
        
        dataset = session.query(Dataset).filter(Dataset.id == trace.dataset_id).first()
        
        if dataset.user_id != userid:
            raise HTTPException(status_code=401, detail="Unauthorized share")
        
        shared_link = session.query(SharedLinks).filter(SharedLinks.trace_id == id).first()
        
        if shared_link is None:
            shared_link = SharedLinks(
                id=uuid.uuid4(),
                trace_id=id
            )
            session.add(shared_link)
            session.commit()
        
        return {"shared": True}

@trace.delete("/{id}/shared")
def unshare_trace(request: Request, id: str):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    with Session(db()) as session:
        trace = session.query(Trace).filter(Trace.id == id).first()
        
        if trace is None:
            raise HTTPException(status_code=404, detail="Trace not found")
        
        dataset = session.query(Dataset).filter(Dataset.id == trace.dataset_id).first()
        
        if dataset.user_id != userid:
            raise HTTPException(status_code=401, detail="Unauthorized unshare")
        
        shared_link = session.query(SharedLinks).filter(SharedLinks.trace_id == id).first()
        
        if shared_link is not None:
            session.delete(shared_link)
            session.commit()
        
        return {"shared": False}

def message_load(content):
    """
    Loads the messages of a trace and chunks all string leaves into {"token": "string", "address": "address"} objects,
    that can be used as annotation anchors.
    """
    try:
        messages = json.loads(content)
        messages = [translate_leaves_to_annotation_anchors(message, prefix=f"message[{i}]") for i, message in enumerate(messages)]
        return messages
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"role": "system", "content": "failed to load message data"}
    
def translate_leaves_to_annotation_anchors(object, prefix=""):
    if type(object) is dict:
        return {k: translate_leaves_to_annotation_anchors(v, prefix + "." + k) if k != 'role' else v for k, v in object.items()}
    if type(object) is list:
        return [translate_leaves_to_annotation_anchors(v, prefix + "[" + str(i) + "]") for i, v in enumerate(object)]
    if type(object) is str:
        if prefix.endswith(".content") or prefix.endswith(".function.name") or ".function.arguments" in prefix:
            # split by ' ' or '\n' and create a list of tokens
            return [{"token": token, "address": prefix + "." + str(i)} for i, token in enumerate(split(object, r"[\n]+"))]
    return object

def split(text, pattern):
    """
    Splits by pattern, but does not remove the pattern.

    Example:
    split("hello world", r"[\s]+") -> ["hello ", "world"]
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

# add a new annotation to a trace
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
            
            # get address and content from request
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

# get all annotations of a trace
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
        
        if dataset.user_id != userid and not (userid == 'anonymous' and has_link_sharing(id)):
            raise HTTPException(status_code=401, detail="Unauthorized get")
        
        annotations = session.query(Annotation).filter(Annotation.trace_id == id).all()
        
        return [{
            "id": annotation.id,
            "content": annotation.content,
            "address": annotation.address,
            "extra_metadata": annotation.extra_metadata
        } for annotation in annotations]

# delete annotation
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