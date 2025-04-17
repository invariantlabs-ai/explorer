"""Defines routes for APIs related to dataset metadata."""

from typing import Any, List, Dict
from uuid import UUID

from fastapi import HTTPException
from logging_config import get_logger
from models.datasets_and_traces import Trace, db
from models.queries import load_dataset
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

logger = get_logger(__name__)

"""
A metadata field is a field in a datasets 'extra_metadata' dictionary that can be updated via the API.

A field is characterised by the following properties/methods:

- .validate() for data validation
    - its type (e.g. int, float, str, dict, list, etc.)
    - its custom validation properties (new values must be validated against these properties)
- .include_in_response:
    - whether it should be included in the response at the end of an update operation
- .clear_on_replace:
    whether it should be cleared when it is not present in the new metadata that is supposed to 'replace_all' the current metadata

For pre-defined metadata behavior, see also the subclasses of MetadataField below.
"""


class MetadataField:
    def __init__(
        self, key: str, include_in_response: bool = True, clear_on_replace: bool = True
    ):
        """
        :param key: The key of the field on the top level of the metadata dictionary.
        :param include_in_response: Whether to include the field in the response.
        :param clear_on_replace: Whether to delete this field, when it is not present in the new metadata that is supposed to
                                 'replace_all' the current metadata. If False, the field will be retained, even on a 'replace_all'
                                 operation, if it is not present in the new metadata.
        """
        self.key = key
        self.include_in_response = include_in_response
        self.clear_on_replace = clear_on_replace

    def validate(self, value: Any):
        raise NotImplementedError

    def update(self, metadata_dict: dict, new_value: Any | None, mode="incremental"):
        """
        Updates a field in the existing metadata dictionary.

        :param metadata_dict: The existing metadata dictionary.
        :param new_value: The new value to update the field with. If None, the field will be removed.
        :param mode: The update mode. Can be 'incremental' or 'replace_all'. In 'incremental' mode, the field will be
                        updated only if the new provided value or sub-values are not None. In 'replace_all' mode, the
                        field will be replaced with the new value if it is not None, and removed otherwise.
        """
        raise NotImplementedError


class TestReportField(MetadataField):
    def __init__(self):
        super().__init__("invariant.test_results")
        self.allowed_keys = [("num_tests", int), ("num_passed", int)]

    def validate(self, value: Any):
        if not isinstance(value, dict):
            raise HTTPException(
                status_code=400,
                detail="invariant.test_results must be a dictionary if provided",
            )

        # type check all allowed keys
        for key, ttype in self.allowed_keys:
            if key not in value:
                continue
            if not isinstance(value[key], ttype) and value[key] is not None:
                raise HTTPException(
                    status_code=400,
                    detail=f"invariant.test_results.{key} must be of type {ttype.__name__} (got {type(value[key]).__name__})",
                )

        # make sure at least one of the allowed keys is present
        if not any(key in value for key, _ in self.allowed_keys):
            raise HTTPException(
                status_code=400,
                detail="invariant.test_results must not be empty if provided",
            )

    def update(self, metadata_dict: dict, new_value: Any | None, mode="incremental"):
        valid_keys = [k for k, _ in self.allowed_keys]
        if mode == "replace_all":
            if new_value is None:
                metadata_dict.pop(self.key, None)
            else:
                metadata_dict[self.key] = {
                    k: new_value[k]
                    for k in new_value
                    if new_value[k] is not None and k in valid_keys
                }
        else:
            if new_value is not None:
                metadata_dict[self.key] = {}
                for key in new_value:
                    if new_value[key] is not None and key in valid_keys:
                        metadata_dict[self.key][key] = new_value[key]


class PrimitiveMetadataField(MetadataField):
    def __init__(
        self,
        key: str,
        ttype: type,
        include_in_response: bool = True,
        clear_on_replace: bool = True,
        none_removes_it: bool = False,
    ):
        """
        :param ttype: The type of the field.
        :param none_removes_it: Whether None should remove the field from the metadata, when updating it.
        """
        super().__init__(
            key,
            include_in_response=include_in_response,
            clear_on_replace=clear_on_replace,
        )
        self.ttype = ttype
        self.none_removes_it = none_removes_it

    def validate(self, value: Any):
        if not isinstance(value, self.ttype) and (
            value is not None or not self.none_removes_it
        ):
            types = (
                ", ".join([t.__name__ for t in self.ttype])
                if isinstance(self.ttype, tuple)
                else self.ttype.__name__
            )
            raise HTTPException(
                status_code=400, detail=f"{self.key} must be of type {types}"
            )

    def update(self, metadata_dict: dict, new_value: Any | None, mode="incremental"):
        if mode == "replace_all":
            if new_value is None:
                metadata_dict.pop(self.key, None)
            else:
                metadata_dict[self.key] = new_value
        else:
            if new_value is not None:
                metadata_dict[self.key] = new_value
            elif self.none_removes_it:
                metadata_dict.pop(self.key, None)


