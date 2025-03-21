"""Defines routes for APIs related to dataset."""

import datetime
import json
import os
import re
import uuid
from enum import Enum
from typing import Annotated, Any, Optional
from uuid import UUID

import asyncio
from cachetools import TTLCache, cached
from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from models.datasets_and_traces import (
    Annotation,
    Dataset,
    DatasetJob,
    DatasetPolicy,
    SavedQueries,
    SharedLinks,
    Trace,
    User,
    db,
)
from sqlalchemy import and_, func

from models.importers import import_jsonl
from models.queries import (
    dataset_to_json,
    get_savedqueries,
    load_annotations,
    load_dataset,
    load_jobs,
    query_traces,
    search_term_mappings,
    trace_to_json,
    ExportConfig,
    TraceExporter,
    AnalyzerTraceExporter,
)
from models.analyzer_model import JobRequest, AnalysisRequest
from pydantic import ValidationError
from routes.apikeys import APIIdentity, UserOrAPIIdentity
from routes.auth import AuthenticatedUserIdentity, UserIdentity
from sqlalchemy import and_, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.sql import exists, func
from util.util import delete_images, validate_dataset_name

from routes.dataset_metadata import update_dataset_metadata
from routes.jobs import cancel_job, check_all_jobs

import aiohttp

homepage_dataset_ids = json.load(open("homepage_datasets.json"))
homepage_dataset_ids = (
    homepage_dataset_ids["DEV"]
    if os.getenv("DEV_MODE") == "true"
    else homepage_dataset_ids["PROD"]
)

# dataset routes
dataset = FastAPI()


def is_duplicate(user_id, name) -> bool:
    """Check if a dataset with the same name already exists."""
    with Session(db()) as session:
        dataset = (
            session.query(Dataset)
            .filter(and_(Dataset.user_id == user_id, Dataset.name == name))
            .first()
        )
        if dataset is not None:
            return True
    return False


def handle_dataset_creation_integrity_error(error: IntegrityError):
    """Handle integrity error for dataset creation."""
    if "_user_id_name_uc" in str(error.orig):
        raise HTTPException(
            status_code=400, detail="Dataset with the same name already exists"
        ) from error
    raise HTTPException(
        status_code=400, detail="An integrity error occurred"
    ) from error


def str_to_bool(key: str, value: str) -> bool:
    """Convert a string to a boolean."""
    if isinstance(value, bool):  # If already a boolean, return as is
        return value
    value_lower = value.lower()
    if value_lower == "true":
        return True
    if value_lower == "false":
        return False
    raise HTTPException(
        status_code=400,
        detail=f"{key} must be a string representing a boolean like 'true' or 'false'",
    )


