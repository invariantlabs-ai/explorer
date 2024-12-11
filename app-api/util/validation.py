import json
from models.datasets_and_traces import Trace, Annotation
from typing import Any

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
            raise AnnotationValidationError(f"Trying to access index of a non-list")
        if index >= len(curr_el):
            raise AnnotationValidationError(f"Index {index} out of bounds for key {key}")
        curr_el = curr_el[index]
        return curr_el
    
    def move_key(curr_el: Any, key: str) -> Any:
        if not isinstance(curr_el, dict):
            raise AnnotationValidationError(f"Trying to access key of a non-dict")
        if key not in curr_el:
            raise AnnotationValidationError(f"Key {key} not found in {curr_el}")
        curr_el = curr_el[key]
        return curr_el

    address_chunks = annotation.address.split(".")
    curr_el = {"messages": json.loads(trace.content)}
    for chunk in address_chunks:
        if ":" in chunk:
            key = chunk[:chunk.index(":")]
            curr_el = move_key(curr_el, key).split("\n")
            index = chunk[chunk.index(":")+2:]
            index = move_index(curr_el, index)
        elif "[" in chunk:
            if chunk[-1] != "]":
                raise AnnotationValidationError(f"Index in {chunk} not closed")
            key = chunk[:chunk.index("[")]
            curr_el = move_key(curr_el, key)
            index = chunk[chunk.index("[")+1:-1]
            curr_el = move_index(curr_el, index)
        else:
            curr_el = move_key(curr_el, chunk)
    return True
