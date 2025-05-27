"""Analysis operations for datasets."""

import asyncio
import datetime
import uuid
from typing import Annotated
from uuid import UUID

import aiohttp
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from models.analyzer_model import AnalysisRequest, JobRequest, JobType
from models.datasets_and_traces import Dataset, DatasetJob, User, db
from models.queries import AnalyzerTraceExporter, load_jobs
from routes.auth import UserIdentity
from routes.jobs import cancel_job, check_all_jobs
from sqlalchemy.orm import Session
from util.analysis_api import AnalysisClient

router = APIRouter()


@router.get("/byid/{id}/jobs")
async def get_dataset_jobs(
    id: str,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
    request: Request,
    background_tasks: BackgroundTasks,
):
    """
    Gets all jobs associated with this dataset.
    """
    with Session(db()) as session:
        # create background task to check all jobs for progress
        task = asyncio.create_task(check_all_jobs(request.cookies.get("jwt")))
        # see if we can already get some result as part of this request
        # (but don't wait for it too long, if it takes too long, we'll
        # just return the job status as is)
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=1)
        except asyncio.TimeoutError:
            pass  # timeouts are ok

        jobs = load_jobs(session=session, dataset_id=id, user_id=user_id)
        return [job.to_dict() for job in jobs]


@router.delete("/byid/{id}/analysis")
async def cancel_analysis(
    id: str,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
    request: Request,
):
    """
    Cancel all analysis jobs associated with this dataset.
    """
    with Session(db()) as session:
        # first check for pending dataset jobs of type 'analysis'
        pending_jobs = [
            job
            for job in load_jobs(session, dataset_id=id, user_id=user_id)
            if job.extra_metadata.get("type") == JobType.ANALYSIS.value
        ]

        # try to cancel all pending jobs
        for job in pending_jobs:
            await cancel_job(session, job, request)

        # wait and check at most 2s
        wait_and_check_timeout = 2
        start_time = datetime.datetime.now()

        # wait and check for job status changes to be processed (at most 10 times)
        while len(pending_jobs) > 0:
            # set off background task for checking jobs
            asyncio.create_task(check_all_jobs())

            # get pending jobs
            pending_jobs = [
                job
                for job in load_jobs(session, dataset_id=id, user_id=user_id)
                if job.extra_metadata.get("type") == JobType.ANALYSIS.value
            ]
            # wait a bit
            await asyncio.sleep(0.5)

            # check if we waited too long overall
            if (
                datetime.datetime.now() - start_time
            ).total_seconds() > wait_and_check_timeout:
                break

        # return remaining jobs
        return {
            "jobs": [job.to_dict() for job in pending_jobs],
        }

@router.post("/byid/{id}/analysis")
async def queue_analysis(
    id: str,
    analysis_request: AnalysisRequest,
    request: Request,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
):
    """
    Queue an analysis job for a dataset.
    """


    with Session(db()) as session:
        # Check if the user has access to the dataset
        dataset = session.query(Dataset).filter(Dataset.id == id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if dataset.user_id != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        user = session.query(User).filter(User.id == dataset.user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # first check for pending dataset jobs of type 'analysis'
        pending_jobs = [
            job
            for job in load_jobs(session, dataset_id=id, user_id=user_id)
            if job.extra_metadata.get("type") == JobType.ANALYSIS.value
        ]

        # do not allow multiple analysis jobs for the same dataset
        if len(pending_jobs) > 0:
            raise HTTPException(
                status_code=400,
                detail="There is already an analysis job pending for this dataset.",
            )

        # trace exporter to transform Explorer traces to analysis model input format
        trace_exporter = AnalyzerTraceExporter(
            user_id=str(user_id),
            dataset_id=id,
            dataset_name=dataset.name,
        )
        # prepare the input for the analysis job
        (
            analyser_input_samples,
            analyser_context_samples,
        ) = await trace_exporter.analyzer_model_input(session)

        # job request
        job_request = JobRequest(
            input=analyser_input_samples,
            annotated_samples=analyser_context_samples,
            model_params=analysis_request.options.model_params,
            debug_options=analysis_request.options.debug_options,
            concurrency=analysis_request.options.concurrency,
        )

        # keep api key as secret metadata in the DB, so we can check and
        # retrieve the job status later (deleted once job is done)
        secret_metadata = {
            "apikey": analysis_request.apikey or None,
        }

        try:
            async with AnalysisClient(analysis_request.apiurl.rstrip('/'), apikey=analysis_request.apikey, request=request) as client:
                # print the following request as curl
                response = await client.post("/api/v1/analysis/job", data=job_request.model_dump_json(), headers={"Content-Type": "application/json"})
                
                # if status is bad, raise exception
                if response.status != 200:
                    raise HTTPException(
                        status_code=response.status,
                        detail="Analysis service returned an error: "
                        + str(response.status),
                    )
                result = await response.json()
                job_id = UUID(result)

                # create DatasetJob object to keep track of this job

                # basic job metadata
                job_metadata = {
                    "name": "Analysis Run",
                    "type": JobType.ANALYSIS.value,
                    "created_on": str(
                        datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    ),
                    "endpoint": analysis_request.apiurl,
                    "status": "pending",
                    "job_id": str(job_id),
                }

                job = DatasetJob(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    dataset_id=id,
                    extra_metadata=job_metadata,
                    secret_metadata=secret_metadata,
                )
                session.add(job)
                session.commit()

                return job.to_dict()
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail="Failed to reach analysis service: " + str(e),
            ) from e
