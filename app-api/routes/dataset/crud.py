"""CRUD operations for datasets."""

import asyncio
import uuid
from datetime import datetime
from typing import Annotated, Any, Dict
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Request,
    UploadFile,
)
from models.datasets_and_traces import (
    Annotation,
    Dataset,
    SavedQueries,
    SharedLinks,
    Trace,
    db,
)
from models.importers import import_jsonl
from models.queries import dataset_to_json, get_savedqueries
from routes.apikeys import UserOrAPIIdentity
from routes.auth import AuthenticatedUserIdentity
from routes.dataset.utils import (
    handle_dataset_creation_integrity_error,
    load_dataset,
    str_to_bool,
)
from routes.dataset_metadata import extract_and_save_batch_tool_calls
from sqlalchemy import and_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from util.util import delete_images, validate_dataset_name

router = APIRouter()


@router.post("/create")
async def create(
    request: Request,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)],
):
    """Create a dataset."""
    if user_id is None:
        raise HTTPException(
            status_code=401, detail="Must be authenticated to create a dataset"
        )

    data = await request.json()
    name = data.get("name")
    if name is None:
        raise HTTPException(status_code=400, detail="name must be provided")
    if not isinstance(name, str):
        raise HTTPException(status_code=400, detail="name must be a string")
    validate_dataset_name(name)

    metadata = data.get("metadata", dict())
    if not isinstance(metadata, dict):
        raise HTTPException(status_code=400, detail="metadata must be a dictionary")
    metadata["created_on"] = str(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    is_public = data.get("is_public", False)
    if not isinstance(is_public, bool):
        raise HTTPException(status_code=400, detail="is_public must be a boolean")

    with Session(db()) as session:
        dataset = Dataset(
            id=uuid.uuid4(),
            user_id=user_id,
            name=name,
            is_public=is_public,
            extra_metadata=metadata,
        )
        dataset.extra_metadata = metadata
        session.add(dataset)
        try:
            session.commit()
        except IntegrityError as e:
            session.rollback()
            handle_dataset_creation_integrity_error(e)
        return dataset_to_json(dataset)


@router.post("/upload")
async def upload_file(
    request: Request,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    """Create a dataset via file upload."""
    # get name and is_public from the form
    form = await request.form()
    name = form.get("name")
    # is_public is a string because of Multipart request, convert to boolean
    is_public = str_to_bool("is_public", form.get("is_public", "false"))
    validate_dataset_name(name)

    # Fail eagerly if a dataset with the same name already exists with some traces
    existing_dataset = None
    with Session(db()) as session:
        existing_dataset = (
            session.query(Dataset)
            .filter(and_(Dataset.user_id == user_id, Dataset.name == name))
            .first()
        )
        if existing_dataset is not None:
            trace_count = (
                session.query(Trace)
                .filter(Trace.dataset_id == existing_dataset.id)
                .count()
            )
            if trace_count > 0:
                raise HTTPException(
                    status_code=400,
                    detail="Dataset with the same name already exists with traces, to add new traces use the push API",
                )

    with Session(db()) as session:
        lines = file.file.readlines()
        dataset, result_ids, messages = await import_jsonl(
            session,
            name,
            user_id,
            lines,
            existing_dataset=existing_dataset,
            is_public=is_public,
            return_trace_data=True,
        )
        session.commit()
        # Add background task to extract and save tool calls
        if result_ids and messages:
            background_tasks.add_task(
                extract_and_save_batch_tool_calls,
                result_ids,
                messages,
                dataset.id,
                user_id,
            )

        return dataset_to_json(dataset)


@router.get("/byid/{id}")
def get_dataset_by_id(
    request: Request,
    id: str,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)],
):
    return get_dataset({"id": id}, user_id=user_id)


@router.get("/byuser/{username}/{dataset_name}")
def get_dataset_by_name(
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)],
):
    return get_dataset(
        {"User.username": username, "name": dataset_name}, user_id=user_id
    )


@router.delete("/byid/{id}")
async def delete_dataset_by_id(
    request: Request,
    id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    return await delete_dataset({"id": id}, user_id)


@router.delete("/byuser/{username}/{dataset_name}")
async def delete_dataset_by_name(
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    return await delete_dataset(
        {"User.username": username, "name": dataset_name}, user_id
    )


@router.put("/byid/{id}")
async def update_dataset_by_id(
    request: Request,
    id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    return await update_dataset(request, {"id": id}, user_id)


@router.put("/byuser/{username}/{dataset_name}")
async def update_dataset_by_name(
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    return await update_dataset(
        request, {"User.username": username, "name": dataset_name}, user_id
    )


def get_dataset(by: Dict[str, Any], user_id: UUID | None) -> Dict[str, Any]:
    """Gets details on a dataset (including collections, but without traces)."""
    # may be None in case of anonymous users/public datasets or traces
    with Session(db()) as session:
        dataset, user = load_dataset(
            session, by, user_id, allow_public=True, return_user=True
        )
        # count all traces
        num_traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).count()
        return dataset_to_json(
            dataset,
            user,
            num_traces=num_traces,
            queries=get_savedqueries(session, dataset, user_id, num_traces),
        )


async def delete_dataset(by: Dict[str, Any], user_id: UUID):
    """Delete a dataset and all associated data."""
    with Session(db()) as session:
        dataset = load_dataset(session, by, user_id)

        # delete all saved queries
        session.query(SavedQueries).filter(
            SavedQueries.dataset_id == dataset.id
        ).delete()

        # delete all traces
        traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).all()
        trace_ids = [trace.id for trace in traces]

        # delete all annotations
        session.query(Annotation).filter(Annotation.trace_id.in_(trace_ids)).delete()
        # delete all shared links
        session.query(SharedLinks).filter(SharedLinks.trace_id.in_(trace_ids)).delete()
        # delete all images
        image_deletion_tasks = [
            delete_images(dataset_name=dataset.name, trace_id=str(trace_id))
            for trace_id in trace_ids
        ]
        await asyncio.gather(*image_deletion_tasks)

        # delete all traces
        session.query(Trace).filter(Trace.dataset_id == dataset.id).delete()

        # delete dataset
        session.delete(dataset)

        # delete the trace index sequence for the dataset (if it exists)
        sequence_name = f"dataset_seq_{str(dataset.id).replace('-', '_')}"
        session.execute(text(f"DROP SEQUENCE IF EXISTS {sequence_name}"))

        session.commit()

        return {"message": "Deleted"}


async def update_dataset(
    request: Request,
    by: Dict[str, Any],
    user_id: UUID,
):
    """Update dataset properties."""
    with Session(db()) as session:
        dataset, user = load_dataset(session, by, user_id, return_user=True)
        payload = await request.json()
        is_public = bool(payload.get("content"))
        dataset.is_public = is_public
        session.commit()

        # count all traces
        num_traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).count()
        return dataset_to_json(
            dataset,
            num_traces=num_traces,
            queries=get_savedqueries(session, dataset, user_id, num_traces),
        )
