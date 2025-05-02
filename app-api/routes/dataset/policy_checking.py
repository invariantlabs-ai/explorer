"""Streaming policy check endpoint implementation."""

import asyncio
import json
from typing import Annotated, Any, Dict
from uuid import UUID

from pydantic import BaseModel, Field
import aiohttp
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from logging_config import get_logger
from models.datasets_and_traces import Dataset, Trace, db
from models.queries import load_dataset
from routes.auth import UserIdentity

# Setup logger for this module
logger = get_logger(__name__)

router = APIRouter()

async def process_single_trace(
    trace: Trace,
    policy: str,
    policy_check_url: str,
    headers: Dict[str, str],
    cookie: str,
    parameters: Dict[str, Any],
    client_session: aiohttp.ClientSession,
) -> Dict[str, Any]:
    """Process a single trace and return its result."""
    # Prepare payload for this trace
    payload = {
        "messages": trace.content,
        "policy": policy,
        "parameters": parameters
    }

    print(cookie)

    try:
        # Send the request for this trace
        async with client_session.post(
            policy_check_url,
            headers=headers,
            json=payload,
            timeout=30,
            # set cookies
            cookies=cookie,
        ) as response:
            result = {
                "traceId": str(trace.id),
                "index": trace.index,
                "status": "error" if response.status >= 400 else "success"
            }

            if response.status >= 400:
                error_text = await response.text()
                try:
                    error_detail = await response.json()
                    result["error"] = f"HTTP Error: {response.status}\nDetails: {error_detail}"
                except:
                    result["error"] = f"HTTP Error: {response.status}\nResponse: {error_text[:500]}"
            else:
                api_result = await response.json()
                result["triggered"] = len(api_result.get("errors", [])) > 0
                if result["triggered"]:
                    result["errors"] = api_result.get("errors", [])

            return result

    except Exception as e:
        return {
            "traceId": str(trace.id),
            "status": "error",
            "error": str(e)
        }

async def policy_check_stream(
    request: Request,
    dataset: Dataset,
    policy: str,
    policy_check_url: str,
    api_key: str,
    cookie: str,
    parameters: Dict[str, Any],
    session: Session,
    max_concurrent: int = 4
):
    """Generate streaming policy check results with parallel processing."""
    
    # Prepare headers for policy check API
    headers = {
        "Content-Type": "application/json",
        "Authorization": api_key if api_key else None
    }
    # Clean up None values in headers
    headers = {k: v for k, v in headers.items() if v is not None}

    # Get all traces for the dataset
    traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).all()
    if not traces:
        yield "data: " + json.dumps({"error": "No traces found in dataset"}) + "\n\n"
        return

    # Create a semaphore to limit concurrent requests
    semaphore = asyncio.Semaphore(max_concurrent)

    async with aiohttp.ClientSession() as client_session:
        # Yield metadata
        yield "data: " + json.dumps({
            "metadata": {
                "num_traces": len(traces),
                "max_concurrent": max_concurrent
            }
        }) + "\n\n"

        # Create tasks for all traces
        async def process_with_semaphore(trace):
            async with semaphore:
                if await request.is_disconnected():
                    return None
                return await process_single_trace(
                    trace, policy, policy_check_url, headers, cookie, parameters, client_session
                )

        tasks = [process_with_semaphore(trace) for trace in traces]

        # Process traces in parallel and yield results as they complete
        for completed_task in asyncio.as_completed(tasks):
            try:
                result = await completed_task
                if result is not None:  # Only yield if client is still connected
                    yield "data: " + json.dumps(result) + "\n\n"
                    await asyncio.sleep(0.1)  # Small delay between yields
            except Exception as e:
                logger.error(f"Error processing trace: {str(e)}")
                continue

            # Check if client disconnected
            if await request.is_disconnected():
                logger.info("Client disconnected, stopping policy check stream")
                break

class PolicyCheckRequest(BaseModel):
    policy: str
    policy_check_url: str
    parameters: Dict[str, Any] | None = None

@router.post("/byid/{dataset_id}/policy-check/stream")
async def stream_policy_check(
    request: Request,
    dataset_id: UUID,
    policy_check_request: PolicyCheckRequest,
    user_id: Annotated[UUID | None, Depends(UserIdentity)] = None
):
    """
    Stream policy check results for each trace in a dataset.

    Returns SSE Events with results as they become available.

    When the request is dropped, or streaming stops, the guardrails
    evaluation is also stopped.
    """
    try:
        policy = policy_check_request.policy
        policy_check_url = policy_check_request.policy_check_url
        max_concurrent = 5
        
        api_key = request.headers.get("Authorization")
        cookie = request.cookies
        parameters = policy_check_request.parameters

        with Session(db()) as session:
            # Get dataset and verify access
            dataset = load_dataset(
                    session,
                    {"id": dataset_id},
                    user_id,
                    allow_public=False
                )
            
            if parameters is None:
                parameters = {}

            return StreamingResponse(
                policy_check_stream(
                    request,
                    dataset,
                    policy,
                    policy_check_url,
                    api_key,
                    cookie,
                    parameters,
                    session,
                    max_concurrent
                ),
                media_type="text/event-stream"
            ) 
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise e