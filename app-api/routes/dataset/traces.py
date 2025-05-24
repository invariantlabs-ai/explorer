"""Trace related operations for datasets."""

import re
from typing import Annotated, Any, Dict, List, Optional # Added Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool # Added
from ...util.redis_client import cache_redis # Added
from fastapi.responses import StreamingResponse
from models.datasets_and_traces import Annotation, Dataset, Trace, User, db
from models.queries import (
    AnalyzerTraceExporter,
    ExportConfig,
    TraceExporter,
    dataset_to_json,
    load_annotations,
    query_traces,
    search_term_mappings,
    trace_to_json,
)
from routes.apikeys import UserOrAPIIdentity
from routes.auth import UserIdentity
from routes.dataset.utils import load_dataset
from sqlalchemy.orm import Session

router = APIRouter()

# Synchronous helper function for database logic, adapted from original get_traces
def _get_traces_from_db(
    by: Dict[str, Any],
    user_id: Optional[UUID],
    indices: Optional[List[int]],
    limit: Optional[int],
    offset: Optional[int],
) -> List[Dict[str, Any]]:
    """
    Core logic to fetch traces from DB.
    """
    with Session(db()) as session:
        dataset, user = load_dataset(
            session, by, user_id, allow_public=True, return_user=True
        )

        traces_query = session.query(Trace).filter(Trace.dataset_id == dataset.id)

        if indices is not None:
            traces_query = traces_query.filter(Trace.index.in_(indices))
        
        # Apply limit and offset before joining annotations to optimize
        if limit is not None:
            traces_query = traces_query.limit(limit)
        if offset is not None:
            traces_query = traces_query.offset(offset)

        # Order by index before potentially complex annotation processing
        traces_query = traces_query.order_by(Trace.index)
        
        # Get the traces that match the query so far
        selected_traces = traces_query.all()

        # Efficiently fetch annotations for the selected traces
        # This part needs careful handling to reconstruct the original output structure.
        # The original code iterated through traces_with_annotations.all() which implicitly
        # handled multiple annotations per trace.
        
        output = {}
        trace_ids_for_annotation_query = [t.id for t in selected_traces]

        if not trace_ids_for_annotation_query:
            return []

        annotations_for_selected_traces = (
            session.query(Annotation)
            .filter(Annotation.trace_id.in_(trace_ids_for_annotation_query))
            .all()
        )
        
        annotations_by_trace_id = {}
        for ann in annotations_for_selected_traces:
            annotations_by_trace_id.setdefault(ann.trace_id, []).append(ann)

        for trace in selected_traces:
            output.setdefault(
                trace.index, # Original code used trace.index as key
                {
                    "id": trace.id,
                    "index": trace.index,
                    "messages": [], # This was empty in original get_traces output structure for each trace
                    "annotations_by_source": {},
                    "extra_metadata": trace.extra_metadata,
                    "name": trace.name,
                    "hierarchy_path": trace.hierarchy_path,
                },
            )
            trace_annotations = annotations_by_trace_id.get(trace.id, [])
            for annotation in trace_annotations:
                source = (
                    annotation.extra_metadata.get("source", "user")
                    if annotation.extra_metadata
                    else "user"
                )
                output[trace.index]["annotations_by_source"].setdefault(source, 0)
                output[trace.index]["annotations_by_source"][source] += 1
        
        return [output[k] for k in sorted(output.keys())] # Ensure order by index

# Async cached wrapper
@cache_redis(ttl=60) # Example TTL of 60 seconds
async def get_traces_cached(
    by: Dict[str, Any],
    user_id: Optional[UUID],
    indices: Optional[List[int]],
    limit: Optional[int],
    offset: Optional[int],
) -> List[Dict[str, Any]]:
    return await run_in_threadpool(
        _get_traces_from_db,
        by=by,
        user_id=user_id,
        indices=indices,
        limit=limit,
        offset=offset,
    )

@router.get("/byid/{id}/traces")
async def get_traces_by_id( # Changed to async
    request: Request,
    id: str, # This is dataset_id, should be UUID if possible, but load_dataset handles string.
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)],
):
    limit_str = request.query_params.get("limit")
    offset_str = request.query_params.get("offset")
    limit = int(limit_str) if limit_str and limit_str.isdigit() else None
    offset = int(offset_str) if offset_str and offset_str.isdigit() else None
    
    # The 'id' here refers to the dataset_id.
    # The original get_traces didn't use a specific trace_id list for this route.
    return await get_traces_cached(
        by={"id": id}, # 'id' is the dataset_id
        user_id=user_id,
        indices=None, # No specific trace indices for this route by default
        limit=limit,
        offset=offset
    )

@router.get("/byuser/{username}/{dataset_name}/traces")
async def get_traces_by_name( # Changed to async
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID | None, Depends(UserOrAPIIdentity)],
):
    indices_str = request.query_params.get("indices")
    indices = [int(i.strip()) for i in indices_str.split(",")] if indices_str else None
    
    limit_str = request.query_params.get("limit")
    offset_str = request.query_params.get("offset")
    limit = int(limit_str) if limit_str and limit_str.isdigit() else None
    offset = int(offset_str) if offset_str and offset_str.isdigit() else None

    return await get_traces_cached(
        by={"User.username": username, "name": dataset_name},
        user_id=user_id,
        indices=indices,
        limit=limit,
        offset=offset,
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
async def get_traces_by_name_full( # Changed to async
    request: Request, # request is no longer used directly, but kept for consistency if needed later
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID, Depends(UserIdentity)], # Changed to UUID as get_all_traces_cached expects UUID
):
    # Ensure user_id is not None, as get_all_traces_cached expects a UUID.
    # UserIdentity dependency should already enforce this if correctly configured.
    if user_id is None:
        # This case should ideally be handled by UserIdentity or authentication middleware.
        raise HTTPException(status_code=401, detail="User not authenticated")

    return await get_all_traces_cached(
        by={"User.username": username, "name": dataset_name},
        user_id=user_id
    )


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
                "Content-Disposition": f"attachment; filename={dataset.name}_analyzer_input.jsonl"
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


# Original get_traces function is now effectively replaced by _get_traces_from_db and get_traces_cached.

# Synchronous helper function for database logic for fetching all traces
def _get_all_traces_from_db(by: Dict[str, Any], user_id: UUID) -> Dict[str, Any]:
    """Get the full dataset with all traces and annotations from DB."""
    with Session(db()) as session:
        dataset, user = load_dataset(
            session, by, user_id, allow_public=True, return_user=True
        )

        out = dataset_to_json(dataset)
        out["traces"] = []

        traces = session.query(Trace).filter(Trace.dataset_id == dataset.id).all()
        for trace in traces:
            annotations = load_annotations(session, trace.id) # This is a list of (Annotation, User) tuples
            out["traces"].append(trace_to_json(trace, annotations))
        return out

# Async cached wrapper for fetching all traces
@cache_redis(ttl=3600) # Example TTL of 1 hour
async def get_all_traces_cached(by: Dict[str, Any], user_id: UUID) -> Dict[str, Any]:
    """Fetches and caches the full dataset with all traces and annotations."""
    return await run_in_threadpool(
        _get_all_traces_from_db,
        by=by,
        user_id=user_id
    )