class NonEmptyStringMetadataField(PrimitiveMetadataField):
    def validate(self, value: Any):
        super().validate(value)
        if not value:
            raise HTTPException(
                status_code=400, detail=f"{self.key} must be a non-empty string"
            )


class PositiveNumber(PrimitiveMetadataField):
    def validate(self, value: Any):
        super().validate(value)
        if value < 0:
            raise HTTPException(
                status_code=400, detail=f"{self.key} must be a non-negative number"
            )


class ReadOnlyMetadataField(MetadataField):
    def validate(self, value: Any):
        raise HTTPException(
            status_code=400,
            detail=f"{self.key} cannot be updated via the /metadata API",
        )

    def update(self, metadata_dict: dict, new_value: Any | None, mode="incremental"):
        pass


async def update_dataset_metadata(
    user_id: UUID, dataset_name: str, metadata: dict, replace_all: bool = False
):
    """
    Updates the metadata of a dataset.

    :param dataset_name: The name of the dataset.
    :param user_id: The user ID of the dataset owner.
    :param metadata: The new metadata to update the dataset with.
    :param replace_all: Whether to replace the entire metadata dictionary with the new metadata. If False, only the
                        provided fields will be updated. Default is False.
    """
    validated_fields = [
        TestReportField(),
        NonEmptyStringMetadataField("benchmark", str),
        NonEmptyStringMetadataField("name", str),
        PositiveNumber("accuracy", (int, float)),
        ReadOnlyMetadataField(
            "policies", include_in_response=False, clear_on_replace=False
        ),
        PrimitiveMetadataField("analysis_report", str),
    ]

    # validate all allowed fields
    validated_keys = []
    for field in validated_fields:
        if field.key in metadata:
            field.validate(metadata[field.key])
        validated_keys.append(field.key)

    # make sure metadata only contains the allowed keys
    if any(key not in validated_keys for key in metadata):
        raise HTTPException(
            status_code=400,
            detail=f"metadata must only contain the keys {', '.join([k for k in validated_keys])}",
        )

    # update the metadata (based on the update mode)
    with Session(db()) as session:
        dataset_response = load_dataset(
            session,
            {"name": dataset_name, "user_id": user_id},
            user_id,
            allow_public=True,
            return_user=False,
        )
        # update all allowed fields
        if replace_all:
            for field in validated_fields:
                field.update(
                    dataset_response.extra_metadata,
                    metadata.get(field.key),
                    mode="replace_all",
                )
        else:
            for field in validated_fields:
                field.update(
                    dataset_response.extra_metadata,
                    metadata.get(field.key),
                    mode="incremental",
                )

        # mark the extra_metadata field as modified
        flag_modified(dataset_response, "extra_metadata")
        session.commit()

        metadata_response = dataset_response.extra_metadata
        updated_metadata = {}

        # system fields
        validated_field_names = [field.key for field in validated_fields]
        system_fields = [
            key for key in metadata_response if key not in validated_field_names
        ]

        # remove fields that should not be visible in the response
        for field in validated_fields:
            if field.include_in_response and field.key in metadata_response:
                updated_metadata[field.key] = metadata_response[field.key]

        # add system fields
        for field in system_fields:
            updated_metadata[field] = metadata_response[field]

        # return the updated metadata
        return updated_metadata


