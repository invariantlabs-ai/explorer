from enum import Enum
from uuid import UUID
from typing import Literal, Optional, List, Any

from pydantic import BaseModel, RootModel, Field
from enum import Enum
from typing import Literal


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


class Cluster(BaseModel):
    name: str | None = None
    issues_indexes: list[tuple[str, int]] # index of the issue, and then index of the annotation within the issue

    def issues(self, analysis_group: list[TraceAnalysis]) -> list[Annotation]:
        annotations: list[Annotation] = []
        for idx, j in self.issues_indexes:
            correct_analysis = [trace for trace in analysis_group if trace.id == idx]
            if len(correct_analysis) != 1:
                raise ValueError(f"Expected 1 trace with id {idx}, found {len(correct_analysis)}")
            annotations.append(correct_analysis[0].annotations[j])
        return annotations


class ModelParams(BaseModel):
    model: str
    options: dict


class DebugOptions(BaseModel):
    dataset: str  # dataset name to use to push to the explorer
    api_url: str  # the URL of the API to push to
    api_key: str  # the API key to use to push to the explorer


class ContaminationPolicyDefault(Enum):
    ID = "id"
    LAST = "last"
    ALL = "all"


ContaminationPolicy = ContaminationPolicyDefault | int


class JobRequest(BaseModel):
    input: list[InputSample]
    annotated_samples: list[Sample]
    model_params: ModelParams
    concurrency: int | None = 10
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
    concurrency: int | None = 10
    debug_options: DebugOptions | None = None

class AnalysisRequest(BaseModel):
    # model service
    apiurl: str
    apikey: str

    # analysis arguments
    options: AnalysisRequestOptions


class TraceAnalyzerConfig(BaseModel):
    """Configuration for the trace analyzer."""
    # Add configuration parameters as needed

    @classmethod
    def from_settings(cls):
        return cls()


class DetectionResult(BaseModel):
    """Result of policy detection on a trace."""
    trace_id: str
    detected: bool
    explanation: Optional[str] = None


class PolicyGenerationRequest(BaseModel):
    """Request model for policy generation."""
    problem_description: str = Field(..., description="Description of the problem class to detect")
    traces: List[Any] = Field(..., description="List of traces exhibiting the problem")
    config: Optional[TraceAnalyzerConfig] = Field(
        default_factory=TraceAnalyzerConfig.from_settings,
        description="Configuration for the trace analyzer"
    )


class PolicyGenerationResponse(BaseModel):
    """Response model for policy generation."""
    success: bool = Field(..., description="Whether the policy generation was successful")
    policy_code: str = Field(..., description="The generated policy code")
    planning: Optional[str] = Field(None, description="Planning information from the LLM")
    detection_results: List[DetectionResult] = Field(
        default_factory=list,
        description="Detection results for each trace"
    )
    error_message: Optional[str] = Field(None, description="Error message if policy generation failed")