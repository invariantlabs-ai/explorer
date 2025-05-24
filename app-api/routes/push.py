"""
The push API is used to upload traces to the server programmatically (API key authentication required).
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Annotated, List, Dict, Any, Optional

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from fastapi import Depends, FastAPI, Request, BackgroundTasks, Query
from fastapi.exceptions import HTTPException
from logging_config import get_logger
from models.datasets_and_traces import Annotation, Trace, db, Dataset
from app_api.models.importers import import_otel_trace
from routes.apikeys import APIIdentity
from routes.user import user_by_id
from routes.dataset_metadata import extract_and_save_batch_tool_calls
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
    request: Request,
    background_tasks: BackgroundTasks,
    user_id: Annotated[uuid.UUID, Depends(APIIdentity)],
    format: str = Query("jsonl", enum=["jsonl", "otel"]),
):
    # extract payload
    payload = await request.json()
    user = user_by_id(user_id)
    # extract api_key
    apikey = request.headers.get("Authorization")

    messages = payload.get("messages")
    annotations = payload.get("annotations")
    dataset_name_req = payload.get("dataset", None) # Requested dataset name
    payload_metadata = payload.get("metadata") # This is a list in current JSONL, potentially just one dict for OTEL dataset

    try:
        assert apikey is not None, "API key must be provided in the headers"
        assert isinstance(messages, list), "messages must be a list"
        assert len(messages) > 0, "messages must not be empty"

        if format == "jsonl":
            assert all(
                isinstance(msg, list) for msg in messages
            ), "For 'jsonl' format, messages must be a list of traces (lists of events)"
            # check other properties for JSONL
            assert annotations is None or isinstance(
                annotations, list
            ), "annotations must be a list of annotations"
            assert payload_metadata is None or isinstance(
                payload_metadata, list
            ), "metadata must be a list of metadata objects"
            if annotations is not None:
                assert len(annotations) == len(
                    messages
                ), "annotations must be the same length as messages"
            if payload_metadata is not None:
                assert len(payload_metadata) == len(
                    messages
                ), "metadata must be the same length as messages"
        elif format == "otel":
            assert all(
                isinstance(msg, str) for msg in messages
            ), "For 'otel' format, messages must be a list of JSON strings (OTELSpans)"
            # For OTEL, annotations from payload are ignored for now.
            # payload_metadata for OTEL could be a single dict for the dataset, or per-span.
            # For now, we'll pass the first item if it's a list, or the dict itself.

        assert dataset_name_req is None or isinstance(
            dataset_name_req, str
        ), "dataset name must be a string"
        
    except AssertionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    if dataset_name_req: # Ensure dataset_name is validated if provided
        validate_dataset_name(dataset_name_req)

    # Prepare metadata for traces (JSONL) or dataset (OTEL)
    # For JSONL, this is per-trace metadata
    # For OTEL, this might be dataset-level, importer handles specifics
    processed_metadata_jsonl = []
    if format == "jsonl":
        processed_metadata_jsonl = (
            [md if md is not None else {} for md in payload_metadata]
            if payload_metadata
            else [{} for _ in messages]
        )
        for md in processed_metadata_jsonl:
            md["uploader"] = "Via API " + "..." + str(apikey[-5:])


    try:
        with Session(db()) as session:
            try:
                actual_dataset_id = None
                actual_dataset_name = dataset_name_req
                dataset_obj: Optional[Dataset] = None

                if dataset_name_req:
                    # Upsert dataset and get its ID and actual name
                    # Using postgresql.insert for better SQLAlchemy integration
                    insert_stmt = (
                        postgresql.insert(Dataset.__table__)
                        .values(
                            id=uuid.uuid4(), # Generate new UUID for potential insert
                            user_id=user_id,
                            name=dataset_name_req,
                            is_public=False, # Default for API uploads
                            time_created=datetime.now(timezone.utc),
                            extra_metadata={}, # Placeholder, will be updated by importer if needed
                        )
                        .on_conflict_do_update(
                            index_elements=[Dataset.user_id, Dataset.name], # type: ignore
                            set_=dict(name=dataset_name_req), # Keep existing id, name can be updated if that's desired
                                                              # Or use "DO NOTHING" and then query
                        )
                        .returning(Dataset.id, Dataset.name)
                    )
                    dataset_res = session.execute(insert_stmt).fetchone()
                    
                    if dataset_res:
                        actual_dataset_id = dataset_res.id
                        actual_dataset_name = dataset_res.name
                    else: # Should not happen with ON CONFLICT DO UPDATE returning values, but as fallback:
                        dataset_q_res = session.query(Dataset.id, Dataset.name).filter_by(user_id=user_id, name=dataset_name_req).first()
                        if dataset_q_res:
                            actual_dataset_id = dataset_q_res.id
                            actual_dataset_name = dataset_q_res.name
                    
                    if actual_dataset_id:
                         dataset_obj = session.query(Dataset).filter(Dataset.id == actual_dataset_id).first()

                if format == "otel":
                    if not dataset_obj and dataset_name_req: # If dataset was supposed to be created/found but wasn't
                         raise HTTPException(status_code=500, detail="Failed to create or retrieve dataset for OTEL import.")
                    if not dataset_name_req: # OTEL traces should typically belong to a named dataset
                         raise HTTPException(status_code=400, detail="Dataset name ('dataset') is required for OTEL format.")

                    # Pass dataset-level metadata if available from payload_metadata
                    otel_dataset_metadata = {}
                    if isinstance(payload_metadata, dict):
                        otel_dataset_metadata = payload_metadata
                    elif isinstance(payload_metadata, list) and len(payload_metadata) > 0 and isinstance(payload_metadata[0], dict):
                        otel_dataset_metadata = payload_metadata[0] # Use first item as dataset metadata

                    # import_otel_trace now returns dataset_obj and list of trace_ids
                    _returned_dataset_obj, otel_trace_ids = await import_otel_trace(
                        session=session,
                        name=actual_dataset_name, # type: ignore
                        user_id=str(user_id),
                        lines=messages, # These are List[str] for OTEL
                        existing_dataset=dataset_obj, # type: ignore
                        metadata=otel_dataset_metadata # Pass dataset-level metadata
                    )
                    # dataset_obj should be the same as _returned_dataset_obj if existing_dataset was not None
                    # or it's the newly created one by import_otel_trace.
                    # For clarity, ensure dataset_obj is the one returned or correctly assigned if it was None before.
                    # However, dataset_obj is already fetched/created before this block if dataset_name_req is present.
                    
                    session.commit() # Commit changes from import_otel_trace

                    if dataset_obj and otel_trace_ids: # Ensure dataset and trace_ids exist
                        background_tasks.add_task(
                            extract_and_save_batch_tool_calls,
                            otel_trace_ids,  # List of stringified trace IDs
                            messages,        # List of OTELSpan JSON strings
                            dataset_obj.id,  # dataset_id
                            user_id,         # user_id (UUID)
                            "otel"           # The new trace_format parameter
                        )

                    return {
                        "dataset_id": str(dataset_obj.id if dataset_obj else actual_dataset_id), # Use dataset_obj if available
                        "dataset_name": dataset_obj.name if dataset_obj else actual_dataset_name, # Use dataset_obj if available
                        "message": f"OTEL traces processed successfully for dataset '{actual_dataset_name}'. Annotations from payload are ignored for OTEL format.",
                        "username": user.username,
                    }
                
                else: # format == "jsonl" or default
                    result_ids = []
                    traces_to_add = []

                    async def parse_single_message_to_trace(message_list, i):
                        trace_id = uuid.uuid4()
                        # dataset_name_req might be None, use actual_dataset_name if dataset was created/found
                        current_dataset_name_for_parse = actual_dataset_name if actual_dataset_name else "default"
                        message_content = await parse_and_update_messages(
                            current_dataset_name_for_parse, trace_id, message_list
                        )
                        message_metadata = processed_metadata_jsonl[i] if processed_metadata_jsonl else {}
                        # Add uploader info from API key to metadata if not already there
                        message_metadata["uploader"] = "Via API " + "..." + str(apikey[-5:])

                        trace = Trace(
                            id=trace_id,
                            dataset_id=actual_dataset_id, # May be None if no dataset_name_req
                            name=message_metadata.get("name"),
                            hierarchy_path=message_metadata.get("hierarchy_path", []),
                            user_id=user_id,
                            content=message_content,
                            extra_metadata=message_metadata,
                        )
                        try:
                            validate_trace(trace)
                        except Exception as e:
                            logger.warning(f"Error validating trace {i}: {str(e)}")
                        return trace

                    parse_messages_to_traces_tasks = [
                        parse_single_message_to_trace(message_item, i)
                        for i, message_item in enumerate(messages)
                    ]
                    traces_to_add = await asyncio.gather(*parse_messages_to_traces_tasks)

                    for trace_obj in traces_to_add:
                        session.add(trace_obj)
                        result_ids.append(str(trace_obj.id))
                    
                    session.flush() # Flush to get trace IDs for annotations if needed

                    if annotations is not None:
                        for i, trace_annotations in enumerate(annotations):
                            if i < len(result_ids): # Ensure we have a trace ID
                                current_trace_id = result_ids[i]
                                current_trace_obj = next((t for t in traces_to_add if str(t.id) == current_trace_id), None)
                                for ann_data in trace_annotations:
                                    new_annotation = Annotation(
                                        trace_id=current_trace_id, # type: ignore
                                        user_id=user_id,
                                        content=ann_data["content"],
                                        address=ann_data["address"],
                                        extra_metadata=ann_data.get("extra_metadata", None),
                                    )
                                    try:
                                        if current_trace_obj:
                                            validate_annotation(new_annotation, current_trace_obj) # type: ignore
                                    except Exception as e:
                                        logger.warning(
                                            f"Error validating annotation for trace {current_trace_id}: {str(e)}"
                                        )
                                    session.add(new_annotation)
                    
                    session.commit()

                    # Add background task to extract and save tool calls
                    if actual_dataset_id: # Only if associated with a dataset
                        background_tasks.add_task(
                            extract_and_save_batch_tool_calls,
                            result_ids,
                            messages, # original messages list
                            actual_dataset_id,
                            user_id
                        )
                    
                    return {
                        "id": result_ids,
                        **({"dataset": actual_dataset_name} if actual_dataset_id else {}),
                        "username": user.username,
                    }

            except Exception:
                session.rollback()
                raise
    
    except HTTPException: # Re-raise HTTPExceptions directly
        raise
    except Exception as e:
        logger.error(f"Error processing trace push: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}") from e
