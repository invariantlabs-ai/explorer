from enum import Enum
from typing import Any, List, Literal
from uuid import UUID

from pydantic import BaseModel, Field, RootModel


class Annotation(BaseModel):
    content: str
    location: str | None = None
    severity: float | None


class Sample(BaseModel):
    trace: str
    id: str
    domain: list[str] = Field(default_factory=list)  # hierarchical domain of the trace
    annotations: list[Annotation]


class InputSample(BaseModel):
    trace: str
    id: str
    domain: list[str] = Field(default_factory=list)  # hierarchical domain of the trace


class TraceAnalysis(BaseModel):
    id: str
    cost: float | None = None  # cost in usd of known
    annotations: list[Annotation]


class Cluster(BaseModel):
    name: str | None = None
    issues_indexes: list[
        tuple[str, int]
    ]  # index of the issue, and then index of the annotation within the issue

    def issues(self, analysis_group: list[TraceAnalysis]) -> list[Annotation]:
        annotations: list[Annotation] = []
        for idx, j in self.issues_indexes:
            correct_analysis = [trace for trace in analysis_group if trace.id == idx]
            if len(correct_analysis) != 1:
                raise ValueError(
                    f"Expected 1 trace with id {idx}, found {len(correct_analysis)}"
                )
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


class JobType(str, Enum):
    ANALYSIS = "analysis"
    POLICY_SYNTHESIS = "policy_synthesis"


class CompletedJobResponse(BaseModel):
    status: Literal[JobStatus.COMPLETED] = JobStatus.COMPLETED
    type: JobType  # Add a type field to discriminate between completed job types


class CompletedAnalysisJobResponse(CompletedJobResponse):
    type: Literal[JobType.ANALYSIS] = JobType.ANALYSIS
    analysis: list[TraceAnalysis]
    clustering: list[Cluster]


class CompletedPolicySynthesisJobResponse(CompletedJobResponse):
    type: Literal[JobType.POLICY_SYNTHESIS] = JobType.POLICY_SYNTHESIS
    success: bool = Field(
        ..., description="Whether the policy synthesis was successful"
    )
    policy_code: str = Field(..., description="The generated policy code")
    detection_rate: float = Field(
        ..., description="The detection rate for the traces from the request"
    )


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


class PolicyGenerationRequest(BaseModel):
    """Request model for policy synthesis."""

    problem_description: str = Field(
        ..., description="Description of the problem class to detect"
    )
    traces: List[Any] = Field(
        ...,
        description="List of traces exhibiting the problem, each trace is a list of dicts, each dict is one message in openai format",
    )


class PolicySynthesisRequest(BaseModel):
    """Request model for policy synthesis API calls."""

    # model service connection information
    apiurl: str = Field(
        ..., description="The URL of the API to send policy synthesis requests to"
    )
    apikey: str = Field(..., description="The API key to use for authentication")


JobResponseUnion = (
    CompletedAnalysisJobResponse
    | CompletedPolicySynthesisJobResponse
    | FailedJobResponse
    | RunningJobResponse
    | CancelledJobResponse
    | PendingJobResponse
)


class JobResponseParser(RootModel):
    """
    Root model for parsing job responses based on their status and type.
    Uses a two-level discrimination approach - first by status, then by job type for completed jobs.
    """

    root: JobResponseUnion

    @classmethod
    def validate_request(cls, v):
        """Custom validator for job responses"""
        if isinstance(v, dict):
            status = v.get("status")

            # Handle completed jobs with two-level discrimination
            if status == JobStatus.COMPLETED:
                # Add backward compatibility for responses without type
                job_type = v.get("type")

                # If type is missing, infer it from the fields
                if not job_type:
                    if "analysis" in v and "clustering" in v:
                        job_type = JobType.ANALYSIS
                        v["type"] = job_type
                    elif "policy_code" in v and "success" in v:
                        job_type = JobType.POLICY_SYNTHESIS
                        v["type"] = job_type
                    else:
                        # Default to analysis for legacy responses
                        job_type = JobType.ANALYSIS
                        v["type"] = job_type

                # Create appropriate completed job response
                try:
                    if job_type == JobType.ANALYSIS:
                        return CompletedAnalysisJobResponse(**v)
                    elif job_type == JobType.POLICY_SYNTHESIS:
                        return CompletedPolicySynthesisJobResponse(**v)
                except Exception as e:
                    # If validation fails, try to adapt the response
                    if job_type == JobType.POLICY_SYNTHESIS:
                        # Ensure all required fields are present
                        if "success" not in v:
                            v["success"] = False
                        if "policy_code" not in v:
                            v["policy_code"] = ""
                        if "detection_rate" not in v:
                            v["detection_rate"] = 0.0
                        return CompletedPolicySynthesisJobResponse(**v)
                    # Re-raise if we can't adapt
                    raise e

            # Handle other job statuses
            elif status == JobStatus.FAILED:
                return FailedJobResponse(**v)
            elif status == JobStatus.RUNNING:
                return RunningJobResponse(**v)
            elif status == JobStatus.CANCELLED:
                return CancelledJobResponse(**v)
            elif status == JobStatus.PENDING:
                return PendingJobResponse(**v)

            raise ValueError(f"Unknown job status: {status}")

        return v

    def __init__(self, **data):
        if "root" in data:
            super().__init__(**data)
        else:
            # If root isn't provided, treat the data as if it were the root
            validated_data = self.validate_request(data)
            super().__init__(root=validated_data)


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
