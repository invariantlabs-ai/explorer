"""
The push API is used to upload traces to the server programmatically (API key authentication required).
"""

from fastapi import FastAPI
from sqlalchemy.orm import Session

from routes.apikeys import APIIdentity
from models.datasets_and_traces import db, Trace
from models.queries import load_trace

from typing import Annotated
from fastapi import Request, Depends
from fastapi.exceptions import HTTPException

import json

push = FastAPI()

"""
Write only API endpoint to push traces to the server.
"""
@push.post("/trace")
async def push_trace(request: Request, userinfo: Annotated[dict, Depends(APIIdentity)]):
    assert userinfo.get("sub") is not None, "cannot resolve API key to user identity"
    payload = await request.json()
    
    messages = payload.get("messages")
    annotations = payload.get("annotations")
    dataset_id = payload.get("dataset_id", None)
    
    if dataset_id is not None:
        raise HTTPException(status_code=400, detail="dataset_id is not supported yet")
    
    if annotations is not None:
        raise HTTPException(status_code=400, detail="annotations are not supported yet")

    metadata = payload.get("metadata")
    metadata = json.loads(metadata) if metadata else {}
    # mark API key id that was used to upload the trace
    metadata["uploader"] = "Via API " + str(userinfo.get("apikey"))

    with Session(db()) as session:
        payload = await request.json()
        
        trace = Trace(
            dataset_id=None,
            index=0,
            user_id=userinfo.get("sub"),
            content=json.dumps(messages) if type(messages) != str else messages,
            extra_metadata=json.dumps(metadata)
        )
        
        session.add(trace)
        session.commit()
        
        return {
            "id": str(trace.id),
            "num_messages": len(messages) if messages else 0,
        }