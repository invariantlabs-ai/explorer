"""Saved queries operations for datasets."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from models.datasets_and_traces import db, SavedQueries
from routes.auth import AuthenticatedUserIdentity

from routes.dataset.utils import load_dataset

router = APIRouter()


@router.put("/byuser/{username}/{dataset_name}/s")
async def save_query(
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    """Save a query for a dataset."""
    with Session(db()) as session:
        by = {"User.username": username, "name": dataset_name}
        dataset, _ = load_dataset(
            session, by, user_id, allow_public=True, return_user=True
        )
        data = await request.json()
        savedquery = SavedQueries(
            user_id=user_id,
            dataset_id=dataset.id,
            query=data["query"],
            name=data["name"],
        )
        session.add(savedquery)
        session.commit()


@router.delete("/query/{query_id}")
async def delete_query(
    request: Request,
    query_id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    """Delete a saved query."""
    with Session(db()) as session:
        query = session.query(SavedQueries).filter(SavedQueries.id == query_id).first()

        if query.user_id != user_id:
            raise HTTPException(status_code=403, detail="Not allowed to delete query")

        session.delete(query)
        session.commit()