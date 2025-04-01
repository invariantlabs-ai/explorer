"""Dataset metadata operations."""

from typing import Annotated, Dict, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from models.datasets_and_traces import db, Dataset, User
from routes.apikeys import APIIdentity, UserOrAPIIdentity
from routes.auth import UserIdentity

from routes.dataset.utils import load_dataset

router = APIRouter()


@router.get("/metadata/{dataset_name}")
async def get_metadata(
    dataset_name: str,
    user_id: Annotated[UUID, Depends(APIIdentity)],
    owner_username: str = None,  # The username of the owner of the dataset (u/<username>).
):
    """
    Get metadata for a dataset. The owner_username is an optional parameter that can be provided
    to get metadata for a dataset owned by a specific user. This corresponds to the username
    of the user which is unique.
    - If `owner_username` is provided, return the metadata for the dataset if
      it is public or if the caller is the same owner_username. If the dataset is private and
      the caller is not the owner of the dataset, return a 403.
    - If no `owner_username` is provided, return the metadata for the dataset if
      the caller is the owner of the dataset.
    """

    with Session(db()) as session:
        if owner_username:
            owner_user = (
                session.query(User).filter(User.username == owner_username).first()
            )
            dataset_response = load_dataset(
                session,
                by={"name": dataset_name, "user_id": owner_user.id},
                user_id=owner_user.id,
                allow_public=True,
                return_user=False,
            )
            # If the dataset is private and the caller is not the owner of the dataset,
            # return a 403.
            if not dataset_response.is_public and user_id != owner_user.id:
                raise HTTPException(
                    status_code=403,
                    detail="Not allowed to view metadata for this dataset",
                )
        else:
            dataset_response = load_dataset(
                session,
                by={"name": dataset_name, "user_id": user_id},
                user_id=user_id,
                allow_public=True,
                return_user=False,
            )

        metadata_response = dataset_response.extra_metadata

        metadata_response.pop("policies", None)

        return {
            **metadata_response,
        }


@router.put("/metadata/{dataset_name}")
async def update_metadata(
    dataset_name: str,
    request: Request,
    user_id: Annotated[UUID, Depends(UserOrAPIIdentity)],
):
    """Update metadata for a dataset. Only the owner of a dataset can update its metadata."""

    payload = await request.json()
    metadata = payload.get("metadata", {})

    # make sure metadata is a dictionary
    if not isinstance(metadata, dict):
        raise HTTPException(status_code=400, detail="metadata must be a dictionary")

    # we support two update modes: 'incremental' (default) or 'replace_all' (when replace_all is True)
    # When replace_all is False (incremental update):
    # * If a field doesn't exist or is None in the payload, ignore it (keep the existing value).
    # * Otherwise, update the field in extra_metadata with the new value.
    # When replace_all is True:
    # * If a field doesn't exist or is None in the payload, delete the field from extra_metadata.
    # * Otherwise, update the field in extra_metadata with the new value.

    # This holds true for nested objects like invariant.test_results too.
    # Thus the caller cannot update only a part of the nested object - they need to provide the
    # full object.
    replace_all = payload.get("replace_all", False)
    if not isinstance(replace_all, bool):
        raise HTTPException(status_code=400, detail="replace_all must be a boolean")

    return await update_dataset_metadata(user_id, dataset_name, metadata, replace_all)


async def update_dataset_metadata(
    user_id: UUID, dataset_name: str, metadata: Dict[str, Any], replace_all: bool = False
):
    """
    Update the metadata of a dataset.

    Args:
        user_id: The user ID of the dataset owner
        dataset_name: The name of the dataset
        metadata: The metadata to update
        replace_all: If True, replace all metadata; if False, update incrementally

    Returns:
        The updated dataset metadata
    """
    with Session(db()) as session:
        # Find the dataset by user_id and name
        dataset = (
            session.query(Dataset)
            .filter(Dataset.user_id == user_id, Dataset.name == dataset_name)
            .first()
        )

        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Ensure the user owns the dataset
        if dataset.user_id != user_id:
            raise HTTPException(
                status_code=403, detail="Not allowed to update metadata for this dataset"
            )

        # Initialize extra_metadata if it doesn't exist
        if not dataset.extra_metadata:
            dataset.extra_metadata = {}

        # Update the extra_metadata based on the update mode
        if replace_all:
            # For replace_all mode, use the provided metadata directly
            dataset.extra_metadata = metadata
        else:
            # For incremental mode, update existing fields and add new ones
            _update_nested_dict(dataset.extra_metadata, metadata)

        # Mark the field as modified to ensure SQLAlchemy detects the change
        flag_modified(dataset, "extra_metadata")
        session.commit()

        return dataset.extra_metadata


def _update_nested_dict(target: Dict[str, Any], source: Dict[str, Any]):
    """
    Recursively update nested dictionaries.
    If a key is present in both, the value from source overwrites target.
    If a key is present in source but not in target, it is added to target.
    """
    for key, value in source.items():
        if key in target and isinstance(value, dict) and isinstance(target[key], dict):
            # Recursively update nested dictionaries
            _update_nested_dict(target[key], value)
        else:
            # Update or add the value
            target[key] = value