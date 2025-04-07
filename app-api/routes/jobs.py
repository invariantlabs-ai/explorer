"""
Jobs are the Explorer-side representation of long-running operations running on datasets
like analysis, trace generation, etc.

On the Explorer side, we regularly check the status of all jobs and update their status
in the database, and apply potential effects of their results (like updating the dataset
metadata).

Otherwise, Explorer is not responsible for the actual job execution, which is done by
other services, like the Analysis Model Inference service.
"""

import datetime
from typing import Dict, List, Any, Optional
import aiohttp
import asyncio
import json
import re
import uuid

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from models.datasets_and_traces import db, DatasetJob, Dataset
from models.analyzer_model import (
    JobStatus,
    JobResponseUnion,
    JobResponseParser,
    CompletedJobResponse,
)
from uuid import UUID
from models.queries import get_all_jobs, load_dataset
from routes.dataset_metadata import update_dataset_metadata
from logging_config import get_logger

from routes.trace import replace_annotations

# job logger
logger = get_logger(__name__)
JOB_HANDLERS = {}


def on_job_result(job_type: str):
    """
    Decorator to register a job handler for a specific job type (e.g. 'analysis').
    """

    def decorator(f):
        assert (
            job_type not in JOB_HANDLERS
        ), f"Job handler for {job_type} already registered"
        JOB_HANDLERS[job_type] = f
        return f

    return decorator


