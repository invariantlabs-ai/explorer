import uuid
import datetime

from sqlalchemy.orm import Session
from sqlalchemy.dialects.sqlite import insert as sqlite_upsert

from fastapi import FastAPI, Request, HTTPException, Depends

from typing import Annotated
from routes.auth import UserIdentity, AuthenticatedUserIdentity

from models.datasets_and_traces import Dataset, db, Trace, Annotation, SharedLinks, User
from models.queries import *

trace = FastAPI()

@trace.get("/snippets")
def get_trace_snippets(request: Request, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    user_id = userinfo["sub"]

    limit = request.query_params.get("limit")
    limit = limit if limit != '' else None
    
    # gets a users trace snippets (traces without a dataset)
    with Session(db()) as session:
        traces = session.query(Trace).filter(Trace.user_id == user_id, Trace.dataset_id == None).order_by(Trace.time_created.desc()).limit(limit).all()
        return [trace_to_json(t, tokenize=False) for t in traces]

@trace.delete("/{id}")
def delete_trace(id: str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    user_id = userinfo["sub"]
    
    with Session(db()) as session:
        # can only delete own traces
        trace = load_trace(session, id, user_id, allow_public=False, allow_shared=False)

        # delete shared link if it exists
        session.query(SharedLinks).filter(SharedLinks.trace_id == id).delete()
        # delete annotations
        session.query(Annotation).filter(Annotation.trace_id == id).delete()
        # delete trace
        session.delete(trace)
        
        session.commit()
        
        return {"message": "deleted"}

@trace.get("/{id}")
def get_trace(request: Request, id: str, annotated:bool=False, userinfo: Annotated[dict, Depends(UserIdentity)] = None):
    # may be None for anonymous users
    user_id = userinfo["sub"]
    
    with Session(db()) as session:
        trace, user = load_trace(session, id, user_id, allow_public=True, allow_shared=True, return_user=True)
        return trace_to_json(trace, load_annoations(session, id), user=user.username, tokenize=False)
        
@trace.get("/{id}/shared")
def get_trace_sharing(request: Request, id: str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    # never None (always authenticated)
    user_id = userinfo["sub"]
    
    with Session(db()) as session:
        return {"shared": has_link_sharing(session, id)}

@trace.put("/{id}/shared")
def share_trace(request: Request, id: str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    # never None (always authenticated)
    user_id = userinfo["sub"]
    
    with Session(db()) as session:
        trace = load_trace(session, id, user_id) # load trace to check for auth
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
def unshare_trace(request: Request, id: str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    user_id = userinfo["sub"]
    
    with Session(db()) as session:
        trace = load_trace(session, id, user_id) # load trace to check for auth
        shared_link = session.query(SharedLinks).filter(SharedLinks.trace_id == id).first()
        
        if shared_link is not None:
            session.delete(shared_link)
            session.commit()
        
        return {"shared": False}

# add a new annotation to a trace
@trace.post("/{id}/annotate")
async def annotate_trace(request: Request, id: str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    user_id = userinfo["sub"]
    
    with Session(db()) as session:
        trace = load_trace(session, id, user_id, allow_public=True, allow_shared=True) # load trace to check for auth
        # get address and content from request
        payload = await request.json()
        content = payload.get("content")
        address = payload.get("address")

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
def get_annotations(request: Request, id: str, userinfo: Annotated[dict, Depends(UserIdentity)]):
    # may be None for anons
    user_id = userinfo["sub"]
    
    with Session(db()) as session:
        trace = load_trace(session, id, user_id, allow_public=True, allow_shared=True) # load trace to check for auth
        return [annotation_to_json(a, u) for a, u in load_annoations(session, id)]

# delete annotation
@trace.delete("/{id}/annotation/{annotation_id}")
def delete_annotation(request: Request, id: str, annotation_id: str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    user_id = userinfo["sub"]
    
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
async def update_annotation(request: Request, id: str, annotation_id: str, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    user_id = userinfo["sub"]
    
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
    
@trace.post("/snippets/new")
async def upload_new_single_trace(request: Request, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    user_id = userinfo["sub"]
    
    with Session(db()) as session:
        payload = await request.json()
        content = payload.get("content")
        extra_metadata = payload.get("extra_metadata")
        
        trace = Trace(
            dataset_id=None,
            index=0,
            user_id=user_id,
            content=content,
            extra_metadata=str(extra_metadata)
        )
        
        session.add(trace)
        session.commit()
        
        return {
            "id": str(trace.id)
        }