"""
The push API is used to upload traces to the server programmatically (API key authentication required).
"""
import base64
import boto3
import json
import logging
import os
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

from PIL import Image
import io

from util.util import validate_dataset_name
from util.validation import validate_annotation, validate_trace


push = FastAPI()
logger = logging.getLogger(__name__)

def parse_and_push_images(dataset, trace_id, messages):
    for msg in messages:
        if msg.get("role") != "tool" or type(msg.get("content")) != str:
            continue
        if msg.get("content").startswith("base64_img: ") or msg.get("content").startswith("local_base64_img: "):
            prefix = "base64_img: " if msg.get("content").startswith("base64_img: ") else "local_base64_img: "
            img_base64 = msg.get("content")[len(prefix):]
            
            img_data = base64.b64decode(img_base64)
            img = Image.open(io.BytesIO(img_data))

            # Generate a unique filename for the image
            img_filename = f"{dataset}/{trace_id}/{uuid.uuid4()}.png"
            # Save the image as a temporary file
            with io.BytesIO() as output:
                img.save(output, format="PNG")
                img_data = output.getvalue()
            
            if prefix == "base64_img: ":
                s3_client = boto3.client('s3')
                bucket_name = 'invariant-explorer-imgs' if os.getenv("DEV_MODE") != "true" else 'invariant-explorer-imgs-dev'
                
                try:
                    s3_client.put_object(Bucket=bucket_name, Key=img_filename, Body=img_data)
                    logger.info(f"Successfully uploaded image to S3: {img_filename}")
                    img_path = f"s3://{bucket_name}/{img_filename}"
                except Exception as e:
                    logger.error(f"Error uploading image to S3: {e}")
                    img_path = "Error: Failed to upload image"
                msg["content"] = "s3_img_link: " + img_path
            else:
                img_path = f"/srv/images/{img_filename}"
                os.makedirs(os.path.dirname(img_path), exist_ok=True)
                with open(img_path, "wb") as f:
                    f.write(img_data)
                msg["content"] = "local_img_link: " + img_path
    return messages


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
    validate_dataset_name(dataset_name)

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
            trace_id = uuid.uuid4()
            message_content = msg
            message_content = parse_and_push_images(dataset_name, trace_id, message_content)
            message_metadata = metadata[i]

            trace = Trace(
                id=trace_id,
                dataset_id=dataset_id,
                index=(next_index + i) if dataset_id else 0,
                name = message_metadata.get("name", f"Run {next_index + i}"),
                hierarchy_path = message_metadata.get("hierarchy_path", []),
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
            **({"dataset": dataset.name} if dataset_id else {}),
            "username": userinfo.get("username"),
        }