@dataset.post("/create")
async def create(
    request: Request, user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)]
):
    """Create a dataset."""
    if user_id is None:
        raise HTTPException(
            status_code=401, detail="Must be authenticated to create a dataset"
        )

    data = await request.json()
    name = data.get("name")
    if name is None:
        raise HTTPException(status_code=400, detail="name must be provided")
    if not isinstance(name, str):
        raise HTTPException(status_code=400, detail="name must be a string")
    validate_dataset_name(name)

    metadata = data.get("metadata", dict())
    if not isinstance(metadata, dict):
        raise HTTPException(status_code=400, detail="metadata must be a dictionary")
    metadata["created_on"] = str(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    is_public = data.get("is_public", False)
    if not isinstance(is_public, bool):
        raise HTTPException(status_code=400, detail="is_public must be a boolean")

    with Session(db()) as session:
        dataset = Dataset(
            id=uuid.uuid4(),
            user_id=user_id,
            name=name,
            is_public=is_public,
            extra_metadata=metadata,
        )
        dataset.extra_metadata = metadata
        session.add(dataset)
        try:
            session.commit()
        except IntegrityError as e:
            session.rollback()
            handle_dataset_creation_integrity_error(e)
        return dataset_to_json(dataset)


@dataset.post("/upload")
async def upload_file(
    request: Request,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
    file: UploadFile = File(...),
):
    """Create a dataset via file upload."""
    # get name and is_public from the form
    form = await request.form()
    name = form.get("name")
    # is_public is a string because of Multipart request, convert to boolean
    is_public = str_to_bool("is_public", form.get("is_public", "false"))

    if user_id is None:
        raise HTTPException(
            status_code=401, detail="Must be authenticated to upload a dataset"
        )
    validate_dataset_name(name)

    # Fail eagerly if a dataset with the same name already exists with some traces
    existing_dataset = None
    with Session(db()) as session:
        existing_dataset = (
            session.query(Dataset)
            .filter(and_(Dataset.user_id == user_id, Dataset.name == name))
            .first()
        )
        if existing_dataset is not None:
            trace_count = (
                session.query(Trace)
                .filter(Trace.dataset_id == existing_dataset.id)
                .count()
            )
            if trace_count > 0:
                raise HTTPException(
                    status_code=400,
                    detail="Dataset with the same name already exists with traces, to add new traces use the push API",
                )

    with Session(db()) as session:
        lines = file.file.readlines()
        dataset = await import_jsonl(
            session,
            name,
            user_id,
            lines,
            existing_dataset=existing_dataset,
            is_public=is_public,
        )
        session.commit()
        return dataset_to_json(dataset)


########################################
# list all datasets, but without their traces
########################################


class DatasetKind(Enum):
    PRIVATE = "private"
    PUBLIC = "public"
    HOMEPAGE = "homepage"
    ANY = "any"


@cached(TTLCache(maxsize=1, ttl=1800))
def fetch_homepage_datasets(limit: Optional[int] = None) -> list[dict[str, Any]]:
    """
    Fetches and caches the homepage datasets with a time-to-live (TTL) cache.
    """
    if not homepage_dataset_ids:
        return []

    with Session(db()) as session:
        datasets = (
            session.query(Dataset, User)
            .join(User, User.id == Dataset.user_id)
            .filter(and_(Dataset.is_public, Dataset.id.in_(homepage_dataset_ids)))
            .limit(limit)
            .all()
        )
    return [dataset_to_json(dataset, user) for dataset, user in datasets]


@dataset.get("/list")
def list_datasets(
    kind: DatasetKind,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)],
    limit: Optional[int] = None,
):
    with Session(db()) as session:
        if kind == DatasetKind.HOMEPAGE:
            # Use cached results for HOMEPAGE datasets
            return fetch_homepage_datasets(limit)

        # Base query joining Dataset with User and getting latest trace time
        query = (
            session.query(
                Dataset, User, func.max(Trace.time_created).label("latest_trace_time")
            )
            .join(User, User.id == Dataset.user_id)
            .outerjoin(Trace, Trace.dataset_id == Dataset.id)
            .group_by(Dataset.id, User.id)
        )

        if kind == DatasetKind.PRIVATE:
            query = query.filter(Dataset.user_id == user_id)
        elif kind == DatasetKind.PUBLIC:
            query = query.filter(Dataset.is_public)
        elif kind == DatasetKind.ANY:
            query = query.filter(or_(Dataset.is_public, Dataset.user_id == user_id))

        # Order by latest trace time if exists, otherwise by dataset creation time
        datasets = (
            query.order_by(
                func.coalesce(func.max(Trace.time_created), Dataset.time_created).desc()
            )
            .limit(limit)
            .all()
        )
        return [
            dataset_to_json(dataset, user, latest_trace_time=latest_trace_time)
            for dataset, user, latest_trace_time in datasets
        ]


@dataset.get("/list/byuser/{user_name}")
def list_datasets_by_user(
    request: Request,
    user_name: str,
    user: Annotated[UUID | None, Depends(UserIdentity)],
):
    with Session(db()) as session:
        user_exists = session.query(exists().where(User.username == user_name)).scalar()
        if not user_exists:
            raise HTTPException(status_code=404, detail="User not found")
        datasets = (
            session.query(Dataset, User)
            .join(User, User.id == Dataset.user_id)
            .filter(and_(User.username == user_name, Dataset.is_public))
            .all()
        )
        return [dataset_to_json(dataset, user) for dataset, user in datasets]


