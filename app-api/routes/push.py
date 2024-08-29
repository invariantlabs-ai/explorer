"""
The push API is used to upload traces to the server programmatically (API key authentication required).
"""

from fastapi import FastAPI
from sqlalchemy.orm import Session
import uuid

from routes.apikeys import APIIdentity
from models.datasets_and_traces import db, Trace
from models.queries import load_trace, load_dataset

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
    userid = userinfo.get("sub")
    
    # extract payload
    payload = await request.json()
    
    messages = payload.get("messages")
    annotations = payload.get("annotations")
    dataset = payload.get("dataset", None)
    metadata = payload.get("metadata")

    # check messages
    assert type(messages) == list, "messages must be a list of messages"
    assert len(messages) > 0, "messages must not be empty"
    assert all(type(msg) == list for msg in messages), "messages must be a list of traces"

    # check other properties
    assert annotations is None or type(annotations) == list, "annotations must be a list of annotations"
    assert dataset is None or type(dataset) == str, "dataset must be a string"
    assert metadata is None or type(metadata) == list, "metadata must be a list of metadata"

    # make sure if present that messages, annotations, and metadata are all the same length
    if annotations is not None:
        assert len(annotations) == len(messages), "annotations must be the same length as messages"
    if metadata is not None:
        assert len(metadata) == len(messages), "metadata must be the same length as messages"

    # annotations are currently not supported
    if annotations is not None:
        raise HTTPException(status_code=400, detail="annotations are not supported yet")

    # make sure metadata is a list of dictionaries
    metadata = [md if md is not None else {} for md in metadata] if metadata else [{} for _ in messages]
    # mark API key id that was used to upload the trace
    for md in metadata: md["uploader"] = "Via API " + str(userinfo.get("apikey"))

    with Session(db()) as session:
        next_index = 0
        dataset_id = None
        
        if dataset is not None:
            # resolve dataset by name and user
            dataset = load_dataset(session, {'User.username': userinfo.get("username"), 'name': dataset}, str(userid), allow_public=False, return_user=False)
            # make sure dataset exists and is accessible to user
            if dataset is None: raise HTTPException(status_code=404, detail="Dataset not found")

            # determine next index
            next_index = (session.query(Trace.index).filter(Trace.dataset_id == dataset.id).order_by(Trace.index.desc()).first() or (0,))[0] + 1
            dataset_id = dataset.id

        result_ids = []

        for i, msg in enumerate(messages):
            message_content = json.dumps(msg)
            message_metadata = json.dumps(metadata[i])

            trace = Trace(
                id=uuid.uuid4(),
                dataset_id=dataset_id,
                index=(next_index + i) if dataset_id else 0,
                user_id=userid,
                content=message_content,
                extra_metadata=message_metadata
            )

            session.add(trace)
            result_ids.append(str(trace.id))
        
        session.commit()
        
        return {
            "id": result_ids,
            **({"dataset": dataset.name} if dataset else {})
        }