class AnalysisClient:
    """API client for the analysis model service."""

    def __init__(self, base_url: str, apikey: Optional[str] = None) -> None:
        headers = {"Authorization": f"Bearer {apikey}"} if apikey else {}
        self.session = aiohttp.ClientSession(base_url=base_url, headers=headers)

    async def status(self, job_id: str) -> JobResponseUnion:
        async with self.session.get(f"/api/v1/analysis/job/{job_id}") as resp:
            resp.raise_for_status()
            return JobResponseParser.model_validate(await resp.json()).root

    async def cancel(self, job_id: str) -> Optional[Dict[str, Any]]:
        async with self.session.put(f"/api/v1/analysis/job/{job_id}/cancel") as resp:
            resp.raise_for_status()
            return await resp.json() if resp.content_length else None

    async def delete(self, job_id: str) -> Optional[Dict[str, Any]]:
        async with self.session.delete(f"/api/v1/analysis/job/{job_id}") as resp:
            resp.raise_for_status()
            return await resp.json() if resp.content_length else None

    async def queue(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        async with self.session.post("/api/v1/analysis/job", json=payload) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def jobs(self) -> List[Dict[str, Any]]:
        async with self.session.get("/api/v1/analysis/job") as resp:
            resp.raise_for_status()
            return await resp.json()

    async def close(self) -> None:
        await self.session.close()

    async def __aenter__(self) -> "AnalysisClient":
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self.close()


# last job status check
last_job_status = datetime.datetime.now()


async def check_all_jobs():
    """
    Checks all pending database jobs with their respective endpoints, and
    processes their result if available.
    """
    global last_job_status
    # do not check twice within 1s
    if (datetime.datetime.now() - last_job_status).total_seconds() < 1:
        return
    last_job_status = datetime.datetime.now()

    # get all database jobs, irrespective of user or dataset
    with Session(db()) as session:
        jobs = get_all_jobs(session)
        if len(jobs) == 0:
            logger.info("No jobs to check")
        else:
            logger.info(f"Checking {len(jobs)} pending jobs")
        await asyncio.gather(*[check_job(session, job) for job in jobs])


async def cancel_job(session: Session, job: DatasetJob):
    """
    Cancels a job and deletes it from the database.
    """
    endpoint = job.extra_metadata.get("endpoint")
    job_id = job.extra_metadata.get("job_id")
    apikey = job.secret_metadata.get("apikey")

    try:
        async with AnalysisClient(endpoint, apikey) as client:
            await client.cancel(job_id)
    except Exception as e:
        import traceback

        print("Error cancelling job", job_id, e, traceback.format_exc(), flush=True)


async def check_job(session: Session, job: DatasetJob):
    """
    Checks the status of all active jobs and updates their status in the database.

    If the job is done, it handles the result and deletes the job from the database.
    """
    endpoint = job.extra_metadata.get("endpoint")
    job_id = job.extra_metadata.get("job_id")
    apikey = job.secret_metadata.get("apikey")
    status = job.extra_metadata.get("status")

    # keep track of how many times we checked this job
    num_checked = job.extra_metadata.get("num_checked_when_done_or_failed", 0)
    if status in [JobStatus.COMPLETED.value, JobStatus.FAILED.value]:
        job.extra_metadata["num_checked_when_done_or_failed"] = num_checked + 1
        # Mark as modified right away to ensure this counter is updated
        flag_modified(job, "extra_metadata")

    try:
        async with AnalysisClient(endpoint, apikey) as client:
            job_progress = await client.status(job_id)
            print(f"Job {job_id} has status {job_progress.status}", flush=True)

            # Update job status
            job.extra_metadata["status"] = job_progress.status.value

            # Flag as modified immediately after updating status
            flag_modified(job, "extra_metadata")

            if job_progress.status == JobStatus.FAILED:
                # Delete failed jobs after checking them a few times
                # This avoids endless polling of jobs that will never succeed
                if num_checked >= 3:  # After checking 3 times, delete the job
                    print(
                        f"Deleting failed job {job_id} after {num_checked} checks",
                        flush=True,
                    )
                    await client.delete(job_id)
                    session.delete(job)
            elif job_progress.status == JobStatus.CANCELLED:
                # delete cancelled jobs
                await client.delete(job_id)
                session.delete(job)
            elif job_progress.status == JobStatus.COMPLETED:
                if "num_total" in job.extra_metadata:
                    job.extra_metadata["num_processed"] = job.extra_metadata[
                        "num_total"
                    ]
                    flag_modified(job, "extra_metadata")

                await handle_job_result(job, job_progress)
                # delete job (so we don't handle the results again)
                await client.delete(job_id)
                session.delete(job)

                # delete job with analysis service
            elif job_progress.status == JobStatus.RUNNING:
                job.extra_metadata["num_processed"] = job_progress.num_processed
                job.extra_metadata["num_total"] = job_progress.total
                # Flag as modified immediately after updating running job metrics
                flag_modified(job, "extra_metadata")
            elif job_progress.status == JobStatus.PENDING:
                # No additional updates needed for pending status
                pass

            # Commit changes after successful status update
            try:
                session.commit()
            except Exception as e:
                session.rollback()
                logger.error(f"Error committing job status update for {job_id}: {e}")

    except aiohttp.ClientResponseError as e:
        if e.status == 404:
            # job not found, delete it from local records (nothing to track here anymore)
            logger.info(f"Job {job_id} not found with analysis service, deleting it")
            session.delete(job)
            session.commit()
        else:
            import traceback

            logger.error(f"Error handling job {job_id}: {e}\n{traceback.format_exc()}")
    except Exception as e:
        import traceback

        logger.error(f"Error handling job {job_id}: {e}\n{traceback.format_exc()}")


async def handle_job_result(job: DatasetJob, results: CompletedJobResponse):
    """
    Process the results of a job and update the database accordingly.
    """
    job_type = job.extra_metadata.get("type")
    job_id = job.extra_metadata.get("job_id")

    try:
        if job_type in JOB_HANDLERS:
            await JOB_HANDLERS[job_type](job, results)
        else:
            print(f"No handler for job type {job_type}, job {job_id}", flush=True)
    except Exception as e:
        import traceback

        print(
            f"Error handling job result for {job_type}, job {job_id}: {e}", flush=True
        )
        print(traceback.format_exc(), flush=True)


@on_job_result("analysis")
async def on_analysis_result(job: DatasetJob, results: CompletedJobResponse):
    """
    Handles the outcome of 'analysis' jobs.

    The results are stored in the dataset metadata.
    """
    with Session(db()) as session:
        dataset = load_dataset(
            session, {"id": job.dataset_id}, job.user_id, allow_public=False
        )

        source = "analyzer-model"
        # go over analysis results (trace results and report parts)
        for analysis in results.analysis:
            _ = await replace_annotations(
                session,
                analysis.id,
                job.user_id,
                source,
                [
                    {
                        "content": annotation.content,
                        "address": annotation.location,
                        "extra_metadata": {"source": source, "severity": annotation.severity},
                    } for annotation in analysis.annotations
                ],
            )
        cost = sum(a.cost for a in results.analysis if a.cost is not None)
        report = results.model_dump()
        report["cost"] = cost

        # update analysis report
        await update_dataset_metadata(
            job.user_id,
            dataset.name,
            {"analysis_report": json.dumps(report, indent=2)},
        )


@on_job_result("policy_synthesis")
async def on_policy_synthesis_result(job: DatasetJob, results: CompletedJobResponse):
    """
    Handles the outcome of 'policy_synthesis' jobs.
    Stores the generated policy in the dataset metadata for persistence.
    """
    print(
        f"Policy synthesis job {job.extra_metadata.get('job_id')} completed", flush=True
    )

    try:
        # Store policy results in dataset metadata for persistence
        with Session(db()) as session:
            try:
                # Load the dataset
                dataset = (
                    session.query(Dataset).filter(Dataset.id == job.dataset_id).first()
                )
                if not dataset:
                    print(
                        f"Dataset {job.dataset_id} not found for policy job {job.id}",
                        flush=True,
                    )
                    return

                # Initialize policies storage in metadata if needed
                if "generated_policies" not in dataset.extra_metadata:
                    dataset.extra_metadata["generated_policies"] = []
                elif dataset.extra_metadata["generated_policies"] is None:
                    dataset.extra_metadata["generated_policies"] = []

                cluster_name = job.extra_metadata.get("cluster_name", "Unnamed Cluster")
                policy_name = cluster_name
                if results.policy_code and results.success:
                    # Look for the first string in quotes between 'raise' and 'if:'
                    match = re.search(r'raise.*?"([^"]*)".*?if:', results.policy_code)
                    if match:
                        policy_name = match.group(1)
                
                policy_data = {
                    "id": str(uuid.uuid4()),
                    "cluster_name": cluster_name,
                    "policy_name": policy_name,
                    "policy_code": results.policy_code,
                    "detection_rate": results.detection_rate,
                    "success": results.success,
                    "created_on": job.extra_metadata.get("created_on"),
                }

                # Add to the generated policies list
                dataset.extra_metadata["generated_policies"].append(policy_data)
                flag_modified(dataset, "extra_metadata")

                try:
                    session.commit()
                    print(
                        f"Stored policy for cluster {policy_data['cluster_name']} in dataset metadata",
                        flush=True,
                    )
                except Exception as e:
                    session.rollback()
                    print(f"Failed to commit policy to database: {e}", flush=True)
                    import traceback

                    print(traceback.format_exc(), flush=True)
            except Exception as e:
                # Handle session-specific errors
                session.rollback()
                print(f"Session error while storing policy: {e}", flush=True)
                import traceback

                print(traceback.format_exc(), flush=True)
    except Exception as e:
        # Handle general errors
        import traceback

        print(f"Error storing policy synthesis results: {e}", flush=True)
        print(traceback.format_exc(), flush=True)


async def cleanup_stale_jobs(force_all: bool = False, user_id: UUID = None):
    """
    Utility function to clean up jobs that are stuck in a failed, completed, or cancelled state.
    This helps clean up the database when jobs aren't properly removed through the normal flow.

    Parameters:
    - force_all: If true, clean up all jobs regardless of their status
    - user_id: Optional user ID to restrict cleanup to a specific user's jobs
               If None and called from an admin endpoint, will clean up all jobs
    """
    logger.info("Cleaning up stale jobs")
    with Session(db()) as session:
        # Get jobs, filtered by user_id if provided
        jobs = get_all_jobs(session, user_id=user_id)

        # Count before cleanup
        total_jobs = len(jobs)
        if total_jobs == 0:
            logger.info("No jobs to clean up")
            return

        cleaned_up = 0

        for job in jobs:
            status = job.extra_metadata.get("status")
            job_id = job.extra_metadata.get("job_id")
            job_type = job.extra_metadata.get("type")

            # Clean up jobs that are stuck in completed, failed, or cancelled state
            # or all jobs if force_all is True
            if force_all or status in [
                JobStatus.COMPLETED.value,
                JobStatus.FAILED.value,
                JobStatus.CANCELLED.value,
            ]:
                logger.info(f"Cleaning up {status} job {job_id} (type: {job_type})")
                session.delete(job)
                cleaned_up += 1

        # Commit the changes
        session.commit()
        logger.info(f"Cleaned up {cleaned_up}/{total_jobs} jobs")
