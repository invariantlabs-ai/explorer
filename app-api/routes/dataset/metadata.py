"""Dataset metadata operations."""

from typing import Annotated, Optional # Added Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool # Added
from ...util.redis_client import cache_redis, delete_cache_direct, _generate_cache_key # Added
from models.datasets_and_traces import User, db
from routes.apikeys import APIIdentity, UserOrAPIIdentity # APIIdentity is correct for get_metadata's user_id
from routes.dataset.utils import load_dataset
from routes.dataset_metadata import update_dataset_metadata
from sqlalchemy.orm import Session

router = APIRouter()

# Synchronous helper for get_metadata DB access
def _get_metadata_from_db(dataset_name: str, user_id_from_token: UUID, owner_username: Optional[str] = None) -> dict:
    with Session(db()) as session:
        actual_user_id_for_query = user_id_from_token # Default to token user's ID
        if owner_username:
            owner_user = session.query(User).filter(User.username == owner_username).first()
            if not owner_user:
                raise HTTPException(status_code=404, detail=f"Owner user {owner_username} not found")
            
            actual_user_id_for_query = owner_user.id # Query by specified owner's ID
            
            dataset_response = load_dataset(
                session,
                by={"name": dataset_name, "user_id": actual_user_id_for_query},
                user_id=user_id_from_token, # Authenticate using token holder's ID for visibility check
                allow_public=True,
                return_user=False,
            )
            # If the dataset is private and the token user is not the owner, deny access.
            if not dataset_response.is_public and user_id_from_token != owner_user.id:
                raise HTTPException(
                    status_code=403,
                    detail="Not allowed to view metadata for this dataset",
                )
        else: # No owner_username, so get_metadata is for the user_id_from_token's own dataset
            dataset_response = load_dataset(
                session,
                by={"name": dataset_name, "user_id": user_id_from_token}, # Query by token user's ID
                user_id=user_id_from_token, # Authenticate as token user
                allow_public=True, 
                return_user=False,
            )

        # Ensure extra_metadata is not None before copying
        metadata_response = dataset_response.extra_metadata.copy() if dataset_response.extra_metadata else {}
        metadata_response.pop("policies", None)
        return {**metadata_response}


@router.get("/{dataset_name}")
@cache_redis(ttl=3600)
async def get_metadata(
    dataset_name: str,
    user_id: Annotated[UUID, Depends(APIIdentity)], # This is the user_id from the token
    owner_username: Optional[str] = None, # Made Optional to match helper
):
    """
    Get metadata for a dataset. The owner_username is an optional parameter that can be provided
    to get metadata for a dataset owned by a specific user.
    - If `owner_username` is provided, return the metadata for the dataset if
      it is public or if the caller is the same owner_username. If the dataset is private and
      the caller is not the owner of the dataset, return a 403.
    - If no `owner_username` is provided, return the metadata for the dataset if
      the caller is the owner of the dataset.
    """
    return await run_in_threadpool(
        _get_metadata_from_db,
        dataset_name=dataset_name,
        user_id_from_token=user_id,
        owner_username=owner_username
    )


@router.put("/{dataset_name}")
async def update_metadata(
    dataset_name: str,
    request: Request,
    user_id: Annotated[UUID, Depends(UserOrAPIIdentity)], # This user_id is the owner performing the update
):
    """Update metadata for a dataset. Only the owner of a dataset can update its metadata."""

    payload = await request.json()
    metadata = payload.get("metadata", {})

    if not isinstance(metadata, dict):
        raise HTTPException(status_code=400, detail="metadata must be a dictionary")
    
    replace_all = payload.get("replace_all", False)
    if not isinstance(replace_all, bool):
        raise HTTPException(status_code=400, detail="replace_all must be a boolean")

    updated_data = await update_dataset_metadata(user_id, dataset_name, metadata, replace_all)

    # Cache invalidation for the owner's direct view
    # The user_id in this context is the one who owns the dataset and is making the update.
    # This corresponds to a call to get_metadata(dataset_name, user_id=user_id, owner_username=None)
    key_owner_view = _generate_cache_key(
        get_metadata.__name__,
        args=(dataset_name, user_id), # Positional args for get_metadata
        kwargs={'owner_username': None}  # Explicitly None for owner_username
    )
    await delete_cache_direct(key_owner_view)
    
    # Note: Further invalidation for views via /u/<owner_username>/... is complex due to
    # the `user_id` (from APIIdentity) in `get_metadata` varying for each viewer.
    # The current invalidation covers the owner who performed the update.

    return updated_data
