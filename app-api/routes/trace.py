import uuid

from sqlalchemy.orm import Session
from sqlalchemy.dialects.sqlite import insert as sqlite_upsert

from fastapi import FastAPI, Request, HTTPException

from models.datasets_and_traces import Dataset, db, Trace, Annotation, SharedLinks, User
from models.queries import *

trace = FastAPI()

@trace.get("/{id}")
def get_trace(request: Request, id: str, annotated:bool=False):
    user_id = request.state.userinfo["sub"]
    if user_id is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    with Session(db()) as session:
        trace = load_trace(session, id, user_id, allow_public=True, allow_shared=True)
        return trace_to_json(trace, load_annoations(session, id))
        
@trace.get("/{id}/shared")
def get_trace_sharing(request: Request, id: str):
    user_id = request.state.userinfo["sub"]
    if user_id is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    return {"shared": has_link_sharing(id)}

@trace.put("/{id}/shared")
def share_trace(request: Request, id: str):
    user_id = request.state.userinfo["sub"]
    if user_id is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    with Session(db()) as session:
        trace = load_trace(id, session) # load trace to check for auth
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
    user_id = request.state.userinfo["sub"]
    if user_id is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    with Session(db()) as session:
        trace = load_trace(id, session) # load trace to check for auth
        shared_link = session.query(SharedLinks).filter(SharedLinks.trace_id == id).first()
        
        if shared_link is not None:
            session.delete(shared_link)
            session.commit()
        
        return {"shared": False}

# add a new annotation to a trace
@trace.post("/{id}/annotate")
async def annotate_trace(request: Request, id: str):
    user_id = request.state.userinfo["sub"]
    if user_id is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    with Session(db()) as session:
        trace = load_trace(session, id, user_id, allow_public=True, allow_shared=True) # load trace to check for auth
        # get address and content from request
        payload = await request.json()
        content = payload.get("content")
        address = payload.get("address")

        save_user(session, request.state.userinfo)

        annotation = Annotation(
            trace_id=trace.id,
            user_id=user_id,
            address=address,
            content=str(content))

        session.add(annotation)
        session.commit()
        return annotation_to_json(annotation)

# get all annotations of a trace
@trace.get("/{id}/annotations")
def get_annotations(request: Request, id: str):
    user_id = request.state.userinfo["sub"]
    if user_id is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    with Session(db()) as session:
        trace = load_trace(session, id, user_id, allow_public=True, allow_shared=True) # load trace to check for auth
        return [annotation_to_json(a, u) for a, u in load_annoations(session, id)]

# delete annotation
@trace.delete("/{id}/annotation/{annotation_id}")
def delete_annotation(request: Request, id: str, annotation_id: str):
    user_id = request.state.userinfo["sub"]
    if user_id is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    with Session(db()) as session:
        trace = load_trace(session, id, user_id, allow_public=True, allow_shared=True) # load trace to check for auth
        annotation = session.query(Annotation).filter(Annotation.id == annotation_id).first()
        
        if annotation is None:
            raise HTTPException(status_code=404, detail="Annotation not found")
            
        if str(annotation.user_id) != user_id:
            raise HTTPException(status_code=401, detail="Unauthorized delete")
           
        session.delete(annotation)
        session.commit()
        
        return {"message": "deleted"}
    
# update annotation
@trace.put("/{id}/annotation/{annotation_id}")
async def update_annotation(request: Request, id: str, annotation_id: str):
    user_id = request.state.userinfo["sub"]
    if user_id is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    
    with Session(db()) as session:
        trace = load_trace(session, id, user_id, allow_public=True, allow_shared=True) # load trace to check for auth
        annotation, user = session.query(Annotation, User).filter(Annotation.id == annotation_id).join(User, Annotation.user_id == User.id).first()
        
        if annotation is None:
            raise HTTPException(status_code=404, detail="Annotation not found")
            
        if str(annotation.user_id) != user_id:
            raise HTTPException(status_code=401, detail="Unauthorized delete")
       
        payload = await request.json()
        content = payload.get("content")
        
        annotation.content = content
        session.commit()
        return annotation_to_json(annotation, user)