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

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from models.datasets_and_traces import db, DatasetJob
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

    async def status(self, job_id: str) -> Dict[str, Any]:
        async with self.session.get(f"/api/v1/analysis/job/{job_id}") as resp:
            resp.raise_for_status()
            return await resp.json()

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
    num_checked = job.extra_metadata.get("num_checked_when_done", 0)
    if status == "done":
        job.extra_metadata["num_checked_when_done"] = num_checked + 1

    try:
        async with AnalysisClient(endpoint, apikey) as client:
            status_response = await client.status(job_id)
            job_status = status_response.get("status")

            # update job metadata with status
            job.extra_metadata["status"] = job_status

            # if given, update number of processed items
            num_processed = status_response.get("num_processed")
            if num_processed is not None:
                job.extra_metadata["num_processed"] = num_processed

            # if given, update number of total items
            num_total = status_response.get("num_total")
            if num_total is not None:
                job.extra_metadata["num_total"] = num_total

            # if job status is cancelled, delete job
            if job_status == "done":
                # if otherwise 'results' are available, handle them
                results = status_response.get("results")
                if results is not None:
                    # handle job result
                    await handle_job_result(job, results)

                # delete job (so we don't handle the results again)
                session.delete(job)

                # delete job with analysis service
                await client.delete(job_id)

            elif job_status == "running":
                # nothing to do, we wait for completion
                pass
            elif job_status == "cancelled":
                session.delete(job)
                return
            else:
                print("Job has status", job_status, flush=True)
    except aiohttp.ClientResponseError as e:
        if e.status == 404:
            # job not found, delete it from local records (nothing to track here anymore)
            logger.info(f"Job {job_id} not found with analysis service, deleting it")
            session.delete(job)
        else:
            import traceback

            print("Error handling job", job_id, e, traceback.format_exc(), flush=True)
    except Exception as e:
        import traceback

        print("Error handling job", job_id, e, traceback.format_exc(), flush=True)
    finally:
        # update job 'extra_metadata' in the database (for status and num_checked)
        flag_modified(job, "extra_metadata")
        session.commit()


async def handle_job_result(job: DatasetJob, results: Any):
    """
    Process the results of a job and update the database accordingly.
    """
    job_type = job.extra_metadata.get("type")

    if job_type in JOB_HANDLERS:
        await JOB_HANDLERS[job_type](job, results)
    else:
        print(f"No handler for job type {job_type}", flush=True)


@on_job_result("analysis")
async def on_analysis_result(job: DatasetJob, results: Any):
    """
    Handles the outcome of 'analysis' jobs.

    The results are stored in the dataset metadata.
    """
    with Session(db()) as session:
        dataset = load_dataset(
            session, {"id": job.dataset_id}, job.user_id, allow_public=False
        )

        report = {
            "last_updated": datetime.datetime.now().isoformat(),
            "num_results": 0,
        }

        # go over analysis results (trace results and report parts)
        for result in results:
            trace_id = result.get("id")

            # handle trace ID results
            if trace_id is not None:
                analyzer_results = result.get("result")
                report["num_results"] += len(analyzer_results)

                source = "analyzer-model"

                result = await replace_annotations(
                    session,
                    trace_id,
                    job.user_id,
                    source,
                    [
                        {
                            "content": json.dumps(analyzer_results),
                            "address": "<root>",
                            "extra_metadata": {"source": source},
                        }
                    ],
                )
            elif "report" in result:
                # assign everything in the report to the report
                report.update(result["report"])

        # update analysis report
        await update_dataset_metadata(
            job.user_id,
            dataset.name,
            {"analysis_report": json.dumps(report, indent=2)},
        )
