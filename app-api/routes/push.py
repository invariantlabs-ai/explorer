"""
The push API is used to upload traces to the server programmatically (API key authentication required).
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Annotated

import sqlalchemy as sa
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import HTTPException
from logging_config import get_logger
from models.datasets_and_traces import Annotation, Trace, db
from routes.apikeys import APIIdentity
from routes.user import user_by_id
from sqlalchemy.orm import Session
from util.util import parse_and_update_messages, validate_dataset_name
from util.validation import validate_annotation, validate_trace

push = FastAPI()
logger = get_logger(__name__)

"""
Write-only API endpoint to push traces to the server.
"""


@push.post("/trace")
async def push_trace(
    request: Request, user_id: Annotated[uuid.UUID, Depends(APIIdentity)]
):
    # extract payload
    payload = await request.json()
    user = user_by_id(user_id)
    # extract api_key
    apikey = request.headers.get("Authorization")

    messages = payload.get("messages")
    annotations = payload.get("annotations")
    dataset_name = payload.get("dataset", None)
    metadata = payload.get("metadata")

    try:
        assert apikey is not None, "API key must be provided in the headers"
        # check messages
        assert isinstance(messages, list), "messages must be a list of traces"
        assert len(messages) > 0, "messages must not be empty"
        assert all(
            isinstance(msg, list) for msg in messages
        ), "messages must be a list of traces"

        # check other properties
        assert annotations is None or isinstance(
            annotations, list
        ), "annotations must be a list of annotations"
        assert dataset_name is None or isinstance(
            dataset_name, str
        ), "dataset name must be a string"
        assert metadata is None or isinstance(
            metadata, list
        ), "metadata must be a list of metadata"

        # make sure if present that messages, annotations, and metadata are all the same length
        if annotations is not None:
            assert len(annotations) == len(
                messages
            ), "annotations must be the same length as messages"
        if metadata is not None:
            assert len(metadata) == len(
                messages
            ), "metadata must be the same length as messages"
    except AssertionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    validate_dataset_name(dataset_name)

    # make sure metadata is a list of dictionaries
    metadata = (
        [md if md is not None else {} for md in metadata]
        if metadata
        else [{} for _ in messages]
    )
    # mark API key id that was used to upload the trace
    for md in metadata:
        md["uploader"] = "Via API " + "..." + str(apikey[-5:])

    traces = []
    try:
        with Session(db()) as session:
            dataset_id = None
            result_ids = []
            try:
                if dataset_name is not None:
                    # Utilize Postgres's RETURNING clause to handle race conditions
                    # to handle concurrent dataset creation attempts
                    dataset_id = session.execute(
                        sa.text("""
                            INSERT INTO datasets (id, user_id, name, is_public, time_created, extra_metadata)
                            VALUES (:id, :user_id, :name, :is_public, :time_created, :extra_metadata)
                            ON CONFLICT (user_id, name)
                            DO UPDATE SET id = datasets.id
                            RETURNING id
                        """),
                        {
                            "id": str(uuid.uuid4()),
                            "user_id": str(user_id),
                            "name": dataset_name,
                            "is_public": False,
                            "time_created": datetime.now(timezone.utc),
                            "extra_metadata": json.dumps({}),
                        },
                    ).scalar()

                    session.commit()

                    if dataset_id is None:
                        dataset_id = session.execute(
                            sa.text("""
                                SELECT id FROM datasets WHERE user_id = :user_id AND name = :name
                            """),
                            {"user_id": str(user_id), "name": dataset_name},
                        ).scalar()

                async def parse_single_message_to_trace(message, i):
                    trace_id = uuid.uuid4()
                    message_content = await parse_and_update_messages(
                        dataset_name, trace_id, message
                    )
                    message_metadata = metadata[i]
                    trace = Trace(
                        id=trace_id,
                        dataset_id=dataset_id,
                        name=message_metadata.get("name"),
                        hierarchy_path=message_metadata.get("hierarchy_path", []),
                        user_id=user_id,
                        content=message_content,
                        extra_metadata=message_metadata,
                    )
                    try:
                        validate_trace(trace)
                    except Exception as e:
                        # TODO: For now we just warn instead of throwing an error
                        logger.warning(f"Error validating trace {i}: {str(e)}")
                    return trace

                parse_messages_to_traces = [
                    parse_single_message_to_trace(message, i)
                    for i, message in enumerate(messages)
                ]
                traces = await asyncio.gather(*parse_messages_to_traces)

                for trace in traces:
                    session.add(trace)
                    result_ids.append(str(trace.id))

                session.commit()

                if annotations is not None:
                    for i, trace_annotations in enumerate(annotations):
                        for ann in trace_annotations:
                            new_annotation = Annotation(
                                trace_id=result_ids[i],
                                user_id=user_id,
                                content=ann["content"],
                                address=ann["address"],
                                extra_metadata=ann.get("extra_metadata", None),
                            )
                            try:
                                validate_annotation(new_annotation, traces[i])
                            except Exception as e:
                                # TODO: For now we just warn instead of throwing an error
                                logger.warning(
                                    f"Error validating annotation {i}: {str(e)}"
                                )
                            session.add(new_annotation)

                session.commit()
                return {
                    "id": result_ids,
                    **({"dataset": dataset_name} if dataset_id else {}),
                    "username": user.username,
                }
            except Exception:
                # Explicit rollback in case of any exceptions during the transaction
                session.rollback()
                raise

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
