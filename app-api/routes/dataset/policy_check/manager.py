"""Policy check manager implementation."""

import asyncio
import datetime
import traceback
import uuid
from typing import Any, Dict, List, Optional
from uuid import UUID

import aiohttp
from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from logging_config import get_logger
from models.datasets_and_traces import Dataset, Trace
from .models import PolicyCheckStatus

# Setup logger for this module
logger = get_logger(__name__)


class PolicyCheckManager:
    """
    Server-level class for managing policy check jobs.
    Handles job creation, tracking, execution, and result storage.
    """

    @staticmethod
    def create_job(
        session: Session,
        dataset: Dataset,
        user_id: UUID,
        policy: str,
        policy_check_url: str,
        api_key: str,
        cookie: str,
        policy_name: str,
        parameters: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Create a new policy check job and store it in the dataset metadata.
        Returns the created job data.
        """
        if parameters is None:
            parameters = {}

        # Get trace count for the dataset to provide progress information
        trace_count = session.query(Trace).filter(Trace.dataset_id == dataset.id).count()

        if trace_count == 0:
            raise HTTPException(
                status_code=400,
                detail="Dataset has no traces to check against the policy"
            )

        # Create a job record and store it in the dataset metadata
        job_id = str(uuid.uuid4())
        job_data = {
            "id": job_id,
            "name": f"Policy Check: {policy_name}",
            "type": "policy_check",
            "created_on": str(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
            "endpoint": policy_check_url,
            "status": PolicyCheckStatus.PENDING,
            "policy_name": policy_name,
            "num_total": trace_count,
            "num_processed": 0,
            "policy": policy,
            "parameters": parameters,
            "user_id": str(user_id)
        }

        # Initialize or update policy check jobs in dataset metadata
        if "policy_check_jobs" not in dataset.extra_metadata:
            dataset.extra_metadata["policy_check_jobs"] = {}
        dataset.extra_metadata["policy_check_jobs"][job_id] = job_data

        flag_modified(dataset, "extra_metadata")
        session.commit()

        # Start the background task to process this job
        asyncio.create_task(PolicyCheckManager.process_job(str(dataset.id), job_id, api_key, cookie))
        logger.info(f"Started background task to process job {job_id}")

        return job_data

    @staticmethod
    def get_job(session: Session, dataset: Dataset, job_id: str, user_id: UUID) -> Optional[Dict[str, Any]]:
        """
        Get a specific policy check job from the dataset metadata.
        """
        # Make sure we have the most up-to-date dataset metadata
        session.refresh(dataset)

        jobs = dataset.extra_metadata.get("policy_check_jobs", {})
        job = jobs.get(job_id)

        # Check if the job exists and belongs to the user
        if job and job.get("user_id") == str(user_id):
            logger.info(f"Found job {job_id} with status: {job.get('status')}")
            logger.info(f"Job progress: {job.get('num_processed')}/{job.get('num_total')}")
            return job

        return None

    @staticmethod
    def get_jobs(session: Session, dataset: Dataset, user_id: UUID, filter_active_only: bool = False) -> List[Dict[str, Any]]:
        """
        Get all policy check jobs for a dataset, optionally filtering for active jobs only.
        """
        jobs_dict = dataset.extra_metadata.get("policy_check_jobs", {})

        # Filter jobs for this user
        user_jobs = [job for job in jobs_dict.values() if job.get("user_id") == str(user_id)]

        # Filter for active jobs if requested
        if filter_active_only:
            user_jobs = [
                job for job in user_jobs
                if job.get("status") in [PolicyCheckStatus.PENDING, PolicyCheckStatus.RUNNING]
            ]

        return user_jobs

    @staticmethod
    def get_jobs_by_policy(session: Session, dataset: Dataset, user_id: UUID, policy_name: str) -> List[Dict[str, Any]]:
        """
        Get all policy check jobs for a dataset with a specific policy name.
        """
        active_jobs = PolicyCheckManager.get_jobs(session, dataset, user_id, filter_active_only=True)
        return [job for job in active_jobs if job.get("policy_name") == policy_name]

    @staticmethod
    def cancel_jobs(session: Session, dataset: Dataset, jobs: List[Dict[str, Any]]) -> None:
        """
        Cancel the specified policy check jobs.
        """
        jobs_dict = dataset.extra_metadata.get("policy_check_jobs", {})

        for job in jobs:
            job_id = job.get("id")
            if job_id in jobs_dict:
                jobs_dict[job_id]["status"] = PolicyCheckStatus.CANCELLED

        flag_modified(dataset, "extra_metadata")
        session.commit()

    @staticmethod
    def get_results(session: Session, dataset: Dataset, job_id: str) -> Dict[str, Any]:
        """
        Get all policy check results for a dataset.
        If job_id is provided, returns only the result for that specific job.
        Otherwise, returns all results.
        """
        all_results = dataset.extra_metadata.get("policy_check_results", {})
        logger.info(f"All results: {all_results}")
        return all_results.get(job_id, {})

    @staticmethod
    def clear_results(session: Session, dataset: Dataset) -> int:
        """
        Clear all policy check results from a dataset.
        Returns the number of results cleared.
        """
        results = dataset.extra_metadata.get("policy_check_results", {})
        result_count = len(results)

        dataset.extra_metadata["policy_check_results"] = {}
        flag_modified(dataset, "extra_metadata")
        session.commit()

        return result_count

    @staticmethod
    async def process_job(dataset_id: str, job_id: str, api_key: str, cookie: str) -> None:
        """
        Process a policy check job in the background.
        This function will run the policy against each trace individually
        and store the results in the dataset metadata.
        """
        logger.info(f"Processing job {job_id} for dataset {dataset_id}")
        from models.datasets_and_traces import db
        with Session(db()) as session:
            # Get the dataset
            dataset = session.query(Dataset).filter(Dataset.id == dataset_id).first()
            if not dataset:
                logger.error(f"Dataset not found: {dataset_id}")
                return

            # Get the job from dataset metadata
            jobs = dataset.extra_metadata.get("policy_check_jobs", {})

            if job_id not in jobs:
                logger.error(f"Job not found: {job_id}")
                return

            logger.info(f"Job found: {job_id}")

            # Update job status to running
            jobs[job_id]["status"] = PolicyCheckStatus.RUNNING
            dataset.extra_metadata["policy_check_jobs"] = jobs
            flag_modified(dataset, "extra_metadata")
            session.commit()
            logger.info(f"Job status updated to running")

            try:
                # Get traces
                traces = session.query(Trace).filter(Trace.dataset_id == dataset_id).all()
                if not traces:
                    logger.warning(f"No traces found in dataset")
                    jobs = dataset.extra_metadata.get("policy_check_jobs", {})
                    if job_id in jobs:
                        jobs[job_id]["status"] = PolicyCheckStatus.FAILED
                        jobs[job_id]["error"] = "No traces found in dataset"
                        dataset.extra_metadata["policy_check_jobs"] = jobs
                        flag_modified(dataset, "extra_metadata")
                        session.commit()
                    else:
                        logger.error(f"Job {job_id} not found when trying to mark as failed due to no traces")
                    return

                logger.info(f"Found {len(traces)} traces in dataset")

                # Get job parameters
                endpoint = jobs[job_id].get("endpoint")
                policy = jobs[job_id].get("policy")
                parameters = jobs[job_id].get("parameters", {})

                logger.info(f"Endpoint: {endpoint}")
                logger.info(f"Processing policy with parameters: {parameters}")
                logger.info(f"API key found for job {job_id}")

                # Prepare headers
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}" if api_key else None,
                    "Cookie": f"jwt={cookie}" if cookie else None
                }
                # Clean up None values in headers
                headers = {k: v for k, v in headers.items() if v is not None}

                await PolicyCheckManager._process_traces(
                    session, dataset, jobs[job_id], job_id, traces, endpoint, headers, policy, parameters
                )

                logger.info(f"_process_traces completed")

                # Refresh dataset and job metadata to get the most current state
                session.refresh(dataset)
                jobs = dataset.extra_metadata.get("policy_check_jobs", {})

                # _process_traces now updates job status directly, so we don't need to do anything more
                # The status should already be COMPLETED unless it was cancelled
                logger.info(f"Job {job_id} processing completed with status: {jobs.get(job_id, {}).get('status')}")

            except Exception as e:
                # Log detailed exception with traceback
                logger.exception(f"Error processing job {job_id}: {str(e)}")
                logger.info(f"Exception traceback: {traceback.format_exc()}")

                # Handle any unexpected errors
                session.refresh(dataset)
                jobs = dataset.extra_metadata.get("policy_check_jobs", {})

                if job_id in jobs:
                    # Update job status directly in the extra_metadata
                    jobs[job_id]["status"] = PolicyCheckStatus.FAILED
                    jobs[job_id]["error"] = str(e)
                    dataset.extra_metadata["policy_check_jobs"] = jobs
                    flag_modified(dataset, "extra_metadata")
                    session.commit()
                    logger.error(f"Job {job_id} failed: {str(e)}")
                else:
                    logger.warning(f"Job {job_id} not found in dataset.extra_metadata when trying to mark as failed")

    @staticmethod
    async def _process_traces(
        session: Session,
        dataset: Dataset,
        job: Dict[str, Any],
        job_id: str,
        traces: List[Trace],
        endpoint: str,
        headers: Dict[str, str],
        policy: str,
        parameters: Dict[str, Any]
    ) -> None:
        """
        Process all traces for a policy check job.
        Updates results after each batch to enable fetching intermediate results.
        Returns nothing as results are stored in the dataset metadata.
        """
        # Initialize tracking variables and result object
        result_data = PolicyCheckManager._initialize_result(session, dataset, job, job_id, traces, policy, parameters)

        # Process traces in batches
        await PolicyCheckManager._process_trace_batches(
            session, dataset, job_id, traces, endpoint, headers, policy, parameters, result_data
        )

        # Finalize the results if job wasn't cancelled
        PolicyCheckManager._finalize_result(session, dataset, job_id)

        return None

    @staticmethod
    def _initialize_result(
        session: Session,
        dataset: Dataset,
        job: Dict[str, Any],
        job_id: str,
        traces: List[Trace],
        policy: str,
        parameters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Initialize result tracking variables and store initial result in dataset metadata.
        Returns the initialized result data for further processing.
        """
        # Initialize tracking variables
        total_traces = len(traces)

        # Create initial result object
        result = {
            "id": str(uuid.uuid4()),
            "job_id": job_id,
            "policy_name": job.get("policy_name"),
            "policy": policy,
            "parameters": parameters,
            "created_on": job.get("created_on"),
            "triggered_traces": [],
            "total_traces": total_traces,
            "triggered_count": 0,
        }

        # Initialize results in dataset metadata if needed
        if "policy_check_results" not in dataset.extra_metadata:
            dataset.extra_metadata["policy_check_results"] = {}
        elif dataset.extra_metadata["policy_check_results"] is None:
            dataset.extra_metadata["policy_check_results"] = {}

        # Store initial result
        dataset.extra_metadata["policy_check_results"][job_id] = result
        flag_modified(dataset, "extra_metadata")
        session.commit()
        logger.info(f"Initial result object created for job {job_id}")

        return {
            "triggered_traces": [],
            "error_traces": [],
            "processed_count": 0,
            "total_traces": total_traces
        }

    @staticmethod
    async def _process_trace_batches(
        session: Session,
        dataset: Dataset,
        job_id: str,
        traces: List[Trace],
        endpoint: str,
        headers: Dict[str, str],
        policy: str,
        parameters: Dict[str, Any],
        result_data: Dict[str, Any]
    ) -> None:
        """
        Process traces in batches with parallelization.
        Updates job progress and results after each batch.
        """
        triggered_traces = result_data["triggered_traces"]
        error_traces = result_data["error_traces"]
        processed_count = result_data["processed_count"]
        total_traces = result_data["total_traces"]

        # Configure batching (process multiple traces in parallel, but in controlled batches)
        batch_size = 10  # Number of traces to process in parallel

        # Process traces in batches
        for i in range(0, len(traces), batch_size):
            # Check if job was cancelled before starting new batch
            logger.info(f"Checking if job {job_id} was cancelled before starting batch {i//batch_size + 1}")

            # Check if job should continue or was cancelled
            if PolicyCheckManager._should_cancel_processing(session, dataset, job_id):
                return

            # Get current batch of traces
            batch = traces[i:i + batch_size]

            # Process the current batch
            batch_results = await PolicyCheckManager._process_batch(
                batch, endpoint, headers, policy, parameters
            )

            # Update tracking data with batch results
            processed_count += len(batch)
            for trace, result in zip(batch, batch_results):
                if result.get("triggered"):
                    triggered_traces.append(str(trace.id))
                if result.get("error"):
                    error_traces.append({"trace_id": str(trace.id), "error": result["error"]})
                    logger.warning(f"Error processing trace {trace.id}: {result['error']}")

            # Update job progress
            PolicyCheckManager._update_job_progress(
                session, dataset, job_id, processed_count, total_traces
            )

            # Update results
            PolicyCheckManager._update_batch_results(
                session, dataset, job_id, triggered_traces, error_traces
            )

    @staticmethod
    def _should_cancel_processing(session: Session, dataset: Dataset, job_id: str) -> bool:
        """
        Check if job processing should be cancelled.
        Returns True if processing should stop, False if it should continue.
        """
        # Refresh dataset and job data
        session.refresh(dataset)
        jobs = dataset.extra_metadata.get("policy_check_jobs", {})

        if job_id not in jobs:
            logger.warning(f"Job no longer exists: {job_id}")
            return True

        job = jobs[job_id]

        if job.get("status") == PolicyCheckStatus.CANCELLED:
            logger.info(f"Job {job_id} was cancelled, stopping processing")
            return True

        return False

    @staticmethod
    async def _process_batch(
        batch: List[Trace],
        endpoint: str,
        headers: Dict[str, str],
        policy: str,
        parameters: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Process a batch of traces in parallel.
        Returns the results for each trace in the batch.
        """
        batch_tasks = []

        # Create a ClientSession to be shared by all requests in this batch
        logger.info(f"Creating ClientSession for batch processing")
        async with aiohttp.ClientSession() as client_session:
            # Create a task for each trace in the batch
            for trace in batch:
                logger.info(f"Creating task for trace {trace.id}")
                # Create a task for processing this trace
                task = asyncio.create_task(
                    PolicyCheckManager._process_single_trace(
                        client_session,
                        trace,
                        endpoint,
                        headers,
                        policy,
                        parameters
                    )
                )
                batch_tasks.append(task)
            return await asyncio.gather(*batch_tasks)

    @staticmethod
    def _update_job_progress(
        session: Session,
        dataset: Dataset,
        job_id: str,
        processed_count: int,
        total_traces: int
    ) -> None:
        """
        Update job progress in dataset metadata.
        """
        session.refresh(dataset)
        jobs = dataset.extra_metadata.get("policy_check_jobs", {})
        if job_id in jobs:
            jobs[job_id]["num_processed"] = processed_count
            dataset.extra_metadata["policy_check_jobs"] = jobs
            flag_modified(dataset, "extra_metadata")
            session.commit()
            logger.info(f"Progress updated to {processed_count}/{total_traces}")
        else:
            logger.warning(f"Job {job_id} not found in dataset.extra_metadata when updating progress")

    @staticmethod
    def _update_batch_results(
        session: Session,
        dataset: Dataset,
        job_id: str,
        triggered_traces: List[str],
        error_traces: List[Dict[str, Any]]
    ) -> None:
        """
        Update results in dataset metadata after processing a batch.
        """
        session.refresh(dataset)
        results = dataset.extra_metadata.get("policy_check_results", {})
        current_result = results.get(job_id, {})

        # Update the result with latest data
        current_result["triggered_traces"] = triggered_traces
        current_result["triggered_count"] = len(triggered_traces)
        if error_traces:
            current_result["errors"] = error_traces
            current_result["error_count"] = len(error_traces)

        # Update the result in the dataset metadata
        dataset.extra_metadata["policy_check_results"][job_id] = current_result
        flag_modified(dataset, "extra_metadata")
        session.commit()
        logger.info(f"Updated results: {len(triggered_traces)} triggered traces so far")

    @staticmethod
    def _finalize_result(session: Session, dataset: Dataset, job_id: str) -> None:
        """
        Finalize the results if job wasn't cancelled.
        """
        # Refresh dataset and job data again before completing
        session.refresh(dataset)
        jobs = dataset.extra_metadata.get("policy_check_jobs", {})

        if job_id not in jobs:
            logger.warning(f"Job no longer exists: {job_id}")
            return

        job = jobs[job_id]

        # If the job wasn't cancelled, finalize the result
        if job.get("status") == PolicyCheckStatus.CANCELLED:
            logger.info(f"Job {job_id} status is {job.get('status')}, not finalizing the result")
            return

        # Get the current result object
        results = dataset.extra_metadata.get("policy_check_results", {})
        final_result = results.get(job_id, {})

        # Update final result fields
        final_result["completed_on"] = str(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

        # Update the result in the dataset metadata
        dataset.extra_metadata["policy_check_results"][job_id] = final_result

        # Update job status
        jobs[job_id]["status"] = PolicyCheckStatus.COMPLETED
        jobs[job_id]["completed_on"] = final_result["completed_on"]
        dataset.extra_metadata["policy_check_jobs"] = jobs

        flag_modified(dataset, "extra_metadata")
        session.commit()

        logger.info(f"All traces processed for job {job_id}. {final_result.get('triggered_count', 0)} triggered traces out of {final_result.get('total_traces', 0)} total.")

    @staticmethod
    async def _process_single_trace(
        client_session: aiohttp.ClientSession,
        trace: Trace,
        endpoint: str,
        headers: Dict[str, str],
        policy: str,
        parameters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Process a single trace with the policy checking API.
        Returns a dict with results and any error information.
        """
        # Prepare payload for this trace
        payload = {
            "messages": trace.content,
            "policy": policy,
            "parameters": parameters
        }

        result = {
            "triggered": False,
            "error": None
        }

        try:
            # Send the request for this trace
            async with client_session.post(
                endpoint,
                headers=headers,
                json=payload,
                timeout=30  # Add a longer timeout for trace processing
            ) as response:
                if response.status >= 400:
                    error_text = await response.text()
                    try:
                        error_detail = await response.json()
                        error_message = f"HTTP Error checking policy for trace {trace.id}: {response.status}"
                        error_message += f"\nResponse details: {error_detail}"
                    except Exception as json_err:
                        error_message = f"HTTP Error checking policy for trace {trace.id}: {response.status}"
                        error_message += f"\nResponse text: {error_text[:500]}"
                        logger.info(f"Failed to parse error response as JSON: {str(json_err)}")

                    result["error"] = error_message
                    logger.warning(error_message)
                else:
                    api_result = await response.json()
                    # Check if the policy was triggered for this trace
                    if len(api_result.get("errors", [])) > 0:
                        result["triggered"] = True
                        logger.info(f"Policy triggered for trace {trace.id}")
        except Exception as e:
            error_message = f"Error checking policy for trace {trace.id}: {str(e)}"
            result["error"] = error_message
            logger.error(error_message)
            logger.info(f"Exception traceback: {traceback.format_exc()}")

        return result