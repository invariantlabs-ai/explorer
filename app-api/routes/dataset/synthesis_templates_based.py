"""Policy synthesis from tool templates for datasets."""

import logging
from typing import Annotated, Optional, List
from uuid import UUID

import aiohttp
from fastapi import APIRouter, Depends, HTTPException
from models.datasets_and_traces import db
from models.queries import load_dataset
from routes.auth import UserIdentity
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel

from fastapi import Request
from util.analysis_api import AnalysisClient

router = APIRouter()
logger = logging.getLogger(__name__)


class ToolTemplateGenerationRequest(BaseModel):
    """Request model for policy generation from tool templates."""

    apiurl: str
    apikey: str


@router.get("/byid/{id}/templates-based-policies")
async def get_templates_based_policies(
    id: str,
    user_id: Annotated[UUID, Depends(UserIdentity)],
):
    """
    Retrieve policies that have been previously generated from tool templates
    and stored in the dataset metadata.

    Returns a list of policy objects.
    """
    with Session(db()) as session:
        logger.info(f"Retrieving template-based policies for dataset {id}")
        # Check if the user has access to the dataset
        dataset = load_dataset(
            session, {"id": id, "user_id": user_id}, user_id, allow_public=False
        )

        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Return the stored template-based policies, or empty list if none exist
        return dataset.extra_metadata.get("templates_based_policies", [])


@router.post("/byid/{id}/generate-policies-from-templates")
async def generate_policies_from_tool_templates(
    id: str,
    request_data: ToolTemplateGenerationRequest,
    request: Request,
    user_id: Annotated[UUID, Depends(UserIdentity)],
):
    """
    Generate policies from tool templates found in the dataset's tool registry.
    This is a synchronous operation that directly returns the generated policies.

    Parameters:
    - tool_filter: Optional list of tool names to filter by
    """
    with Session(db()) as session:
        # Check if the user has access to the dataset
        logger.info(
            f"Generating policies from tool templates for dataset {id}"
        )
        dataset = load_dataset(
            session, {"id": id, "user_id": user_id}, user_id, allow_public=False
        )

        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Extract tool calls from dataset metadata
        tool_calls = dataset.extra_metadata.get("tool_calls", {})

        if not tool_calls:
            raise HTTPException(
                status_code=400,
                detail="No tool calls found in dataset metadata. Make sure your dataset contains traces with tool calls or try to reupload your dataset.",
            )

        # Format the request for the template-based policy generation
        template_request = {"tools_description": tool_calls}

        try:
            # Send the request to the policy generation endpoint
            async with AnalysisClient(request_data.apiurl.rstrip('/'), apikey=request_data.apikey, request=request) as client:
                # call Analysis API endpoint
                response = await client.post("/api/v1/trace-analyzer/generate-policies-from-templates", json=template_request)

                if response.status != 200:
                    error_text = await response.text()
                    raise HTTPException(
                        status_code=response.status,
                        detail=f"Policy generation service returned an error: {error_text}",
                    )

                policies = await response.json()

            # store generated policies in dataset metadata, overwriting any existing ones
            dataset.extra_metadata["templates_based_policies"] = policies
            flag_modified(dataset, "extra_metadata")
            session.commit()

            return policies

        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to generate policies from templates: {str(e)}",
            )
