"""
This file contains the code to parse/import a trace dataset into a compatible format.

It support both raw datasets and datasets with metadata and annotations.
"""

from models.datasets_and_traces import Dataset, db, Trace, Annotation, User
from models.queries import *

from typing import Annotated
from routes.auth import UserIdentity, AuthenticatedUserIdentity

from sqlalchemy.orm import Session

import datetime
import uuid
import json

def create_dataset(user_id, name, metadata):
    """Create a dataset with given parameters."""
    dataset = Dataset(
        id=uuid.uuid4(),
        user_id=user_id,
        name=name,
        extra_metadata=metadata
    )
    dataset.extra_metadata = metadata
    return dataset

def import_jsonl(session: Session, name: str, user_id: str, lines: list[str], metadata: dict | None = None):
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
        **(metadata or {})
    }

    # save the metadata to the database
    dataset = create_dataset(user_id, name, metadata)
    session.add(dataset)
    
    metadata_row_seen = False
    i = 0
    for line in lines:
        object = json.loads(line)
        if i == 0 and type(object) is dict and "metadata" in object.keys() and not metadata_row_seen:
            metadata = {**metadata, **object["metadata"]}
            dataset.extra_metadata = {**dataset.extra_metadata, **object["metadata"]}
            metadata_row_seen = True
            continue
        else:
            # Case 1: row is directly a list of messages (raw event list)
            if type(object) is list:
                # if it is a list, the first message may still contain trace metadata
                
                # extra trace metadata if present
                if type(object) is list and len(object) > 0 and "metadata" in object[0].keys():
                    trace_metadata = {**object[0]["metadata"]}
                    object = object[1:]
                else:
                    trace_metadata = {}
                
                # otherwise, the list in this row, is the list of messages/events
                trace = Trace(
                    id=uuid.uuid4(),
                    index=i,
                    name = trace_metadata.get("name", f"Run {i}"),
                    hierarchy_path = trace_metadata.get("hierarchy_path", []),
                    user_id=user_id,
                    dataset_id=dataset.id,
                    content=object,
                    extra_metadata=trace_metadata
                )
                session.add(trace)
                i = i + 1

            # Case 2: row is an object with a 'metadata' and a 'messages' key (annotated event list)
            elif type(object) is dict and "messages" in object.keys():
                trace_metadata = object.get("metadata", {})
                
                trace = Trace(
                    id=uuid.uuid4(),
                    index=i,
                    name = object.get("name", trace_metadata.get("name", f"Run {i}")),
                    hierarchy_path = object.get("hierarchy_path", trace_metadata.get("hierarchy_path", [])),
                    user_id=user_id,
                    dataset_id=dataset.id,
                    content=object["messages"],
                    extra_metadata=trace_metadata
                )
                session.add(trace)
                
                # required, so we can add annotations below, otherwise a foreign key constraint will fail
                # does not commit yet, but makes sure the DB is aware of the transaction
                session.flush()

                annotations = object.get("annotations", [])
                for annotation in annotations:
                    if not "address" in annotation or not "content" in annotation:
                        raise ValueError(f"Failed to parse annotation: {annotation}")

                    annotation = Annotation(
                        trace_id=trace.id,
                        user_id=user_id,
                        address=annotation["address"],
                        content=annotation["content"],
                        extra_metadata=annotation.get("extra_metadata", {})
                    )
                    session.add(annotation)

                i = i + 1
            else:
                raise ValueError(f"Failed to parse line as a trace: {line}")

    return dataset
