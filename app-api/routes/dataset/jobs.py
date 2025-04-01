"""Job management operations for datasets."""

from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from models.datasets_and_traces import db, DatasetJob
from models.queries import load_jobs
from routes.auth import UserIdentity
from routes.jobs import cleanup_stale_jobs

router = APIRouter()


@router.post("/jobs/cleanup")
async def cleanup_jobs(
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
    request: Request,
    force: bool = False,
    job_ids: List[str] = None,
):
    """
    Endpoint to clean up stale jobs for the authenticated user.

    Parameters:
    - force: If true, clean up all jobs regardless of status (only for user's own jobs)
    - job_ids: Optional list of specific job IDs to clean up (only for user's own jobs)
    """
    if job_ids:
        # Clean up specific jobs by ID (only those belonging to the current user)
        with Session(db()) as session:
            # Query only jobs that belong to the current user
            for job_id in job_ids:
                jobs = (
                    session.query(DatasetJob)
                    .filter(
                        DatasetJob.id == job_id,
                        DatasetJob.user_id == user_id,
                    )
                    .all()
                )

                for job in jobs:
                    print(f"Manually cleaning up job {job.id}", flush=True)
                    session.delete(job)

            session.commit()
        return {"message": f"Manually cleaned up {len(job_ids)} jobs"}

    # Otherwise use the standard cleanup with user_id filter
    await cleanup_stale_jobs(force_all=force, user_id=user_id)
    return {"message": "Job cleanup complete. Check logs for details."}