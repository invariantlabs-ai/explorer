"""
This file contains the code to parse/import a trace dataset into a compatible format.

It support both raw datasets and datasets with metadata and annotations.
"""

import datetime
import json
import uuid
from typing import Dict

from fastapi import HTTPException
from models.datasets_and_traces import Annotation, Dataset, Trace
from sqlalchemy.orm import Session
from util.util import parse_and_update_messages


def create_dataset(user_id, name, metadata, is_public: bool = False):
    """Create a dataset with given parameters."""
    dataset = Dataset(
        id=uuid.uuid4(),
        user_id=user_id,
        name=name,
        extra_metadata=metadata,
        is_public=is_public,
    )
    dataset.extra_metadata = metadata
    return dataset


def validate_file_upload(lines: list[str]) -> Dict:
    """
    Performs validations on the uploaded file:
    - Ensures the metadata row (if present) is the first row and appears exactly once.
    - Validates that the file follows either the raw event list format or the annotated event
    list format, but not both.
    - If in annotated event list format, ensures that 'index' keys are unique and consistently
    present in all rows.
    - It is possible that in the annotated event lists format, no row has an 'index' key.
    """
    has_raw_event_lists_format = False
    has_annotated_event_lists_format = False
    indices_seen = set()
    metadata_seen = False

    for line_number, line in enumerate(lines):
        parsed_line = json.loads(line)
        # Check if the line is a metadata row.
        if (
            isinstance(parsed_line, dict)
            and "metadata" in parsed_line
            and "messages" not in parsed_line
        ):
            if metadata_seen:
                raise HTTPException(
                    status_code=400,
                    detail="The metadata row can appear at most once in the file.",
                )
            if line_number != 0:
                raise HTTPException(
                    status_code=400,
                    detail="The metadata row must be the first row in the file.",
                )
            metadata_seen = True
            continue

        # Check if the line is in the raw event lists format.
        if isinstance(parsed_line, list):
            has_raw_event_lists_format = True

        # Check if the line is in the annotated event lists format.
        elif isinstance(parsed_line, dict) and "messages" in parsed_line:
            has_annotated_event_lists_format = True
            if "index" in parsed_line:
                index = parsed_line["index"]
                if not isinstance(index, int):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid index found: {index} in the file. Index must be an integer.",
                    )
                if index in indices_seen:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Duplicate index found: {index} in the file.",
                    )
                indices_seen.add(index)
            elif indices_seen:
                raise HTTPException(
                    status_code=400,
                    detail="The 'index' key is inconsistently present — found in some events but missing in others.",
                )

        # Validate that only one format is used.
        if has_annotated_event_lists_format and has_raw_event_lists_format:
            raise HTTPException(
                status_code=400,
                detail="The file cannot contain both raw event lists and annotated event lists.",
            )

    return {
        "has_raw_event_lists_format": has_raw_event_lists_format,
        "has_annotated_event_lists_format": has_annotated_event_lists_format,
        "is_metadata_present": metadata_seen,
        "are_indices_present": len(indices_seen) > 0,
    }


async def import_jsonl(
    session: Session,
    name: str,
    user_id: str,
    lines: list[str],
    metadata: dict | None = None,
    existing_dataset=None,
    is_public: bool = False,
):
    """
    Parses and reads a JSONL file and imports it into the database.

    This function assumes that the JSONL file is in the following format:

    ```
    {"metadata": {"key": "value", ...}}
    {"messages": [<event>, <event>, ...], "annotations": [...], "metadata": {"key": "value", ...}}
    {"messages": [<event>, <event>, ...], "annotations": [...], "metadata": {"key": "value", ...}}
    ```

    or alternatively:

    ```
    {"metadata": {"key": "value", ...}}
    [<event>, <event>, ...]
    [<event>, <event>, ...]
    ```

    The first line for dataset-level metadata is optional for both formats.
    """
    metadata = {
        "created_on": str(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        **(metadata or {}),
    }

    # Validate the file.
    validation_result = validate_file_upload(lines)
    # Save the metadata to the database.
    if existing_dataset is None:
        dataset = create_dataset(user_id, name, metadata, is_public)
        session.add(dataset)
    else:
        dataset = existing_dataset

    i = 0
    for line in lines:
        parsed_line = json.loads(line)
        if i == 0 and validation_result["is_metadata_present"]:
            metadata = {**metadata, **parsed_line["metadata"]}
            dataset.extra_metadata = {
                **dataset.extra_metadata,
                **parsed_line["metadata"],
            }
        elif validation_result["has_raw_event_lists_format"]:
            # If it is a list, the first message may still contain trace metadata.
            if (
                isinstance(parsed_line, list)
                and len(parsed_line) > 0
                and "metadata" in parsed_line[0].keys()
            ):
                trace_metadata = {**parsed_line[0]["metadata"]}
                parsed_line = parsed_line[1:]
            else:
                trace_metadata = {}
            # Otherwise, the list in this row, is the list of messages/events.
            trace_id = uuid.uuid4()
            parsed_messages = await parse_and_update_messages(
                name, trace_id, parsed_line
            )
            trace = Trace(
                id=trace_id,
                name=trace_metadata.get("name"),
                hierarchy_path=trace_metadata.get("hierarchy_path", []),
                user_id=user_id,
                dataset_id=dataset.id,
                content=parsed_messages,
                extra_metadata=trace_metadata,
            )
            session.add(trace)
        elif validation_result["has_annotated_event_lists_format"]:
            trace_metadata = parsed_line.get("metadata", {})
            trace_id = uuid.uuid4()
            parsed_messages = await parse_and_update_messages(
                name, trace_id, parsed_line["messages"]
            )
            trace = Trace(
                id=trace_id,
                name=parsed_line.get("name", trace_metadata.get("name")),
                hierarchy_path=parsed_line.get(
                    "hierarchy_path", trace_metadata.get("hierarchy_path", [])
                ),
                user_id=user_id,
                dataset_id=dataset.id,
                content=parsed_messages,
                extra_metadata=trace_metadata,
            )
            # If indices are present, in the jsonl file
            # use them directly instead of relying on the Postgres sequence
            # If indices are present - it has already been verified that
            # they should be unique and all traces should have them
            if validation_result["are_indices_present"]:
                index = parsed_line.get("index")
                trace.index = index
                trace.name = parsed_line.get(
                    "name", trace_metadata.get("name", f"Run {index}")
                )
            session.add(trace)

            # Required, so we can add annotations below, otherwise a foreign key constraint will fail.
            # This does not commit yet, but makes sure the DB is aware of the transaction.
            session.flush()

            annotations = parsed_line.get("annotations", [])
            for annotation in annotations:
                if "address" not in annotation or "content" not in annotation:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Failed to parse annotation: {annotation}",
                    )
                annotation = Annotation(
                    trace_id=trace.id,
                    user_id=user_id,
                    address=annotation["address"],
                    content=annotation["content"],
                    extra_metadata=annotation.get("extra_metadata", {}),
                )
                session.add(annotation)
        i = i + 1
    return dataset
