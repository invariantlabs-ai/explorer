"""Trace API routes for handling trace-related operations."""

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Annotated, Dict, List, Any
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.responses import Response, StreamingResponse
from logging_config import get_logger
from models.analyzer_model import AnalysisRequest, SingleAnalysisRequest
from models.analyzer_model import Annotation as AnalyzerAnnotation
from models.datasets_and_traces import Annotation, Dataset, SharedLinks, Trace, User, db
from models.queries import (
    AnalyzerTraceExporter,
    DBJSONEncoder,
    annotation_to_json,
    has_link_sharing,
    load_annotations,
    load_dataset,
    load_trace,
    trace_to_exported_json,
    trace_to_json,
)
from pydantic import ValidationError
from routes.apikeys import (
    APIIdentity,
    AuthenticatedUserOrAPIIdentity,
    UserOrAPIIdentity,
)
from routes.auth import AuthenticatedUserIdentity, UserIdentity
from routes.dataset_metadata import extract_and_save_batch_tool_calls
from sqlalchemy import and_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from util.util import delete_images, parse_and_update_messages
from util.validation import validate_annotation

trace = FastAPI()
logger = get_logger(__name__)

# static dataset name for snippets
# snippets don't have a parent dataset so we use this name
# so that all images in traces are stored in a fixed hierarchy
DATASET_NAME_FOR_SNIPPETS = "!ROOT_DATASET_FOR_SNIPPETS"


@trace.get("/image/{dataset_name}/{trace_id}/{image_id}")
async def get_image(
    request: Request,
    dataset_name: str,
    trace_id: str,
    image_id: str,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)] = None,
):
    """Get an image for a trace."""
    with Session(db()) as session:
        _ = load_trace(session, trace_id, user_id, allow_public=True, allow_shared=True)

    # First check if there is a local image
    img_path = f"/srv/images/{dataset_name}/{trace_id}/{image_id}.png"
    if os.path.exists(img_path):
        with open(img_path, "rb") as f:
            return Response(content=f.read(), media_type="image/png")
    # If no local image is found, return 404
    raise HTTPException(status_code=404, detail="Image not found")


@trace.get("/snippets")
def get_trace_snippets(
    request: Request, user_id: Annotated[UUID, Depends(AuthenticatedUserOrAPIIdentity)]
):
    """Get all trace snippets for a user."""
    limit = request.query_params.get("limit")
    limit = limit if limit != "" else None

    # gets a users trace snippets (traces without a dataset)
    with Session(db()) as session:
        traces = (
            session.query(Trace)
            .filter(Trace.user_id == user_id, Trace.dataset_id == None)
            .order_by(Trace.time_created.desc())
            .limit(limit)
            .all()
        )
        return [trace_to_json(t) for t in traces]


@trace.delete("/{id}")
async def delete_trace(
    id: str, user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)]
):
    """Delete a trace by ID."""
    with Session(db()) as session:
        # can only delete own traces
        trace = load_trace(session, id, user_id, allow_public=False, allow_shared=False)

        # delete shared link if it exists
        session.query(SharedLinks).filter(SharedLinks.trace_id == id).delete()
        # delete annotations
        session.query(Annotation).filter(Annotation.trace_id == id).delete()
        # delete images
        dataset_name = DATASET_NAME_FOR_SNIPPETS
        if trace.dataset_id:
            dataset = load_dataset(session, trace.dataset_id, user_id)
            dataset_name = dataset.name
        # delete images
        await delete_images(dataset_name=dataset_name, trace_id=str(trace.id))
        # delete trace
        session.delete(trace)

        session.commit()

        return {"message": "deleted"}


@trace.get("/{id}")
def get_trace(
    request: Request,
    id: str,
    max_length: int = None,
    include_annotations: bool = True,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)] = None,
):
    """Get a trace by ID."""
    with Session(db()) as session:
        trace, user = load_trace(
            session, id, user_id, allow_public=True, allow_shared=True, return_user=True
        )
        return trace_to_json(
            trace,
            annotations=load_annotations(session, id) if include_annotations else None,
            user=user.username,
            max_length=max_length,
        )


