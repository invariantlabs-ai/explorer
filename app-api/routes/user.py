import json
from typing import Any

from fastapi import Depends, Request, FastAPI
from typing import Annotated

from sqlalchemy import func, and_, or_
from sqlalchemy.orm import Session

from util.util import get_gravatar_hash

from models.datasets_and_traces import User, db, Dataset
from models.queries import *

from routes.auth import UserIdentity, AuthenticatedUserIdentity

user = FastAPI()

@user.get("/info")
def get_user(userinfo: Annotated[dict, Depends(UserIdentity)]):
    return {
        "id": userinfo['sub'],
        "username": userinfo['preferred_username'],
        "email": userinfo['email'],
        "name": userinfo['name'],
        "image_url_hash": get_gravatar_hash(userinfo['email'])
    }

@user.post("/signup")
def signup(request: Request, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    with Session(db()) as session:
        save_user(session, userinfo)
        session.commit()

    return {
        "success": True
    }
    
@user.get("/events")
def events(request: Request, userinfo: Annotated[dict, Depends(UserIdentity)], limit:int=20):
    user_id = userinfo['sub']
    
    # events are:
    # - public dataset is created
    # - new comment on a trace
    # - new reply to a comment
    # - newly shared trace
    
    with Session(db()) as session:
        # get get up to <limit> many of each type of event, and then choose the top <limit> events in python
        # this this is easier than the pure SQL version, and should be fine for now
        events = [] 
      
        # public datasets (from other users) 
        datasets = session.query(Dataset, User).filter(and_(Dataset.is_public, Dataset.user_id != user_id)).join(User, User.id == Dataset.user_id).order_by(Dataset.id.desc()).limit(limit).all()
        for dataset, user in datasets:
            events.append({
                "time": dataset.time_created,
                "text": "Dataset created",
                "type": "dataset",
                "user": user_to_json(user),
                "details": dataset_to_json(dataset)
            })
            
        # annotations/comments on datasets visible to the user
        annotations = session.query(Annotation, Trace, User)\
            .join(User, User.id == Annotation.user_id)\
            .join(Trace, Annotation.trace_id == Trace.id)\
            .join(Dataset, Trace.dataset_id == Dataset.id, isouter=True)\
            .join(SharedLinks, Trace.id == SharedLinks.trace_id, isouter=True)\
            .filter(and_(Annotation.user_id != user_id,
                         or_(Dataset.is_public, # public dataset
                             Dataset.user_id == user_id, # user's own dataset,
                             Trace.user_id == user_id, # user's own trace
                             SharedLinks.id != None # trace is shared
                             )))\
            .order_by(Annotation.time_created.desc())\
            .limit(limit).all()
        for annotation, trace, user in annotations:
            events.append({
                "time": annotation.time_created,
                "text": "New Annotation",
                "type": "annotation",
                "user": user_to_json(user),
                "details": annotation_to_json(annotation, trace=trace_to_json(trace))
            })
            
        # new trace
        # TODO: add snippet traces @Luca, this will depend on how they are stored wrt to dataset
        
        # newly shared trace
        traces = session.query(Trace, User, SharedLinks)\
            .join(User, User.id == Trace.user_id)\
            .join(SharedLinks, Trace.id == SharedLinks.trace_id)\
            .filter(and_(Trace.user_id != user_id))\
            .order_by(SharedLinks.time_created.desc())\
            .limit(limit).all()
        for trace, user, shared_link in traces:
            events.append({
                "time": shared_link.time_created,
                "text": "Trace shared",
                "type": "trace",
                "user": user_to_json(user),
                "details": trace_to_json(trace)
            })
            
        # sort events by time
        events = sorted(events, key=lambda e: e['time'], reverse=True)
        # take the top <limit> events
        events = events[:limit]
        
        return events

       
   
   