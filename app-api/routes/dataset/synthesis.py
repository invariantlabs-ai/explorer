"""Policy synthesis operations for datasets."""

import asyncio
import datetime
import json
import uuid
from typing import Annotated, List, Optional
from uuid import UUID

import aiohttp
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from models.datasets_and_traces import db, Dataset, DatasetJob, User
from models.analyzer_model import (
    PolicyGenerationRequest,
    PolicySynthesisRequest,
    JobType,
)
from models.queries import AnalyzerTraceExporter, load_jobs
from routes.auth import UserIdentity
from routes.jobs import check_all_jobs, cancel_job

router = APIRouter()


@router.post("/byid/{id}/policy-synthesis")
async def queue_policy_synthesis(
    id: str,
    synthesis_request: PolicySynthesisRequest,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
    cluster_id: Optional[str] = None,
):
    """
    Queue a policy synthesis job for a dataset based on clusters from a previous analysis.
    If cluster_id is provided, only generate policy for that specific cluster.
    Otherwise, generate policies for all clusters.
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

        # Check if the dataset has analysis results
        if "analysis_report" not in dataset.extra_metadata:
            raise HTTPException(
                status_code=400,
                detail="No analysis results found for this dataset. Please run analysis first.",
            )

        try:
            # Parse the analysis report from dataset metadata
            analysis_results = json.loads(dataset.extra_metadata["analysis_report"])

            clusters = analysis_results.get("clustering", [])
            analysis_data = analysis_results.get("analysis", [])

            if not clusters:
                raise HTTPException(
                    status_code=400, detail="No clusters found in the analysis results"
                )
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to parse analysis results: {str(e)}",
            )

        # Create a trace exporter to get the traces in the required format
        trace_exporter = AnalyzerTraceExporter(
            user_id=str(user_id),
            dataset_id=id,
            dataset_name=dataset.name,
        )

        created_jobs = []

        # If a specific cluster ID is provided, only process that cluster
        if cluster_id:
            target_clusters = [c for c in clusters if c.get("name") == cluster_id]
            if not target_clusters:
                raise HTTPException(
                    status_code=404, detail=f"Cluster with ID {cluster_id} not found"
                )
        else:
            # Process all clusters
            target_clusters = clusters

        # For each cluster, create a policy synthesis job
        for cluster in target_clusters:
            cluster_name = cluster.get("name", "Unnamed Cluster")
            issues_indexes = cluster.get("issues_indexes", [])

            if not issues_indexes:
                continue

            # Get the trace IDs for this cluster
            trace_ids = []
            annotations = []

            for idx, annotation_idx in issues_indexes:
                # Find the corresponding analysis
                trace_analysis = next(
                    (a for a in analysis_data if a.get("id") == idx), None
                )
                if not trace_analysis:
                    continue

                # Get the annotation
                trace_annotations = trace_analysis.get("annotations", [])
                if annotation_idx < len(trace_annotations):
                    annotations.append(trace_annotations[annotation_idx])
                    trace_ids.append(idx)

            if not trace_ids:
                continue

            # Extract traces for this cluster from the dataset
            try:
                limit_traces_per_cluster = 10
                cluster_traces = await trace_exporter.get_traces_by_ids(
                    session, trace_ids
                )
                cluster_traces = cluster_traces[:limit_traces_per_cluster]

                if not cluster_traces:
                    continue

                # Create the policy generation request
                problem_description = f"Generate a policy to detect: {cluster_name}\n"
                if annotations:
                    for annotation in annotations[:limit_traces_per_cluster]:
                        problem_description += f" - {annotation.get('content', '')}\n"

                policy_request = PolicyGenerationRequest(
                    problem_description=problem_description, traces=cluster_traces
                )

                # Send the request to the policy synthesis endpoint
                async with aiohttp.ClientSession() as client:
                    async with client.post(
                        f"{synthesis_request.apiurl.rstrip('/')}/api/v1/trace-analyzer/generate-policy-async",
                        data=policy_request.model_dump_json(),
                        headers={
                            "Authorization": f"Bearer {synthesis_request.apikey}",
                            "Content-Type": "application/json",
                        },
                    ) as response:
                        if response.status != 200:
                            raise HTTPException(
                                status_code=response.status,
                                detail=f"Policy synthesis service returned an error for cluster {cluster_name}.",
                            )

                        result = await response.json()
                        policy_job_id = UUID(result)

                        # Create DatasetJob object to track this job
                        job_metadata = {
                            "name": f"Policy Synthesis for {cluster_name}",
                            "type": JobType.POLICY_SYNTHESIS.value,
                            "created_on": str(
                                datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                            ),
                            "endpoint": synthesis_request.apiurl,
                            "status": "pending",
                            "job_id": str(policy_job_id),
                            "cluster_name": cluster_name,
                        }

                        secret_metadata = {
                            "apikey": synthesis_request.apikey,
                        }

                        job = DatasetJob(
                            id=uuid.uuid4(),
                            user_id=user_id,
                            dataset_id=id,
                            extra_metadata=job_metadata,
                            secret_metadata=secret_metadata,
                        )

                        session.add(job)
                        created_jobs.append(job)
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to create policy synthesis job for cluster {cluster_name}: {str(e)}",
                )

        if not created_jobs:
            raise HTTPException(
                status_code=400,
                detail="No policy synthesis jobs were created. Check if there are valid clusters with traces.",
            )

        session.commit()

        return {
            "message": f"Created {len(created_jobs)} policy synthesis jobs",
            "jobs": [job.to_dict() for job in created_jobs],
        }


@router.delete("/byid/{id}/policy-synthesis")
async def cancel_policy_synthesis(
    id: str,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
    request: Request,
    cluster_name: Optional[str] = None,
):
    """
    Cancel policy synthesis jobs associated with this dataset.
    If cluster_name is provided, only cancel jobs for that specific cluster.
    """
    with Session(db()) as session:
        # Get pending dataset jobs of type 'policy_synthesis'
        pending_jobs = [
            job
            for job in load_jobs(session, dataset_id=id, user_id=user_id)
            if job.extra_metadata.get("type") == JobType.POLICY_SYNTHESIS.value
        ]

        # If cluster_name is provided, filter jobs for that cluster
        if cluster_name:
            pending_jobs = [
                job
                for job in pending_jobs
                if job.extra_metadata.get("cluster_name") == cluster_name
            ]

        # Try to cancel all pending jobs
        for job in pending_jobs:
            await cancel_job(session, job)

        # Wait and check at most 2s
        wait_and_check_timeout = 2
        start_time = datetime.datetime.now()

        # Wait and check for job status changes to be processed
        while len(pending_jobs) > 0:
            # Set off background task for checking jobs
            asyncio.create_task(check_all_jobs())

            # Get pending jobs again
            jobs_query = [
                job
                for job in load_jobs(session, dataset_id=id, user_id=user_id)
                if job.extra_metadata.get("type") == JobType.POLICY_SYNTHESIS.value
            ]

            # Apply cluster filter if specified
            if cluster_name:
                pending_jobs = [
                    job
                    for job in jobs_query
                    if job.extra_metadata.get("cluster_name") == cluster_name
                ]
            else:
                pending_jobs = jobs_query

            # Wait a bit
            await asyncio.sleep(0.5)

            # Check if we waited too long overall
            if (
                datetime.datetime.now() - start_time
            ).total_seconds() > wait_and_check_timeout:
                break

        # Return remaining jobs
        return {
            "jobs": [job.to_dict() for job in pending_jobs],
        }


@router.get("/byid/{id}/generated-policies")
async def get_generated_policies(
    id: str,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
    min_detection_rate: float = 0.0,
    success_only: bool = False,
):
    """
    Get all generated policies for a dataset that have been stored in metadata.

    Parameters:
    - min_detection_rate: Minimum detection rate (0.0 to 1.0) to include policy
    - success_only: If True, only include policies where success=True
    """
    # refresh job statuses when client requests this endpoint (e.g. to process potentially
    # completed jobs, since the last check)
    await check_all_jobs()

    with Session(db()) as session:
        # Check if the user has access to the dataset
        dataset = session.query(Dataset).filter(Dataset.id == id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if dataset.user_id != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Get generated policies from metadata
        all_policies = dataset.extra_metadata.get("generated_policies", [])

        # Apply filters
        filtered_policies = []
        for policy in all_policies:
            # Skip policies that didn't succeed if success_only is True
            if success_only and not policy.get("success", False):
                continue

            # Skip policies with detection_rate below min_detection_rate
            detection_rate = policy.get("detection_rate", 0.0)
            if detection_rate < min_detection_rate:
                continue

            filtered_policies.append(policy)

        return {
            "policies": filtered_policies,
            "total_count": len(all_policies),
            "filtered_count": len(filtered_policies),
        }


@router.delete("/byid/{id}/generated-policies")
async def delete_generated_policies(
    id: str,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
):
    """
    Delete all generated policies from a dataset's metadata.
    """
    with Session(db()) as session:
        # Check if the user has access to the dataset
        dataset = session.query(Dataset).filter(Dataset.id == id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if dataset.user_id != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Remove generated_policies from metadata
        if "generated_policies" in dataset.extra_metadata:
            # Store the count of deleted policies for the response
            deleted_count = len(dataset.extra_metadata.get("generated_policies", []))

            # Remove the generated_policies list
            dataset.extra_metadata["generated_policies"] = []

            flag_modified(dataset, "extra_metadata")

            # Commit the changes
            session.commit()

            return {
                "message": f"Deleted {deleted_count} generated policies",
                "deleted_count": deleted_count,
            }

        return {"message": "No generated policies to delete", "deleted_count": 0}