"""Utility functions for dataset operations."""

import json
import os
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_
from sqlalchemy.orm import Session

from models.datasets_and_traces import Dataset, User

# Load homepage dataset IDs from configuration
homepage_dataset_ids = json.load(open("homepage_datasets.json"))
homepage_dataset_ids = (
    homepage_dataset_ids["DEV"]
    if os.getenv("DEV_MODE") == "true"
    else homepage_dataset_ids["PROD"]
)

def is_duplicate(user_id: UUID, name: str) -> bool:
    """Check if a dataset with the same name already exists."""
    from models.datasets_and_traces import db
    with Session(db()) as session:
        dataset = (
            session.query(Dataset)
            .filter(and_(Dataset.user_id == user_id, Dataset.name == name))
            .first()
        )
        if dataset is not None:
            return True
    return False


def handle_dataset_creation_integrity_error(error: Exception):
    """Handle integrity error for dataset creation."""
    if "_user_id_name_uc" in str(error.orig):
        raise HTTPException(
            status_code=400, detail="Dataset with the same name already exists"
        ) from error
    raise HTTPException(
        status_code=400, detail="An integrity error occurred"
    ) from error


def str_to_bool(key: str, value: str) -> bool:
    """Convert a string to a boolean."""
    if isinstance(value, bool):  # If already a boolean, return as is
        return value
    value_lower = value.lower()
    if value_lower == "true":
        return True
    if value_lower == "false":
        return False
    raise HTTPException(
        status_code=400,
        detail=f"{key} must be a string representing a boolean like 'true' or 'false'",
    )


def load_dataset(
    session: Session,
    by: Dict[str, Any],
    user_id: Optional[UUID],
    allow_public: bool = False,
    return_user: bool = False
):
    """
    Load a dataset by various criteria.

    This is a wrapper around the original load_dataset function from models.queries
    to ensure consistent loading across dataset modules.
    """
    from models.queries import load_dataset as _load_dataset
    return _load_dataset(session, by, user_id, allow_public, return_user)