########################################
# delete dataset
########################################


async def delete_dataset(
    by: dict, user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)]
):
    with Session(db()) as session:
        dataset = load_dataset(session, by, user_id)

        # delete all saved queries
        session.query(SavedQueries).filter(
            SavedQueries.dataset_id == dataset.id
        ).delete()

        # delete all traces
        traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).all()
        trace_ids = [trace.id for trace in traces]

        # delete all annotations
        session.query(Annotation).filter(Annotation.trace_id.in_(trace_ids)).delete()
        # delete all shared links
        session.query(SharedLinks).filter(SharedLinks.trace_id.in_(trace_ids)).delete()
        # delete all images
        image_deletion_tasks = [
            delete_images(dataset_name=dataset.name, trace_id=str(trace_id))
            for trace_id in trace_ids
        ]
        await asyncio.gather(*image_deletion_tasks)

        # delete all traces
        session.query(Trace).filter(Trace.dataset_id == dataset.id).delete()

        # delete dataset
        session.delete(dataset)

        # delete the trace index sequence for the dataset (if it exists)
        sequence_name = f"dataset_seq_{str(dataset.id).replace('-', '_')}"
        session.execute(text(f"DROP SEQUENCE IF EXISTS {sequence_name}"))

        session.commit()

        return {"message": "Deleted"}


@dataset.delete("/byid/{id}")
async def delete_dataset_by_id(
    request: Request,
    id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    return await delete_dataset({"id": id}, user_id)


@dataset.delete("/byuser/{username}/{dataset_name}")
async def delete_dataset_by_name(
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    return await delete_dataset(
        {"User.username": username, "name": dataset_name}, user_id
    )


########################################
# gets details on a dataset (including collections, but without traces)
########################################


def get_dataset(by: dict, user_id: UUID | None) -> dict:
    # may be None in case of anonymous users/public datasets or traces
    with Session(db()) as session:
        dataset, user = load_dataset(
            session, by, user_id, allow_public=True, return_user=True
        )
        # count all traces
        num_traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).count()
        return dataset_to_json(
            dataset,
            user,
            num_traces=num_traces,
            queries=get_savedqueries(session, dataset, user_id, num_traces),
        )


@dataset.get("/byid/{id}")
def get_dataset_by_id(
    request: Request,
    id: str,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)],
):
    return get_dataset({"id": id}, user_id=user_id)


@dataset.get("/byuser/{username}/{dataset_name}")
def get_dataset_by_name(
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)],
):
    return get_dataset(
        {"User.username": username, "name": dataset_name}, user_id=user_id
    )


########################################
# search
########################################


