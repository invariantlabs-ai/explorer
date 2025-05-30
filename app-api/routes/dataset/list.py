"""Dataset listing operations."""

from enum import Enum
from typing import Annotated, Optional
from uuid import UUID

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends, HTTPException, Request
from models.datasets_and_traces import Dataset, User, db
from models.queries import dataset_to_json
from routes.apikeys import UserOrAPIIdentity
from routes.auth import UserIdentity
from routes.dataset.utils import homepage_dataset_ids
from sqlalchemy import and_, exists, or_
from sqlalchemy.orm import Session

router = APIRouter()


class DatasetKind(Enum):
    PRIVATE = "private"
    PUBLIC = "public"
    HOMEPAGE = "homepage"
    ANY = "any"


@cached(TTLCache(maxsize=1, ttl=1800))
def fetch_homepage_datasets(limit: Optional[int] = None) -> list[dict[str, any]]:
    """
    Fetches and caches the homepage datasets with a time-to-live (TTL) cache.
    """
    if not homepage_dataset_ids:
        return []

    with Session(db()) as session:
        datasets = (
            session.query(Dataset, User)
            .join(User, User.id == Dataset.user_id)
            .filter(and_(Dataset.is_public, Dataset.id.in_(homepage_dataset_ids)))
            .limit(limit)
            .all()
        )
    return [dataset_to_json(dataset, user) for dataset, user in datasets]


@router.get("/list")
def list_datasets(
    kind: DatasetKind,
    request: Request,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)],
    limit: Optional[int] = None,
    include_metadata: Optional[bool] = True,
):
    """List datasets based on the specified kind and user identity."""
    with Session(db()) as session:
        if kind == DatasetKind.HOMEPAGE:
            # Use cached results for HOMEPAGE datasets
            return fetch_homepage_datasets(limit)

        # check if there is a q=... parameter to match in the name
        q = request.query_params.get("q")

        # Base query joining Dataset with User
        query = session.query(Dataset, User).join(User, User.id == Dataset.user_id)

        if kind == DatasetKind.PRIVATE:
            query = query.filter(Dataset.user_id == user_id)
        elif kind == DatasetKind.PUBLIC:
            query = query.filter(Dataset.is_public)
        elif kind == DatasetKind.ANY:
            query = query.filter(or_(Dataset.is_public, Dataset.user_id == user_id))

        # if q is provided, filter by name
        if q:
            q = f"%{q}%"
            query = query.filter(Dataset.name.ilike(q))

        # Order by latest trace time if exists, otherwise by dataset creation time
        datasets = query.order_by(Dataset.time_last_pushed.desc()).limit(limit).all()
        return [
            dataset_to_json(
                dataset,
                user,
                include_metadata=include_metadata,
            )
            for dataset, user in datasets
        ]


@router.get("/list/byuser/{user_name}")
def list_datasets_by_user(
    request: Request,
    user_name: str,
    user: Annotated[UUID | None, Depends(UserIdentity)],
):
    with Session(db()) as session:
        user_exists = session.query(exists().where(User.username == user_name)).scalar()
        if not user_exists:
            raise HTTPException(status_code=404, detail="User not found")
        datasets = (
            session.query(Dataset, User)
            .join(User, User.id == Dataset.user_id)
            .filter(and_(User.username == user_name, Dataset.is_public))
            .all()
        )
        return [dataset_to_json(dataset, user) for dataset, user in datasets]
