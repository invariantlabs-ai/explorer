"""Trace related operations for datasets."""

from enum import Enum
import re
from typing import Annotated, List, Optional, Dict, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from models.datasets_and_traces import db, Dataset, Trace, Annotation, User
from models.queries import (
    trace_to_json,
    dataset_to_json,
    query_traces,
    search_term_mappings,
    load_annotations,
    ExportConfig,
    TraceExporter,
    AnalyzerTraceExporter
)
from routes.apikeys import UserOrAPIIdentity
from routes.auth import UserIdentity

from routes.dataset.utils import load_dataset

router = APIRouter()


@router.get("/byid/{id}/traces")
def get_traces_by_id(
    request: Request,
    id: str,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)],
):
    return get_traces(request, {"id": id}, user_id=user_id)


@router.get("/byuser/{username}/{dataset_name}/traces")
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


@router.get("/byuser/{username}/{dataset_name}/s")
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


@router.get("/byuser/{username}/{dataset_name}/indices")
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


@router.get("/byuser/{username}/{dataset_name}/full")
def get_traces_by_name_full(
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
):
    return get_all_traces({"User.username": username, "name": dataset_name}, user_id)


@router.get("/byid/{id}/download")
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


@router.get("/byid/{id}/download-analyzer")
async def download_traces_as_analyzer_input(
    request: Request, id: str, user_id: Annotated[UUID | None, Depends(UserIdentity)]
):
    """
    Download the dataset in JSONL format for analyzer input.
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


@router.get("/byid/{id}/download/annotated")
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


def get_traces(
    request: Request, by: Dict[str, Any], user_id: UUID | None, indices: List[int] = None
):
    """
    Get all traces corresponding to a given filtering parameter 'by'.

    Only returns the traces, if the provided user has access to corresponding dataset.

    Parameters:
    - by: dictionary of filtering parameters
    - user_id: user identity information, None for non authenticated users
    - indices: list of trace indices to filter by (optional)
    """
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
            traces_with_annotations = (
                traces.outerjoin(Annotation, Trace.id == Annotation.trace_id)
                .add_columns(Annotation)
            )
        except Exception as e:
            import traceback
            print("error", e, flush=True)
            traceback.print_exception()
        if limit is not None:
            traces_with_annotations = traces_with_annotations.limit(int(limit))
        if offset is not None:
            traces_with_annotations = traces_with_annotations.offset(int(offset))

        # order by index
        traces_with_annotations = traces_with_annotations.order_by(Trace.index)
        output = {}
        try:
            for trace, annotation in traces_with_annotations.all():
                output.setdefault(trace.index, {
                    "id": trace.id,
                    "index": trace.index,
                    "messages": [],
                    "annotations_by_source": {},
                    "extra_metadata": trace.extra_metadata,
                    "name": trace.name,
                    "hierarchy_path": trace.hierarchy_path,
                })
                if not annotation:
                    continue
                source = annotation.extra_metadata.get("source", "user") if annotation.extra_metadata else "user"
                output[trace.index]["annotations_by_source"].setdefault(source, 0)
                output[trace.index]["annotations_by_source"][source] += 1
        except Exception:
            import traceback
            print(traceback.format_exc())
        return [output[k] for k in output]


def get_all_traces(by: Dict[str, Any], user_id: UUID):
    """Get the full dataset with all traces and annotations."""
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