@dataset.get("/byuser/{username}/{dataset_name}/s")
def search_dataset_by_name(
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
    query: str = None,
):
    with Session(db()) as session:
        by = {"User.username": username, "name": dataset_name}
        dataset, _ = load_dataset(
            session, by, user_id, allow_public=True, return_user=True
        )

        mappings = {}
        result = {}
        result["Other Traces"] = {
            "traces": [],
            "description": "Traces without Analyzer results",
            "severity": 0,
        }

        if query.strip() == "is:invariant":
            pattern = re.compile(r"[a-zA-Z]+\((.*)\)")
            traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).all()
            for trace in traces:
                annotations = load_annotations(session, trace.id)
                trace_with_match = False
                for annotation, _ in annotations:
                    # TODO replace with actual parsing
                    if annotation.content.startswith("Invariant analyzer result"):
                        violations = annotation.content[
                            len("Invariant analyzer result: ") :
                        ].strip()
                        for line in violations.split("\n"):
                            line = line.strip()
                            if match := pattern.match(line):
                                trace_with_match = True
                                title = match.group(1).split(",")[0]
                                if title not in result:
                                    result[title] = {"traces": []}
                                result[title]["traces"].append(trace.index)
                if not trace_with_match:
                    result["Other Traces"]["traces"].append(trace.index)
        elif query.strip().startswith("filter"):
            # e.g. query=filter:some message:16,21,25,26,35
            filter_query = query.strip()[len("filter:") :].strip()
            filter_message, indices = filter_query.split(":")
            indices = [int(i) for i in indices.split(",")]
            result[filter_message] = {
                "traces": indices,
                "description": "filtered selection",
            }
        elif query.strip().startswith("idfilter"):
            # e.g. query=filter:some message:16,21,25,26,35
            try:
                filter_query = query.strip()[len("idfilter:") :].strip()
                filter_message, indices = filter_query.split(":", 1)
                trace_ids = [str(i) for i in indices.split(",")]
                trace_ids = [UUID(i) for i in trace_ids]  # Convert to UUID objects
                # query traces that match the given IDs
                traces = session.query(Trace).filter(Trace.id.in_(trace_ids)).all()
                result[filter_message] = {
                    "traces": [trace.index for trace in traces],
                    "description": "filtered selection",
                }
            except Exception as e:
                import traceback

                print("error", e, flush=True)
                traceback.print_exception()
                raise e
        else:
            selected_traces, search_term, filter_terms = query_traces(
                session, dataset, query
            )
            for trace in selected_traces:
                mappings[trace.index] = search_term_mappings(trace, search_term)

            result[query] = {}
            result[query]["traces"] = list(
                sorted([trace.index for trace in selected_traces])
            )
            has_search_term = search_term is not None and len(search_term) > 0
            has_filter = len(filter_terms) > 0
            if has_search_term and has_filter:
                result[query]["description"] = "filtered search result"
            elif has_search_term:
                result[query]["description"] = "search result"
            elif has_filter:
                result[query]["description"] = "filtered result"

        return {"result": result, "mappings": mappings}


