"""Policy related operations for datasets."""

import json
import time
import uuid
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from models.datasets_and_traces import DatasetPolicy, db
from pydantic import ValidationError
from routes.apikeys import UserOrAPIIdentity
from routes.auth import AuthenticatedUserIdentity, UserIdentity
from routes.dataset.utils import load_dataset
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

router = APIRouter()

# Cache for library policies
_LIBRARY_CACHE = {"timestamp": 0, "data": None}
RULE_LIBRARY_URL = "https://preview-explorer.invariantlabs.ai/rules/library.json"


@router.get("/library-policies")
async def get_rule_library_guardrails(
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
):
    """
    Get all library policies, i.e. non-generated ones but potentially useful still for any agent/dataset.
    """
    now = time.time()
    if _LIBRARY_CACHE["data"] and now - _LIBRARY_CACHE["timestamp"] < 2:
        return _LIBRARY_CACHE["data"]

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(RULE_LIBRARY_URL)
            text = response.text
            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Failed to fetch policies: {response.text}",
                )
            result = json.loads(text)
            _LIBRARY_CACHE.update({"timestamp": now, "data": result})

            return result
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502, detail=f"Failed to fetch policies: {str(e)}"
        )
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=502, detail=f"Failed to parse policies: {str(e)}"
        )


@router.post("/{dataset_id}/policy")
async def create_policy(
    request: Request,
    dataset_id: str,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)],
):
    """Creates a new policy for a dataset."""

    with Session(db()) as session:
        dataset = load_dataset(
            session, dataset_id, user_id, allow_public=True, return_user=False
        )
        # Only the owner of the dataset can create a policy for the dataset.
        if dataset.user_id != user_id:
            raise HTTPException(
                status_code=403, detail="Not allowed to create policy for this dataset"
            )
        payload = await request.json()

        # Validate payload
        if not payload:
            raise HTTPException(status_code=400, detail="Request should not be empty")
        if not payload.get("name"):
            raise HTTPException(
                status_code=400, detail="Name must be provided and non-empty"
            )
        if not payload.get("policy"):
            raise HTTPException(
                status_code=400, detail="Policy content must be provided and non-empty"
            )

        policies = dataset.extra_metadata.get("policies", [])
        try:
            policies.append(
                DatasetPolicy(
                    id=str(uuid.uuid4()),
                    name=payload.get("name"),
                    content=payload.get("policy"),
                    enabled=payload.get("enabled", True),
                    action=payload.get("action", "log"),
                    extra_metadata=payload.get("extra_metadata", {}),
                ).to_dict()
            )
        except ValidationError as e:
            raise HTTPException(status_code=400, detail="Invalid Policy string") from e

        dataset.extra_metadata["policies"] = policies
        flag_modified(dataset, "extra_metadata")
        session.commit()
        from models.queries import dataset_to_json

        return dataset_to_json(dataset)


@router.get("/byuser/{username}/{dataset_name}/policy")
async def get_policy(
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID, Depends(UserOrAPIIdentity)],
):
    """Gets all policies for a dataset."""

    with Session(db()) as session:
        dataset = load_dataset(
            session,
            {"User.username": username, "name": dataset_name},
            user_id,
            allow_public=True,
            return_user=False,
        )
        # Only the owner of the dataset can get policies for the dataset.
        if dataset.user_id != user_id:
            raise HTTPException(
                status_code=403, detail="Not allowed to get policy for this dataset"
            )
        policies = dataset.extra_metadata.get("policies", [])
        return {"policies": policies}


@router.put("/{dataset_id}/policy/{policy_id}")
async def update_policy(
    request: Request,
    dataset_id: str,
    policy_id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    """Updates a policy for a dataset."""

    with Session(db()) as session:
        dataset = load_dataset(
            session, dataset_id, user_id, allow_public=True, return_user=False
        )
        # Only the owner of the dataset can update a policy for the dataset.
        if dataset.user_id != user_id:
            raise HTTPException(
                status_code=403, detail="Not allowed to update policy for this dataset"
            )
        payload = await request.json()

        # Validate payload
        if not payload:
            raise HTTPException(status_code=400, detail="Request should not be empty")
        if "name" in payload and not payload["name"]:
            raise HTTPException(
                status_code=400, detail="Name must be non-empty if provided"
            )
        if "policy" in payload and not payload["policy"]:
            raise HTTPException(
                status_code=400, detail="Policy must be non-empty if provided"
            )

        policies = dataset.extra_metadata.get("policies", [])
        existing_policy = next((p for p in policies if p["id"] == policy_id), None)
        if not existing_policy:
            raise HTTPException(status_code=404, detail="Policy to update not found")

        try:
            # Update the name and policy content if provided in the payload.
            updated_policy = DatasetPolicy(
                id=existing_policy["id"],
                name=payload.get("name", existing_policy["name"]),
                content=payload.get("policy", existing_policy["content"]),
                enabled=payload.get("enabled", existing_policy["enabled"]),
                action=payload.get("action", existing_policy["action"]),
            ).to_dict()
            policies.append(updated_policy)
            policies.remove(existing_policy)
        except ValidationError as e:
            raise HTTPException(status_code=400, detail="Invalid Policy string") from e

        flag_modified(dataset, "extra_metadata")
        session.commit()
        from models.queries import dataset_to_json

        return dataset_to_json(dataset)


@router.delete("/{dataset_id}/policy/{policy_id}")
async def delete_policy(
    dataset_id: str,
    policy_id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    """Deletes a policy for a dataset."""

    with Session(db()) as session:
        dataset = load_dataset(
            session, dataset_id, user_id, allow_public=True, return_user=False
        )
        # Only the owner of the dataset can delete a policy for the dataset.
        if dataset.user_id != user_id:
            raise HTTPException(
                status_code=403, detail="Not allowed to delete policy for this dataset"
            )
        policies = dataset.extra_metadata.get("policies", [])

        policy = next((p for p in policies if p["id"] == policy_id), None)
        if not policy:
            raise HTTPException(status_code=404, detail="Policy not found")
        policies.remove(policy)
        dataset.extra_metadata["policies"] = policies

        flag_modified(dataset, "extra_metadata")
        session.commit()
        from models.queries import dataset_to_json

        return dataset_to_json(dataset)
