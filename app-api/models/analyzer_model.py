from enum import Enum
from uuid import UUID

from pydantic import BaseModel, RootModel, Field
from enum import Enum
from typing import Literal

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
    domain: list[str] = Field(default_factory=list) # hierarchical domain of the trace
    annotations: list[Annotation]


class InputSample(BaseModel):
    trace: str
    id: str
    domain: list[str] = Field(default_factory=list) # hierarchical domain of the trace


class TraceAnalysis(BaseModel):
    id: str
    cost: float | None = None  # cost in usd of known
    annotations: list[Annotation]


class ModelParams(BaseModel):
    model: str
    options: dict


class DebugOptions(BaseModel):
    dataset: str  # dataset name to use to push to the explorer


class ContaminationPolicyDefault(Enum):
    ID = "id"
    LAST = "last"
    ALL = "all"


ContaminationPolicy = ContaminationPolicyDefault | int    


class JobRequest(BaseModel):
    input: list[InputSample]
    annotated_samples: list[Sample]
    model_params: ModelParams
    contamination_policy: ContaminationPolicy = ContaminationPolicyDefault.ID
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


class CompleatedJobResponse(BaseModel):
    status: Literal[JobStatus.COMPLETED] = JobStatus.COMPLETED
    analysis: list[TraceAnalysis]
    clustering: list[Cluster]


class ErrorStep(BaseModel):
    step_kind: Literal["error_step"] = "error_step"
    trace_id: str
    error: str
    traceback: str


class FailedJobResponse(BaseModel):
    status: Literal[JobStatus.FAILED] = JobStatus.FAILED
    errors: list[ErrorStep]


class RunningJobResponse(BaseModel):
    status: Literal[JobStatus.RUNNING] = JobStatus.RUNNING
    num_processed: int
    total: int


class CancelledJobResponse(BaseModel):
    status: Literal[JobStatus.CANCELLED] = JobStatus.CANCELLED


class PendingJobResponse(BaseModel):
    status: Literal[JobStatus.PENDING] = JobStatus.PENDING


JobResponseUnion = (
    CompleatedJobResponse | FailedJobResponse | RunningJobResponse | CancelledJobResponse | PendingJobResponse
)

class JobResponseParser(RootModel):
    root: JobResponseUnion = Field(discriminator="status")

class AnalysisRequestOptions(BaseModel):
    model_params: ModelParams
    debug_options: DebugOptions | None = None

class AnalysisRequest(BaseModel):
    # model service
    apiurl: str
    apikey: str

    # analysis arguments
    options: AnalysisRequestOptions