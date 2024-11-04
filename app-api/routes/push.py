"""
The push API is used to upload traces to the server programmatically (API key authentication required).
"""
import json
import logging
import uuid

from invariant.runtime.input import Input
from fastapi import FastAPI
from sqlalchemy.orm import Session
from routes.apikeys import APIIdentity
from models.datasets_and_traces import db, Dataset, Trace, Annotation
from models.queries import load_trace, load_dataset
from typing import Annotated
from fastapi import Request, Depends
from fastapi.exceptions import HTTPException

from util.validation import validate_annotation, validate_trace


push = FastAPI()
logger = logging.getLogger(__name__)

"""
Write-only API endpoint to push traces to the server.
"""
@push.post("/trace")
async def push_trace(request: Request, userinfo: Annotated[dict, Depends(APIIdentity)]):
    assert userinfo.get("sub") is not None, "cannot resolve API key to user identity"
    userid = userinfo.get("sub")
    
    # extract payload
    payload = await request.json()
    
    messages = payload.get("messages")
    annotations = payload.get("annotations")
    dataset_name = payload.get("dataset", None)
    metadata = payload.get("metadata")

    try:
        # check messages
        assert type(messages) == list, "messages must be a list of messages"
        assert len(messages) > 0, "messages must not be empty"
        assert all(type(msg) == list for msg in messages), "messages must be a list of traces"

        # check other properties
        assert annotations is None or type(annotations) == list, "annotations must be a list of annotations"
        assert dataset_name is None or type(dataset_name) == str, "dataset name must be a string"
        assert metadata is None or type(metadata) == list, "metadata must be a list of metadata"
        
        # make sure if present that messages, annotations, and metadata are all the same length
        if annotations is not None:
            assert len(annotations) == len(messages), "annotations must be the same length as messages"
        if metadata is not None:
            assert len(metadata) == len(messages), "metadata must be the same length as messages"
    except AssertionError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # make sure metadata is a list of dictionaries
    metadata = [md if md is not None else {} for md in metadata] if metadata else [{} for _ in messages]
    # mark API key id that was used to upload the trace
    for md in metadata: md["uploader"] = "Via API " + str(userinfo.get("apikey"))

    traces = []
    with Session(db()) as session:
        next_index = 0
        dataset_id = None

        if dataset_name is not None:
            # Resolve dataset by name and user.
            try:
                dataset = load_dataset(
                    session,
                    {"User.username": userinfo.get("username"), "name": dataset_name},
                    str(userid),
                    allow_public=False,
                    return_user=False,
                )
                # Determine the next index for the traces.
                next_index = (
                    session.query(Trace.index)
                    .filter(Trace.dataset_id == dataset.id)
                    .order_by(Trace.index.desc())
                    .first()
                    or (0,)
                )[0] + 1
            except HTTPException as e:
                # If the dataset is not found, create the dataset.
                if e.status_code == 404 and e.detail == "Dataset not found":
                    dataset = Dataset(
                        id=uuid.uuid4(),
                        user_id=str(userid),
                        name=dataset_name,
                        extra_metadata=dict(),
                    )
                    session.add(dataset)
                    next_index = 1
                else:
                    raise e
            dataset_id = dataset.id

        result_ids = []
        for i, msg in enumerate(messages):
            message_content = msg
            message_metadata = metadata[i]

            trace = Trace(
                id=uuid.uuid4(),
                dataset_id=dataset_id,
                index=(next_index + i) if dataset_id else 0,
                user_id=userid,
                content=message_content,
                extra_metadata=message_metadata
            )
            try:
                validate_trace(trace)
            except Exception as e:
                # TODO: For now we just warn instead of throwing an error
                logger.warning(f"Error validating trace {i}: {str(e)}")
            traces.append(trace)
            session.add(trace)
            result_ids.append(str(trace.id))

        session.commit()

        if annotations is not None:
            for i, trace_annotations in enumerate(annotations):
                print("annotations", trace_annotations)
                for ann in trace_annotations:
                    new_annotation = Annotation(
                        trace_id=result_ids[i],
                        user_id=userid,
                        content=ann["content"],
                        address=ann["address"],
                        extra_metadata=ann.get("extra_metadata", None),
                    )
                    try:
                        validate_annotation(new_annotation, traces[i])
                    except Exception as e:
                        # TODO: For now we just warn instead of throwing an error
                        logger.warning(f"Error validating annotation {i}: {str(e)}")
                    session.add(new_annotation)
        
        session.commit()
        
        return {
            "id": result_ids,
            **({"dataset": dataset.name} if dataset_id else {})
        }