"""API routes for policy check operations."""

import json
import traceback
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from logging_config import get_logger
from models.datasets_and_traces import db, Dataset
from models.queries import load_dataset
from routes.auth import UserIdentity
from .manager import PolicyCheckManager

# Setup logger for this module
logger = get_logger(__name__)

router = APIRouter()


@router.post("/byid/{id}/policy-check")
async def queue_policy_check(
    id: str,
    request: Request,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
):
    """
    Queue a policy check job for a dataset.
    This will run the policy over all traces in the dataset and return the IDs of traces that triggered the policy.

    Input:
    - policy: String containing the policy code
    - parameters: Optional parameters for policy evaluation
    - policy_check_url: URL of the policy checking service
    - api_key: API key for policy checking service (for local development)
    - cookie: jwt cookie for the policy checking service (for production)

    Either cookie or api_key must be provided.
    """
    try:
        # Validate the request JSON format
        try:
            data = await request.json()
            logger.info(f"Received policy check request for dataset {id}")
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in policy check request: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Invalid JSON in request: {str(e)}")

        # Extract request parameters
        policy = data.get("policy")
        if not policy:
            logger.warning(f"Missing policy in request for dataset {id}")
            raise HTTPException(status_code=400, detail="Policy must be provided")

        parameters = data.get("parameters", {})
        policy_check_url = data.get("policy_check_url")
        if not policy_check_url:
            logger.warning(f"Missing policy check URL in request for dataset {id}")
            raise HTTPException(status_code=400, detail="Policy check URL must be provided")

        api_key = data.get("api_key")
        cookie = data.get("cookie")
        if not api_key and not cookie:
            logger.warning(f"Missing API key or cookie in request for dataset {id}")
            raise HTTPException(status_code=400, detail="Either API key or cookie must be provided")

        policy_name = data.get("name", "Unnamed Policy")

        with Session(db()) as session:
            # Check if the user has access to the dataset
            try:
                dataset = load_dataset(
                    session, {"id": id}, user_id, allow_public=True, return_user=False
                )
                logger.info(f"User {user_id} loaded dataset {id}")
            except HTTPException as e:
                logger.warning(f"User {user_id} failed to access dataset {id}: {e.detail}")
                raise e

            try:
                # Create the job using the manager
                job_data = PolicyCheckManager.create_job(
                    session=session,
                    dataset=dataset,
                    user_id=user_id,
                    policy=policy,
                    policy_check_url=policy_check_url,
                    api_key=api_key,
                    cookie=cookie,
                    policy_name=policy_name,
                    parameters=parameters
                )

                logger.info(f"Policy check job {job_data['id']} created for dataset {id} by user {user_id}")
                return {
                    "message": "Policy check job queued successfully",
                    "job": job_data
                }
            except Exception as e:
                logger.error(f"Error creating policy check job for dataset {id}: {str(e)}")
                logger.info(f"Exception traceback: {traceback.format_exc()}")
                raise HTTPException(status_code=500, detail=f"Error creating policy check job: {str(e)}")

    except HTTPException:
        # Re-raise HTTP exceptions as they already have the right format
        raise
    except Exception as e:
        logger.error(f"Unexpected error in queue_policy_check for dataset {id}: {str(e)}")
        logger.info(f"Exception traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@router.delete("/byid/{id}/policy-check")
async def cancel_policy_check(
    id: str,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
    request: Request,
    policy_name: Optional[str] = None,
):
    """
    Cancel policy check jobs associated with this dataset.
    If policy_name is provided, only cancel jobs for that specific policy.
    """
    try:
        with Session(db()) as session:
            # Check if the user has access to the dataset
            try:
                dataset = load_dataset(
                    session, {"id": id}, user_id, allow_public=True, return_user=False
                )
                logger.info(f"User {user_id} loaded dataset {id} for cancellation")
            except HTTPException as e:
                logger.warning(f"User {user_id} failed to access dataset {id} for cancellation: {e.detail}")
                raise e

            # Get jobs to cancel
            if policy_name:
                logger.info(f"Cancelling jobs for policy '{policy_name}' in dataset {id}")
                jobs_to_cancel = PolicyCheckManager.get_jobs_by_policy(session, dataset, user_id, policy_name)
            else:
                logger.info(f"Cancelling all active jobs in dataset {id}")
                jobs_to_cancel = PolicyCheckManager.get_jobs(session, dataset, user_id, filter_active_only=True)

            # Cancel the jobs
            PolicyCheckManager.cancel_jobs(session, dataset, jobs_to_cancel)

            job_ids = [job.get("id") for job in jobs_to_cancel]
            logger.info(f"Cancelled {len(jobs_to_cancel)} jobs for dataset {id}: {job_ids}")

            # Return cancelled jobs
            return {
                "jobs": jobs_to_cancel,
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in cancel_policy_check for dataset {id}: {str(e)}")
        logger.info(f"Exception traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@router.get("/byid/{id}/policy-check-results/{job_id}")
async def get_policy_check_results(
    id: str,
    job_id: str,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
):
    """
    Get policy check results for a dataset that have been stored in metadata.
    """
    try:
        with Session(db()) as session:
            # Check if the user has access to the dataset
            dataset = session.query(Dataset).filter(Dataset.id == id).first()
            if not dataset:
                logger.warning(f"Dataset {id} not found when requesting policy check results")
                raise HTTPException(status_code=404, detail="Dataset not found")
            if dataset.user_id != user_id:
                logger.warning(f"User {user_id} denied access to policy check results for dataset {id}")
                raise HTTPException(status_code=403, detail="Access denied")

            # Get policy check results
            logger.info(f"Getting policy check results for job {job_id} for dataset {id}")
            results = PolicyCheckManager.get_results(session, dataset, job_id)
            logger.info(f"Retrieved policy check results for job {job_id} for dataset {id}: {results}")

            return {
                "results": results,
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_policy_check_results for dataset {id}: {str(e)}")
        logger.info(f"Exception traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@router.delete("/byid/{id}/policy-check-results")
async def delete_policy_check_results(
    id: str,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
):
    """
    Delete all policy check results from a dataset's metadata.
    """
    try:
        with Session(db()) as session:
            # Check if the user has access to the dataset
            dataset = session.query(Dataset).filter(Dataset.id == id).first()
            if not dataset:
                logger.warning(f"Dataset {id} not found when deleting policy check results")
                raise HTTPException(status_code=404, detail="Dataset not found")
            if dataset.user_id != user_id:
                logger.warning(f"User {user_id} denied access to delete policy check results for dataset {id}")
                raise HTTPException(status_code=403, detail="Access denied")

            # Clear results
            deleted_count = PolicyCheckManager.clear_results(session, dataset)
            logger.info(f"Deleted {deleted_count} policy check results for dataset {id}")

            return {
                "message": f"Deleted {deleted_count} policy check results",
                "deleted_count": deleted_count,
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in delete_policy_check_results for dataset {id}: {str(e)}")
        logger.info(f"Exception traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@router.get("/byid/{id}/policy-check-jobs")
async def get_policy_check_jobs(
    id: str,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
):
    """
    Get all policy check jobs for a dataset.
    """
    try:
        with Session(db()) as session:
            # Check if the user has access to the dataset
            try:
                dataset = load_dataset(
                    session, {"id": id}, user_id, allow_public=True, return_user=False
                )
                logger.info(f"User {user_id} loaded dataset {id} for job listing")
            except HTTPException as e:
                logger.warning(f"User {user_id} failed to access dataset {id} for job listing: {e.detail}")
                raise e

            # Get jobs from the manager
            user_jobs = PolicyCheckManager.get_jobs(session, dataset, user_id)
            logger.info(f"Retrieved {len(user_jobs)} policy check jobs for dataset {id}")

            return {
                "jobs": user_jobs,
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_policy_check_jobs for dataset {id}: {str(e)}")
        logger.info(f"Exception traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@router.get("/byid/{id}/policy-check-job/{job_id}")
async def get_policy_check_job_status(
    id: str,
    job_id: str,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
):
    """
    Get the status of a specific policy check job.
    """
    try:
        with Session(db()) as session:
            # Check if the user has access to the dataset
            try:
                dataset = load_dataset(
                    session, {"id": id}, user_id, allow_public=True, return_user=False
                )
                logger.info(f"User {user_id} loaded dataset {id} to check job {job_id}")
            except HTTPException as e:
                logger.warning(f"User {user_id} failed to access dataset {id} to check job {job_id}: {e.detail}")
                raise e

            # Get the job from the manager
            job = PolicyCheckManager.get_job(session, dataset, job_id, user_id)
            logger.info(f"Job {job_id} status: {job.get('status') if job else 'Not found'}")

            if not job:
                logger.warning(f"Job {job_id} not found for dataset {id} and user {user_id}")
                raise HTTPException(status_code=404, detail="Job not found")

            return job
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_policy_check_job_status for job {job_id}, dataset {id}: {str(e)}")
        logger.info(f"Exception traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")