from uuid import UUID

from pydantic import BaseModel
from enum import Enum

class Cluster(BaseModel):
    name: str | None = None
    issues_indexes: list[tuple[int, int]]


class Annotation(BaseModel):
    content: str
    location: str | None = None
    severity: float


class Sample(BaseModel):
    trace: str
    id: str
    annotations: list[Annotation]


class InputSample(BaseModel):
    trace: str
    id: str


class TraceAnalysis(BaseModel):
    id: str
    cost: float | None = None  # cost in usd of known
    annotations: list[Annotation]


class ModelParams(BaseModel):
    model: str
    options: dict


class DebugOptions(BaseModel):
    dataset: str  # dataset name to use to push to the explorer


class JobRequest(BaseModel):
    input: list[InputSample]
    annotated_samples: list[Sample]
    model_params: ModelParams
    owner: str | None = None
    debug_options: DebugOptions | None = None


class JobResponse(BaseModel):
    analysis: list[TraceAnalysis]
    clustering: list[Cluster]


class SingleAnalysisRequest(BaseModel):
    input: str
    annotated_samples: list[Sample]
    model_params: ModelParams
    debug_options: DebugOptions | None = None


class TraceAnalysisResult(BaseModel):
    issues: list[Annotation]
    cost: float | None = None  # cost in usd of known
    trace_id: UUID

class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobProgress(BaseModel):
    status: JobStatus
    num_processed: int
    total: int


class AnalysisRequestOptions(BaseModel):
    model_params: ModelParams
    debug_options: DebugOptions | None = None

class AnalysisRequest(BaseModel):
    # model service
    apiurl: str
    apikey: str

    # analysis arguments
    options: AnalysisRequestOptions