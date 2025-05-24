import json
from typing import Any

from models.datasets_and_traces import Annotation, Trace


class ValidationError(Exception):
    pass


class AnnotationValidationError(ValidationError):
    pass


class TraceValidationError(ValidationError):
    pass


def validate_trace(trace: Trace) -> bool:
    """Validates format of the trace."""
    return True


def validate_annotation(annotation: Annotation, trace: Trace) -> bool:
    """Validates format of the annotation based on the corresponding trace.
    We parse the address of the annotation and always ensure we can find the corresponding element in the trace,
    throwing an exception otherwise. Content of the annotation can be arbitrary string.
    """

    def move_index(curr_el: Any, index: str) -> Any:
        if index.isdigit():
            index = int(index)
        else:
            raise AnnotationValidationError(f"Index {index} is not an integer")
        if not isinstance(curr_el, list):
            raise AnnotationValidationError("Trying to access index of a non-list")
        if index >= len(curr_el):
            raise AnnotationValidationError(
                f"Index {index} out of bounds for key {key}"
            )
        curr_el = curr_el[index]
        return curr_el

    def move_key(curr_el: Any, key: str) -> Any:
        if not isinstance(curr_el, dict):
            raise AnnotationValidationError("Trying to access key of a non-dict")
        if key not in curr_el:
            raise AnnotationValidationError(f"Key {key} not found in {curr_el}")
        curr_el = curr_el[key]
        return curr_el

    address_chunks = annotation.address.split(".")
    curr_el = {"messages": json.loads(trace.content)}
    for chunk in address_chunks:
        if ":" in chunk:
            key = chunk[: chunk.index(":")]
            curr_el = move_key(curr_el, key).split("\n")
            index = chunk[chunk.index(":") + 2 :]
            index = move_index(curr_el, index)
        elif "[" in chunk:
            if chunk[-1] != "]":
                raise AnnotationValidationError(f"Index in {chunk} not closed")
            key = chunk[: chunk.index("[")]
            curr_el = move_key(curr_el, key)
            index = chunk[chunk.index("[") + 1 : -1]
            curr_el = move_index(curr_el, index)
        else:
            curr_el = move_key(curr_el, chunk)
    return True


from typing import List, Any
import uuid
from models.datasets_and_traces import OTELSpan, OTELAttribute # Assuming models are in python path

def _get_attribute_value(attributes: List[OTELAttribute], key: str) -> Any:
    """Helper to get a value from a list of OTELAttribute by key."""
    for attr in attributes:
        if attr.key == key:
            return attr.value
    return None

def validate_otel_span(span: OTELSpan) -> None:
    """
    Validates a single OTELSpan object.
    Raises ValueError if any validation fails.
    """
    if not span.trace_id:
        raise ValueError("trace_id must be present and non-empty.")
    try:
        uuid.UUID(span.trace_id)
    except ValueError:
        raise ValueError(f"trace_id '{span.trace_id}' is not a valid UUID.")

    if not span.span_id:
        raise ValueError("span_id must be present and non-empty.")
    try:
        uuid.UUID(span.span_id)
    except ValueError:
        raise ValueError(f"span_id '{span.span_id}' is not a valid UUID.")

    if not span.name or not span.name.strip():
        raise ValueError("name must be present and non-empty.")

    if span.start_time_unix_nano is None: # Check for None explicitly if type is Optional[str]
        raise ValueError("start_time_unix_nano must be present.")
    try:
        start_time = int(span.start_time_unix_nano)
    except ValueError:
        raise ValueError(f"start_time_unix_nano '{span.start_time_unix_nano}' cannot be parsed as an integer.")

    if span.end_time_unix_nano is None: # Check for None explicitly
        raise ValueError("end_time_unix_nano must be present.")
    try:
        end_time = int(span.end_time_unix_nano)
    except ValueError:
        raise ValueError(f"end_time_unix_nano '{span.end_time_unix_nano}' cannot be parsed as an integer.")

    if end_time < start_time:
        raise ValueError(f"end_time_unix_nano ({span.end_time_unix_nano}) must be greater than or equal to start_time_unix_nano ({span.start_time_unix_nano}).")

    # Attribute checks
    if span.name.startswith("llm.") or span.name.startswith("gen_ai."):
        gen_ai_system = _get_attribute_value(span.attributes, "gen_ai.system")
        if not gen_ai_system:
            # As per instruction "raise ValueError ... if any validation fails"
            raise ValueError("gen_ai.system attribute is required for LLM/gen_ai spans.")
        
        # If gen_ai.system is present, check for gen_ai.request.model
        # Assuming gen_ai_system check already passed if we reach here
        gen_ai_request_model = _get_attribute_value(span.attributes, "gen_ai.request.model")
        if not gen_ai_request_model:
            raise ValueError("gen_ai.request.model attribute is required if gen_ai.system is present for LLM/gen_ai spans.")


    token_attributes = {
        "gen_ai.usage.prompt_tokens": "Prompt tokens",
        "gen_ai.usage.completion_tokens": "Completion tokens",
        "gen_ai.usage.total_tokens": "Total tokens",
    }

    for token_key, desc_name in token_attributes.items():
        token_value = _get_attribute_value(span.attributes, token_key)
        if token_value is not None:
            try:
                token_val_int = int(token_value)
                if token_val_int < 0:
                    raise ValueError(f"{desc_name} ('{token_key}') must be a non-negative integer, got {token_val_int}.")
            except (ValueError, TypeError): # Catches if int() fails or if token_value is not suitable for int()
                raise ValueError(f"{desc_name} ('{token_key}') must be a valid integer, got '{token_value}'.")
    
    # All checks passed
    return None # Explicitly return None for success, though not strictly necessary