async def extract_and_save_batch_tool_calls(
    trace_ids: List[str] | str,
    messages_list: List[List[Dict[str, Any]]] | List[Dict[str, Any]],
    dataset_id: str = None,
    user_id: UUID = None
):
    """
    Extract tool names from messages and save them as a set in trace metadata.

    This function handles both single traces and batches of traces:
    - For a single trace, pass a string trace_id and a list of messages
    - For multiple traces, pass a list of trace_ids and a list of message lists

    Args:
        trace_ids: Either a single trace ID (str) or a list of trace IDs
        messages_list: Either a list of messages for one trace or a list of message lists
        dataset_id: Optional dataset ID for dataset-level tool registry
        user_id: User ID needed for dataset operations
    """
    if isinstance(trace_ids, str):
        logger.info(f"Processing single trace: {trace_ids}")
    else:
        logger.info(f"Extracting tool calls for {len(trace_ids)} traces")

    # Handle single trace case by converting to batch format
    if isinstance(trace_ids, str):
        trace_ids = [trace_ids]
        # Ensure messages_list is properly wrapped for a single trace
        if not all(isinstance(m, list) for m in messages_list):
            logger.info("Converting single message list to batch format")
            messages_list = [messages_list]

    try:
        with Session(db()) as session:
            # Track all tool names across all traces for dataset-level registry
            all_dataset_tools = {}

            for i, (trace_id, messages) in enumerate(zip(trace_ids, messages_list)):
                logger.info(f"Processing trace {i+1}/{len(trace_ids)}: {trace_id}")
                tool_names = {}
                tool_count = 0

                # Extract tool calls from messages
                for message in messages:
                    if "tool_calls" in message:
                        message_tool_count = len(message["tool_calls"])
                        tool_count += message_tool_count
                        logger.info(f"Found {message_tool_count} tool calls in message: {message['tool_calls']}")

                        for tool_call in message["tool_calls"]:
                            tool_call = tool_call.get("function", {})
                            if "name" in tool_call:
                                tool_info = {
                                    "name": tool_call["name"],
                                    "arguments": [k for k in tool_call.get("arguments", {}).keys()],
                                }
                                tool_names[tool_call["name"]] = tool_info
                                # Also add to dataset-level registry
                                all_dataset_tools[tool_call["name"]] = tool_info

                if tool_names:
                    logger.info(f"Extracted {len(tool_names)} unique tools from trace {trace_id}: {', '.join(tool_names.keys())}")

                    # Update the trace with the extracted tool names
                    trace = session.query(Trace).filter(Trace.id == trace_id).first()
                    if trace:
                        # Initialize metadata dict if needed
                        if not trace.extra_metadata:
                            trace.extra_metadata = {}

                        # Merge with existing tool names
                        existing_tool_names = trace.extra_metadata.get("tool_calls", {})
                        updated_tool_names = existing_tool_names | tool_names

                        # Log if new tools were added
                        new_tools = set(updated_tool_names.keys()) - set(existing_tool_names.keys())
                        if new_tools:
                            logger.info(f"Adding {len(new_tools)} new tools to trace {trace_id}")

                        # Store in metadata
                        trace.extra_metadata["tool_calls"] = updated_tool_names
                        flag_modified(trace, "extra_metadata")
                        logger.info(f"Updated metadata for trace {trace_id}")
                    else:
                        logger.warning(f"Trace {trace_id} not found in database")
                else:
                    logger.info(f"No tool calls found in trace {trace_id}")

            # Update dataset tool registry if we have a dataset and tools were found
            if dataset_id and user_id and all_dataset_tools:
                logger.info(f"Updating tool registry for dataset {dataset_id} with {len(all_dataset_tools)} tools")

                try:
                    # Load the dataset
                    dataset = load_dataset(
                        session,
                        {"id": dataset_id, "user_id": user_id},
                        user_id,
                        allow_public=True,
                        return_user=False
                    )

                    if dataset:
                        # Make sure extra_metadata exists
                        if not dataset.extra_metadata:
                            dataset.extra_metadata = {}

                        # Get existing tool registry
                        existing_tools = dataset.extra_metadata.get("tool_calls", {})

                        # Merge with new tools
                        updated_tools = existing_tools | all_dataset_tools

                        # Update dataset metadata
                        dataset.extra_metadata["tool_calls"] = updated_tools
                        flag_modified(dataset, "extra_metadata")
                        logger.info(f"Updated tool registry for dataset {dataset_id}")
                    else:
                        logger.warning(f"Dataset {dataset_id} not found in database")
                except Exception as e:
                    logger.error(f"Error updating dataset tool registry: {str(e)}")
            elif dataset_id:
                logger.info(f"No tools to update for dataset {dataset_id}")

            # Commit all changes at once
            session.commit()

    except Exception as e:
        logger.error(f"Error in tool call extraction: {str(e)}", exc_info=True)
        raise