@trace.get("/{id}/download")
async def download_trace(
    request: Request,
    id: str,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)] = None,
):
    """Download a trace as JSONL."""
    with Session(db()) as session:
        trace = load_trace(session, id, user_id, allow_public=True, allow_shared=True)

        trace_data = await trace_to_exported_json(trace, load_annotations(session, id))
        trace_data = json.dumps(trace_data, cls=DBJSONEncoder) + "\n"

        # Return a StreamingResponse with appropriate headers
        return Response(
            content=trace_data,
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename={trace.id}.jsonl"},
        )


@trace.get("/{id}/shared")
def get_trace_sharing(
    request: Request,
    id: str,
    _: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    with Session(db()) as session:
        return {"shared": has_link_sharing(session, id)}


@trace.put("/{id}/shared")
def share_trace(
    request: Request,
    id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    """Share a trace."""
    # never None (always authenticated)
    with Session(db()) as session:
        # load trace to check for auth
        trace = load_trace(session, id, user_id)
        # assert that the trace is owned by the user
        if trace.user_id != user_id:
            raise HTTPException(
                status_code=401,
                detail="Cannot share a trace the current user does not own",
            )

        shared_link = (
            session.query(SharedLinks).filter(SharedLinks.trace_id == id).first()
        )

        if shared_link is None:
            shared_link = SharedLinks(id=uuid.uuid4(), trace_id=id)
            session.add(shared_link)
            session.commit()

        return {"shared": True}


@trace.delete("/{id}/shared")
def unshare_trace(
    request: Request,
    id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    """Unshare a trace."""
    with Session(db()) as session:
        _ = load_trace(session, id, user_id)  # load trace to check for auth
        shared_link = (
            session.query(SharedLinks).filter(SharedLinks.trace_id == id).first()
        )

        if shared_link is not None:
            session.delete(shared_link)
            session.commit()

        return {"shared": False}


# add a new annotation to a trace
@trace.post("/{id}/annotate")
async def annotate_trace(
    request: Request,
    id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    """Add an annotation to a trace."""
    with Session(db()) as session:
        trace = load_trace(
            session, id, user_id, allow_public=True, allow_shared=True
        )  # load trace to check for auth
        # get address and content from request
        payload = await request.json()
        content = payload.get("content")
        address = payload.get("address")
        extra_metadata = payload.get("extra_metadata")

        annotation = Annotation(
            trace_id=trace.id,
            user_id=user_id,
            address=address,
            content=str(content),
            extra_metadata=extra_metadata,
        )

        session.add(annotation)
        session.commit()
        return annotation_to_json(annotation)


def annotation_from_chunk(chunk: str) -> AnalyzerAnnotation:
    """
    Parse an annotation from a chunk of text.
    """
    if chunk.strip() == "":
        return None
    if not chunk.startswith("data:"):
        raise HTTPException(
            status_code=500, detail=f"Trying to parse a non-data chunk: {chunk}"
        )
    try:
        return AnalyzerAnnotation.model_validate_json(chunk[6:])
    except ValidationError:
        return None


@trace.post("/{id}/analysis")
async def analyze_trace(
    id: str,
    analysis_request: AnalysisRequest,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    """Analyze a trace using the analyzer model."""
    with Session(db()) as session:
        trace, user = load_trace(
            session, id, user_id, allow_public=True, allow_shared=True, return_user=True
        )
        trace_exporter = AnalyzerTraceExporter(
            user_id=str(user_id),
            dataset_id=str(trace.dataset_id),
        )
        input_sample, annotated_samples = await trace_exporter.analyzer_model_input(
            session=session,
            input_trace_id=id,
        )
        # delete existing annotations
        _ = await replace_annotations(
            session,
            id,
            user_id,
            "analyzer-model",
            [],
        )

    sar = SingleAnalysisRequest(
        input=input_sample[0].trace,
        annotated_samples=annotated_samples,
        model_params=analysis_request.options.model_params,
        debug_options=analysis_request.options.debug_options,
    )

    async def stream_response():
        url = f"{analysis_request.apiurl}/api/v1/analysis/stream"
        try:
            async with httpx.AsyncClient() as client:
                async with client.stream(
                    method="POST",
                    url=url,
                    json=sar.model_dump(),
                    headers={"Authorization": f"Bearer {analysis_request.apikey}"},
                ) as streaming_response:
                    async for chunk in streaming_response.aiter_text():
                        # TODO: replace with robust chunk parsing
                        # split by lines
                        for line in chunk.strip().split("\n"):
                            annotation = annotation_from_chunk(line)
                            if isinstance(annotation, AnalyzerAnnotation):
                                with Session(db()) as session:
                                    new_annotation = Annotation(
                                        trace_id=UUID(id),
                                        user_id=user_id,
                                        address=annotation.location or "",
                                        content=annotation.content,
                                        extra_metadata={
                                            "source": "analyzer-model",
                                            "severity": annotation.severity,
                                        },
                                    )
                                    session.add(new_annotation)
                                    session.commit()
                                yield "data: update\n\n"
                        yield chunk
        except httpx.ConnectError:
            error_message = f"Failed to connect to analyzer model at: {url}"
            yield f"data: {json.dumps({'error': error_message})}\n\n".encode("utf-8")

    print("streaming response")

    return StreamingResponse(stream_response(), media_type="text/event-stream")


async def replace_annotations(
    session: Session,
    trace_id: str,
    user_id: UUID,
    source: str,
    annotations: List[Dict],
) -> Dict[str, int]:
    """
    Replaces all annotations of a given source with new ones.

    This is used, e.g. to update the analysis model output, once a new run has completed.
    """

    if not isinstance(annotations, list):
        raise ValueError("Annotations must be a list")
    if not isinstance(source, str):
        raise ValueError("Source must be a string")

    num_deleted = (
        session.query(Annotation)
        .filter(
            Annotation.trace_id == trace_id,
            Annotation.extra_metadata.op("->>")("source") == source,
        )
        .delete()
    )

    num_inserted = len(annotations)

    for annotation in annotations:
        new_annotation = Annotation(
            trace_id=trace_id,
            user_id=user_id,
            address=annotation.get("address"),
            content=str(annotation.get("content")),
            extra_metadata=annotation.get("extra_metadata"),
        )
        session.add(new_annotation)

    session.commit()

    return {"deleted": num_deleted, "inserted": num_inserted}


@trace.post("/{id}/annotations/update")
async def update_annotations(
    request: Request,
    id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    """API endpoint to replace annotations."""
    payload = await request.json()
    source = payload.get("source")
    annotations = payload.get("annotations")

    try:
        with Session(db()) as session:
            trace = load_trace(
                session, id, user_id, allow_public=True, allow_shared=True
            )
            return await replace_annotations(
                session, trace.id, user_id, source, annotations
            )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail="An error occurred while updating annotations"
        )


@trace.get("/{id}/annotations")
def get_annotations(
    request: Request, id: str, user_id: Annotated[UUID | None, Depends(UserIdentity)]
):
    """Get all annotations of a trace."""
    # user_id may be None for anons
    with Session(db()) as session:
        _ = load_trace(
            session, id, user_id, allow_public=True, allow_shared=True
        )  # load trace to check for auth
        return [annotation_to_json(a, u) for a, u in load_annotations(session, id)]


@trace.delete("/{id}/annotation/{annotation_id}")
def delete_annotation(
    request: Request,
    id: str,
    annotation_id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    """Delete an annotation."""
    with Session(db()) as session:
        _ = load_trace(
            session, id, user_id, allow_public=True, allow_shared=True
        )  # load trace to check for auth
        annotation = (
            session.query(Annotation).filter(Annotation.id == annotation_id).first()
        )

        if annotation is None:
            raise HTTPException(status_code=404, detail="Annotation not found")

        if annotation.user_id != user_id:
            raise HTTPException(status_code=401, detail="Unauthorized delete")

        session.delete(annotation)
        session.commit()

        return {"message": "deleted"}


# update annotation
@trace.put("/{id}/annotation/{annotation_id}")
async def update_annotation(
    request: Request,
    id: str,
    annotation_id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    """Update an annotation."""
    with Session(db()) as session:
        _ = load_trace(
            session, id, user_id, allow_public=True, allow_shared=True
        )  # load trace to check for auth
        annotation, user = (
            session.query(Annotation, User)
            .filter(Annotation.id == annotation_id)
            .join(User, Annotation.user_id == User.id)
            .first()
        )

        if annotation is None:
            raise HTTPException(status_code=404, detail="Annotation not found")

        if annotation.user_id != user_id:
            raise HTTPException(status_code=401, detail="Unauthorized delete")

        payload = await request.json()
        content = payload.get("content")

        annotation.content = content
        session.commit()
        return annotation_to_json(annotation, user)


@trace.post("/snippets/new")
async def upload_new_single_trace(
    request: Request, user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)]
):
    """Upload a new trace snippet."""
    with Session(db()) as session:
        payload = await request.json()
        content = payload.get("content", [])
        extra_metadata = payload.get("extra_metadata", {})
        trace_id = uuid.uuid4()
        # Parse messages for base64 encoded images, save them to disk, and update
        # message content with local file path.
        # The dataset_name is set to "!ROOT_DATASET_FOR_SNIPPETS" to indicate that the
        # trace does not belong to a dataset.
        # Because of the ! this is not a valid name for a dataset and will not conflict.
        message_content = await parse_and_update_messages(
            dataset="!ROOT_DATASET_FOR_SNIPPETS", trace_id=trace_id, messages=content
        )
        trace = Trace(
            id=trace_id,
            dataset_id=None,
            user_id=user_id,
            content=message_content,
            extra_metadata=extra_metadata,
            name=payload.get("name", "Single Trace"),
            hierarchy_path=payload.get("hierarchy_path", []),
        )

        session.add(trace)
        session.commit()

        return {"id": str(trace.id)}


def merge_sorted_messages(
    existing_messages: list[dict],
    new_messages: list[dict],
    trace_creation_timestamp: str,
):
    """
    Perform a merge sort of existing and new messages based on the timestamp.
    Some existing messages may not have a timestamp, in which case the trace
    creation timestamp is used.
    """
    i, j = 0, 0
    sorted_messages = []

    while i < len(existing_messages) and j < len(new_messages):
        if (
            existing_messages[i].get("timestamp", trace_creation_timestamp)
            < new_messages[j]["timestamp"]
        ):
            sorted_messages.append(existing_messages[i])
            i += 1
        else:
            sorted_messages.append(new_messages[j])
            j += 1

    sorted_messages.extend(existing_messages[i:])
    sorted_messages.extend(new_messages[j:])
    return sorted_messages


@trace.post("/{trace_id}/messages")
async def append_messages(
    request: Request,
    trace_id: str,
    background_tasks: BackgroundTasks,
    user_id: Annotated[UUID, Depends(APIIdentity)],
):
    """
    Append messages to an existing trace.
    The messages in the request payload are expected to be a list of dictionaries.
    These messages can optionally have a timestamp field, which should be in ISO 8601 format.
    If a timestamp is not provided, the current time is used for the new messages.
    The timestamp field is used to sort the new messages with respect to the existing messages
    in the trace.
    It is possible that the existing messages in the trace do not have timestamps - in this case,
    the trace creation timestamp is used as a reference for sorting.
    """

    payload = await request.json()
    new_messages = payload.get("messages", [])
    if (
        not isinstance(new_messages, list)
        or not new_messages
        or not all(isinstance(item, dict) for item in new_messages)
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid messages format - expected a non-empty list of dictionaries",
        )
    annotations = payload.get("annotations", []) or []
    if not isinstance(annotations, list) or (
        annotations and not all(isinstance(item, dict) for item in annotations)
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid annotations format - expected a list of dictionaries or an empty list",
        )

    # Validate timestamp format in new_messages
    # If timestamp exists, it should be in ISO 8601 format
    for message in new_messages:
        timestamp = message.get("timestamp")
        if timestamp is not None:
            try:
                # Parse the timestamp into a datetime object
                parsed_timestamp = datetime.fromisoformat(timestamp)
                # Assume naive timestamps are UTC
                if parsed_timestamp.tzinfo is None:
                    parsed_timestamp = parsed_timestamp.replace(tzinfo=timezone.utc)
                # Normalize to UTC ISO 8601 format
                message["timestamp"] = parsed_timestamp.astimezone(
                    timezone.utc
                ).isoformat()
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Invalid timestamp format in message: {timestamp}. "
                        "Expected format: ISO 8601, e.g., 2025-01-23T10:30:00+00:00"
                    ),
                ) from e
    try:
        with Session(db()) as session:
            with session.begin():  # Start transaction
                # Lock the trace row for update
                trace_response = (
                    session.query(Trace)
                    .filter(and_(Trace.id == UUID(trace_id), Trace.user_id == user_id))
                    .with_for_update()
                    .first()
                )
                if not trace_response:
                    raise HTTPException(status_code=404, detail="Trace not found")

                exising_messages_count = len(trace_response.content)
                # set timestamp for new messages
                timestamp_for_new_messages = datetime.now(timezone.utc).isoformat()
                for message in new_messages:
                    message.setdefault("timestamp", timestamp_for_new_messages)
                dataset_name = "!ROOT_DATASET_FOR_SNIPPETS"
                dataset_id = None
                if trace_response.dataset_id:
                    dataset_response = (
                        session.query(Dataset)
                        .filter(
                            and_(
                                Dataset.id == trace_response.dataset_id,
                                Dataset.user_id == user_id,
                            )
                        )
                        .first()
                    )
                    dataset_name = dataset_response.name
                    dataset_id = trace_response.dataset_id
                # parse images from new_messages and store them separately
                new_messages = await parse_and_update_messages(
                    dataset=dataset_name,
                    trace_id=trace_response.id,
                    messages=new_messages,
                )

                combined_messages = merge_sorted_messages(
                    existing_messages=trace_response.content,
                    new_messages=new_messages,
                    trace_creation_timestamp=trace_response.time_created.isoformat(),
                )

                trace_response.content = combined_messages
                flag_modified(trace_response, "content")

                # The annotations may not be for the new messages being appended only
                # but also for the existing messages in the trace.
                # This assumes that there are no concurrent calls to this endpoint when adding annotations.
                # We intend to fix this long term by using message level ids (some sort of a uuid maybe?).
                # We will not rely on messages indices then and this will be safe.
                for annotation_data in annotations:
                    address = annotation_data.get("address")
                    new_annotation = Annotation(
                        trace_id=trace_id,
                        user_id=user_id,
                        content=annotation_data["content"],
                        address=address,
                        extra_metadata=annotation_data.get("extra_metadata", None),
                    )
                    try:
                        validate_annotation(new_annotation, trace_response)
                    except Exception as e:
                        # TODO: For now we just warn instead of throwing an error
                        logger.warning(f"Error validating annotation: {str(e)}")
                    session.add(new_annotation)

                # Add background task to extract tool calls from new messages
                background_tasks.add_task(
                    extract_and_save_batch_tool_calls,
                    trace_id,
                    new_messages,
                    dataset_id,
                    user_id
                )

        return {"success": True}
    except SQLAlchemyError as e:
        logger.error("Database error when adding messages to existing trace: %s", e)
        raise HTTPException(
            status_code=500, detail="An unexpected database error occurred."
        ) from e