@dataset.put("/byuser/{username}/{dataset_name}/s")
async def save_query(
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    with Session(db()) as session:
        by = {"User.username": username, "name": dataset_name}
        dataset, _ = load_dataset(
            session, by, user_id, allow_public=True, return_user=True
        )
        data = await request.json()
        savedquery = SavedQueries(
            user_id=user_id,
            dataset_id=dataset.id,
            query=data["query"],
            name=data["name"],
        )
        session.add(savedquery)
        session.commit()


@dataset.delete("/query/{query_id}")
async def delete_query(
    request: Request,
    query_id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    with Session(db()) as session:
        query = session.query(SavedQueries).filter(SavedQueries.id == query_id).first()

        if query.user_id != user_id:
            raise HTTPException(status_code=403, detail="Not allowed to delete query")

        session.delete(query)
        session.commit()


########################################
# update the dataset, currently only allows to change the visibility
########################################


async def update_dataset(
    request: Request,
    by: dict,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    with Session(db()) as session:
        dataset, user = load_dataset(session, by, user_id, return_user=True)
        payload = await request.json()
        is_public = bool(payload.get("content"))
        dataset.is_public = is_public
        session.commit()

        # count all traces
        num_traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).count()
        return dataset_to_json(
            dataset,
            num_traces=num_traces,
            queries=get_savedqueries(session, dataset, user_id, num_traces),
        )


@dataset.put("/byid/{id}")
async def update_dataset_by_id(
    request: Request,
    id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    return await update_dataset(request, {"id": id}, user_id)


@dataset.put("/byuser/{username}/{dataset_name}")
async def update_dataset_by_name(
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    return await update_dataset(
        request, {"User.username": username, "name": dataset_name}, user_id
    )


########################################
# get all traces of a dataset
########################################

"""
Get all traces corresponding to a given filtering parameter 'by'.

Only returns the traces, if the provided user has access to corresponding dataset.

Parameters:
- by: dictionary of filtering parameters
- user_id: user identity information, None for non authenticated users
- indices: list of trace indices to filter by (optional)
"""


def get_traces(
    request: Request, by: dict, user_id: UUID | None, indices: list[int] = None
):
    # extra query parameter to filter by index
    limit = request.query_params.get("limit")
    offset = request.query_params.get("offset")

    # users can be anonymous, so user_id can be None

    with Session(db()) as session:
        dataset, user = load_dataset(
            session, by, user_id, allow_public=True, return_user=True
        )

        traces = session.query(Trace).filter(Trace.dataset_id == dataset.id)

        # if indices are provided, filter by them (match on column 'index')
        if indices is not None:
            traces = traces.filter(Trace.index.in_(indices))

        # with join, count number of annotations per trace

        try:
            traces = (
                traces.outerjoin(Annotation, Trace.id == Annotation.trace_id)
                .group_by(Trace.id)
                .add_columns(
                    Trace.name,
                    Trace.hierarchy_path,
                    Trace.id,
                    Trace.index,
                    Trace.extra_metadata,
                    func.count(Annotation.id).label("num_annotations"),
                    func.count(Annotation.id)
                    .filter(
                        ~func.coalesce(
                            Annotation.extra_metadata.op("->>")("source"), ""
                        ).in_(["analyzer-model", "analyzer", "test-assertion", "test-assertion-passed", "test-expectation", "test-expectation-passed"])
                    )
                    .label("num_line_annotations"),
                )
            )
        except Exception as e:
            import traceback
            print("error", e, flush=True)
            traceback.print_exception()
        if limit is not None:
            traces = traces.limit(int(limit))
        if offset is not None:
            traces = traces.offset(int(offset))

        # order by index
        traces = traces.order_by(Trace.index)

        traces = traces.all()

        return [
            {
                "id": trace.id,
                "index": trace.index,
                "messages": [],
                "num_annotations": trace.num_annotations,
                "num_line_annotations": trace.num_line_annotations,
                "extra_metadata": trace.extra_metadata,
                "name": trace.name,
                "hierarchy_path": trace.hierarchy_path,
            }
            for trace in traces
        ]


@dataset.get("/byid/{id}/traces")
def get_traces_by_id(
    request: Request,
    id: str,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)],
):
    return get_traces(request, {"id": id}, user_id=user_id)


@dataset.get("/byid/{id}/download")
async def download_traces_by_id(
    request: Request, id: str, user_id: Annotated[UUID | None, Depends(UserIdentity)]
):
    """
    Download the dataset in JSONL format.
    """
    export_config = ExportConfig.from_request(request)

    with Session(db()) as session:
        exporter = TraceExporter(
            user_id=user_id,
            dataset_id=id,
            export_config=export_config,
        )
        # streams out trace data
        return await exporter.stream(session)


@dataset.get("/byid/{id}/download-analyzer")
async def download_traces_as_analyzer_input(
    request: Request, id: str, user_id: Annotated[UUID | None, Depends(UserIdentity)]
):
    """
    Download the dataset in JSONL format.
    """
    with Session(db()) as session:
        # Check if the user has access to the dataset
        try:
            id = UUID(id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid dataset ID")
        dataset = session.query(Dataset).filter(Dataset.id == id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if dataset.user_id != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        user = session.query(User).filter(User.id == dataset.user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        trace_exporter = AnalyzerTraceExporter(
            user_id=str(user_id),
            dataset_id=id,
            dataset_name=dataset.name,
        )
        _, analyser_context_samples = await trace_exporter.analyzer_model_input(session)

        async def stream_analyzer_input():
            for sample in analyser_context_samples:
                yield sample.model_dump_json() + "\n"

        return StreamingResponse(
            content=stream_analyzer_input(),
            media_type="application/json",
            headers={
                "Content-Disposition": f"attachment; filename={dataset.name}_analyzer_input.json"
            },
        )


@dataset.get("/byid/{id}/jobs")
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
        task = asyncio.create_task(check_all_jobs())
        # see if we can already get some result as part of this request
        # (but don't wait for it too long, if it takes too long, we'll
        # just return the job status as is)
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=1)
        except asyncio.TimeoutError:
            pass  # timeouts are ok

        jobs = load_jobs(session=session, dataset_id=id, user_id=user_id)
        return [job.to_dict() for job in jobs]


@dataset.delete("/byid/{id}/analysis")
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
            if job.extra_metadata.get("type") == "analysis"
        ]

        # try to cancel all pending jobs
        for job in pending_jobs:
            await cancel_job(session, job)

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
                if job.extra_metadata.get("type") == "analysis"
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


@dataset.post("/byid/{id}/analysis")
async def queue_analysis(
    id: str,
    analysis_request: AnalysisRequest,
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

        username = user.username
        # first check for pending dataset jobs of type 'analysis'
        pending_jobs = [
            job
            for job in load_jobs(session, dataset_id=id, user_id=user_id)
            if job.extra_metadata.get("type") == "analysis"
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
            owner=username,
            debug_options=analysis_request.options.debug_options,
            concurrency=analysis_request.options.concurrency,
        )

        # keep api key as secret metadata in the DB, so we can check and
        # retrieve the job status later (deleted once job is done)
        secret_metadata = {
            "apikey": analysis_request.apikey,
        }
        try:
            async with aiohttp.ClientSession() as client:
                # print the following request as curl
                async with client.post(
                    f"{analysis_request.apiurl.rstrip('/')}/api/v1/analysis/job",
                    data=job_request.model_dump_json(),
                    headers={
                        "Authorization": f"Bearer {analysis_request.apikey}",
                        "Content-Type": "application/json",
                    },
                ) as response:
                    # if status is bad, raise exception
                    if response.status != 200:
                        raise HTTPException(
                            status_code=response.status,
                            detail="Analysis service returned an error.",
                        )
                    result = await response.json()
                    job_id = UUID(result)

                    # create DatasetJob object to keep track of this job

                    # basic job metadata
                    job_metadata = {
                        "name": "Analysis Run",
                        "type": "analysis",
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
            raise HTTPException(
                status_code=500,
                detail="Failed to reach analysis service: " + str(e),
            ) from e


@dataset.get("/byid/{id}/download/annotated")
async def download_annotated_traces_by_id(
    request: Request, id: str, user_id: Annotated[UUID | None, Depends(UserIdentity)]
) -> StreamingResponse:
    export_config = ExportConfig.from_request(request)

    export_config.only_annotated = True

    with Session(db()) as session:
        exporter = TraceExporter(
            user_id=user_id,
            dataset_id=id,
            export_config=export_config,
        )
        # streams out trace data
        return await exporter.stream(session)


@dataset.get("/byuser/{username}/{dataset_name}/traces")
def get_traces_by_name(
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)],
):
    indices = request.query_params.get("indices")
    indices = [int(i) for i in indices.split(",")] if indices is not None else None
    return get_traces(
        request,
        {"User.username": username, "name": dataset_name},
        user_id=user_id,
        indices=indices,
    )


# lightweight version of /traces above that only returns the indices+ids (saving performance on the full join and prevents loading all columns of the traces table)
@dataset.get("/byuser/{username}/{dataset_name}/indices")
def get_trace_indices_by_name(
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
):
    with Session(db()) as session:
        dataset, user = load_dataset(
            session,
            {"User.username": username, "name": dataset_name},
            user_id,
            allow_public=True,
            return_user=True,
        )
        # traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).order_by(Trace.index).offset(offset).limit(limit)
        # only select the index
        trace_rows = (
            session.query(Trace.index, Trace.id, Trace.name, Trace.hierarchy_path)
            .filter(Trace.dataset_id == dataset.id)
            .order_by(Trace.index)
            .all()
        )
        return [
            {
                "index": row[0],
                "id": row[1],
                "name": row[2],
                "messages": [],
                "hierarchy_path": row[3],
            }
            for row in trace_rows
        ]


@dataset.get("/byuser/{username}/{dataset_name}/full")
def get_traces_by_name_full(
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
):
    return get_all_traces({"User.username": username, "name": dataset_name}, user_id)


########################################
# get the full dataset with all traces and annotations
########################################


def get_all_traces(by: dict, user_id: Annotated[UUID, Depends(UserIdentity)]):
    with Session(db()) as session:
        dataset, user = load_dataset(
            session, by, user_id, allow_public=True, return_user=True
        )

        out = dataset_to_json(dataset)
        out["traces"] = []

        traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).all()
        for trace in traces:
            annotations = load_annotations(session, trace.id)
            out["traces"].append(trace_to_json(trace, annotations))
        return out


@dataset.post("/{dataset_id}/policy")
async def create_policy(
    request: Request,
    dataset_id: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
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
                ).to_dict()
            )
        except ValidationError as e:
            raise HTTPException(status_code=400, detail="Invalid Policy string") from e

        dataset.extra_metadata["policies"] = policies
        flag_modified(dataset, "extra_metadata")
        session.commit()
        return dataset_to_json(dataset)


@dataset.get("/byuser/{username}/{dataset_name}/policy")
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


@dataset.put("/{dataset_id}/policy/{policy_id}")
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
        return dataset_to_json(dataset)


@dataset.delete("/{dataset_id}/policy/{policy_id}")
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
        return dataset_to_json(dataset)


@dataset.get("/metadata/{dataset_name}")
async def get_metadata(
    dataset_name: str,
    user_id: Annotated[UUID, Depends(APIIdentity)],
    owner_username: str = None,  # The username of the owner of the dataset (u/<username>).
):
    """
    Get metadata for a dataset. The owner_username is an optional parameter that can be provided
    to get metadata for a dataset owned by a specific user. This corresponds to the username
    of the user which is unique.
    - If `owner_username` is provided, return the metadata for the dataset if
      it is public or if the caller is the same owner_username. If the dataset is private and
      the caller is not the owner of the dataset, return a 403.
    - If no `owner_username` is provided, return the metadata for the dataset if
      the caller is the owner of the dataset.
    """

    with Session(db()) as session:
        if owner_username:
            owner_user = (
                session.query(User).filter(User.username == owner_username).first()
            )
            dataset_response = load_dataset(
                session,
                by={"name": dataset_name, "user_id": owner_user.id},
                user_id=owner_user.id,
                allow_public=True,
                return_user=False,
            )
            # If the dataset is private and the caller is not the owner of the dataset,
            # return a 403.
            if not dataset_response.is_public and user_id != owner_user.id:
                raise HTTPException(
                    status_code=403,
                    detail="Not allowed to view metadata for this dataset",
                )
        else:
            dataset_response = load_dataset(
                session,
                by={"name": dataset_name, "user_id": user_id},
                user_id=user_id,
                allow_public=True,
                return_user=False,
            )

        metadata_response = dataset_response.extra_metadata

        metadata_response.pop("policies", None)

        return {
            **metadata_response,
        }


# register update metadata route
@dataset.put("/metadata/{dataset_name}")
async def update_metadata(
    dataset_name: str,
    request: Request,
    user_id: Annotated[UUID, Depends(UserOrAPIIdentity)],
):
    """Update metadata for a dataset. Only the owner of a dataset can update its metadata."""

    payload = await request.json()
    metadata = payload.get("metadata", {})

    # make sure metadata is a dictionary
    if not isinstance(metadata, dict):
        raise HTTPException(status_code=400, detail="metadata must be a dictionary")

    # we support two update modes: 'incremental' (default) or 'replace_all' (when replace_all is True)
    # When replace_all is False (incremental update):
    # * If a field doesn't exist or is None in the payload, ignore it (keep the existing value).
    # * Otherwise, update the field in extra_metadata with the new value.
    # When replace_all is True:
    # * If a field doesn't exist or is None in the payload, delete the field from extra_metadata.
    # * Otherwise, update the field in extra_metadata with the new value.

    # This holds true for nested objects like invariant.test_results too.
    # Thus the caller cannot update only a part of the nested object - they need to provide the
    # full object.
    replace_all = payload.get("replace_all", False)
    if not isinstance(replace_all, bool):
        raise HTTPException(status_code=400, detail="replace_all must be a boolean")

    return await update_dataset_metadata(user_id, dataset_name, metadata, replace_all)
