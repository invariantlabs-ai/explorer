"""Defines routes for APIs related to dataset metadata."""

from typing import Any, List, Dict, Optional # Added Optional
from uuid import UUID
import json # Added json

from fastapi import HTTPException
from logging_config import get_logger
from models.datasets_and_traces import Trace, db, OTELSpan, OTELAttribute # Added OTELSpan, OTELAttribute
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
    trace_ids: List[str] | str, # For OTEL, this will be List[str]
    messages_batch: List[Any], # For OTEL, this will be List[str] (JSON strings of OTELSpans)
    dataset_id: Optional[UUID] = None, # Changed to Optional[UUID]
    user_id: Optional[UUID] = None, # Changed to Optional[UUID]
    trace_format: str = "jsonl", # Added trace_format parameter
):
    """
    Extract tool names from messages and save them as a set in trace metadata.
    For JSONL, messages_batch is List[List[Dict[str, Any]]].
    For OTEL, messages_batch is List[str] where each string is a JSON representation of an OTELSpan.

    This function handles both single traces and batches of traces:
    - For a single trace, pass a string trace_id and a list of messages
    - For multiple traces, pass a list of trace_ids and a list of message lists

    Args:
        trace_ids: Either a single trace ID (str) or a list of trace IDs
        messages_list: Either a list of messages for one trace or a list of message lists
        dataset_id: Optional dataset ID for dataset-level tool registry
        user_id: User ID needed for dataset operations
    """
    if isinstance(trace_ids, str): # Should not happen if push.py sends List[str]
        trace_ids = [trace_ids]
        if trace_format == "jsonl" and (not messages_batch or not isinstance(messages_batch[0], list)):
             messages_batch = [messages_batch] # Wrap if it's a single list of messages for JSONL

    if not trace_ids:
        logger.info("No trace IDs provided for tool call extraction.")
        return

    logger.info(f"Extracting tool calls for {len(trace_ids)} traces, format: {trace_format}")

    try:
        with Session(db()) as session:
            all_dataset_tools = {} # For dataset-level registry, common for both formats

            if trace_format == "jsonl":
                if not all(isinstance(m_list, list) for m_list in messages_batch):
                    logger.error("Invalid messages_batch format for JSONL: expected List[List[Dict]]")
                    return

                for i, trace_id_str in enumerate(trace_ids):
                    if i >= len(messages_batch):
                        logger.warning(f"Skipping trace ID {trace_id_str} due to missing messages list.")
                        continue
                    
                    current_messages = messages_batch[i]
                    logger.info(f"Processing JSONL trace {i+1}/{len(trace_ids)}: {trace_id_str}")
                    tool_names_for_trace = {} # Tools for this specific trace

                    for message_event in current_messages:
                        if isinstance(message_event, dict) and "tool_calls" in message_event and message_event["tool_calls"]:
                            for tool_call_data in message_event["tool_calls"]:
                                function_data = tool_call_data.get("function", {})
                                if "name" in function_data:
                                    tool_name = function_data["name"]
                                    arguments_dict = function_data.get("arguments", {})
                                    # Ensure arguments is a dict before calling .keys()
                                    arg_keys = list(arguments_dict.keys()) if isinstance(arguments_dict, dict) else []
                                    
                                    tool_info = {"name": tool_name, "arguments": arg_keys}
                                    tool_names_for_trace[tool_name] = tool_info
                                    all_dataset_tools[tool_name] = tool_info
                    
                    if tool_names_for_trace:
                        trace = session.query(Trace).filter(Trace.id == UUID(trace_id_str)).first()
                        if trace:
                            if not trace.extra_metadata: trace.extra_metadata = {}
                            existing_tool_calls = trace.extra_metadata.get("tool_calls", {})
                            updated_tool_calls = {**existing_tool_calls, **tool_names_for_trace}
                            if updated_tool_calls != existing_tool_calls:
                                trace.extra_metadata["tool_calls"] = updated_tool_calls
                                flag_modified(trace, "extra_metadata")
                                logger.info(f"Updated tool_calls metadata for JSONL trace {trace_id_str}")
                        else:
                            logger.warning(f"JSONL Trace {trace_id_str} not found in database for tool_calls update.")
                    else:
                        logger.info(f"No tool calls found in JSONL trace {trace_id_str}")

            elif trace_format == "otel":
                if not all(isinstance(m_str, str) for m_str in messages_batch):
                    logger.error("Invalid messages_batch format for OTEL: expected List[str]")
                    return

                for i, trace_id_str in enumerate(trace_ids):
                    if i >= len(messages_batch):
                        logger.warning(f"Skipping trace ID {trace_id_str} due to missing OTEL span string.")
                        continue

                    otel_span_json_str = messages_batch[i]
                    logger.info(f"Processing OTEL trace {i+1}/{len(trace_ids)}: {trace_id_str}")
                    tool_names_for_trace = {}

                    try:
                        otel_span_data = json.loads(otel_span_json_str)
                        # We don't instantiate OTELSpan Pydantic model here if only accessing attributes via dict.
                        # However, using the model helps if there's complex logic/validation.
                        # For direct attribute access:
                        attributes = otel_span_data.get("attributes", [])
                        tool_call_func_name_attr = next((attr for attr in attributes if attr.get("key") == "gen_ai.tool_call.function.name"), None)
                        tool_call_args_attr = next((attr for attr in attributes if attr.get("key") == "gen_ai.tool_call.function.arguments"), None)

                        if tool_call_func_name_attr and tool_call_args_attr:
                            tool_name = tool_call_func_name_attr.get("value", {}).get("stringValue") # OTel attributes have typed values
                            arguments_json_str = tool_call_args_attr.get("value", {}).get("stringValue")

                            if tool_name and arguments_json_str:
                                try:
                                    args_dict = json.loads(arguments_json_str)
                                    arg_keys = list(args_dict.keys()) if isinstance(args_dict, dict) else []
                                    tool_info = {"name": tool_name, "arguments": arg_keys}
                                    tool_names_for_trace[tool_name] = tool_info
                                    all_dataset_tools[tool_name] = tool_info # For dataset registry
                                except json.JSONDecodeError:
                                    logger.warning(f"Failed to parse OTEL tool call arguments JSON for trace {trace_id_str}, span {otel_span_data.get('span_id')}. Args: {arguments_json_str}")
                        
                        if tool_names_for_trace:
                            trace = session.query(Trace).filter(Trace.id == UUID(trace_id_str)).first()
                            if trace:
                                if not trace.extra_metadata: trace.extra_metadata = {}
                                existing_tool_calls = trace.extra_metadata.get("tool_calls", {})
                                updated_tool_calls = {**existing_tool_calls, **tool_names_for_trace}
                                if updated_tool_calls != existing_tool_calls:
                                    trace.extra_metadata["tool_calls"] = updated_tool_calls
                                    flag_modified(trace, "extra_metadata")
                                    logger.info(f"Updated tool_calls metadata for OTEL trace {trace_id_str}")
                            else:
                                logger.warning(f"OTEL Trace {trace_id_str} not found in database for tool_calls update.")
                        else:
                            logger.info(f"No qualifying tool call attributes found in OTEL trace {trace_id_str}")
                            
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse OTELSpan JSON string for trace {trace_id_str}: {otel_span_json_str[:200]}")
                    except Exception as e:
                        logger.error(f"Error processing OTEL span for tool calls on trace {trace_id_str}: {e}. Span data (first 200 chars): {otel_span_json_str[:200]}")
            
            # Common logic for updating dataset tool registry
            if dataset_id and user_id and all_dataset_tools: # user_id and dataset_id must be valid UUIDs
                logger.info(
                    f"Updating tool registry for dataset {dataset_id} with {len(all_dataset_tools)} tools"
                )

                try:
                    # Load the dataset
                    try:
                        # Ensure dataset_id and user_id are UUIDs for load_dataset
                        ds_id_uuid = UUID(str(dataset_id)) if not isinstance(dataset_id, UUID) else dataset_id
                        usr_id_uuid = UUID(str(user_id)) if not isinstance(user_id, UUID) else user_id

                        dataset = load_dataset(
                            session,
                            {"id": ds_id_uuid, "user_id": usr_id_uuid}, # Use UUID typed values
                            usr_id_uuid, # Use UUID typed values
                            allow_public=True, # Assuming this should be true or configurable
                            return_user=False,
                        )

                        if dataset:
                            if not dataset.extra_metadata: dataset.extra_metadata = {}
                            existing_tools_registry = dataset.extra_metadata.get("tool_calls", {})
                            updated_tools_registry = {**existing_tools_registry, **all_dataset_tools}
                            if updated_tools_registry != existing_tools_registry:
                                dataset.extra_metadata["tool_calls"] = updated_tools_registry
                                flag_modified(dataset, "extra_metadata")
                                logger.info(f"Updated tool registry for dataset {ds_id_uuid}")
                        else:
                            logger.warning(f"Dataset {ds_id_uuid} not found for tool registry update.")
                    except ValueError: # Handles issues with UUID conversion if dataset_id/user_id are invalid strings
                        logger.error(f"Invalid dataset_id '{dataset_id}' or user_id '{user_id}' for tool registry update.")
                    except Exception as e:
                        logger.error(f"Error updating dataset tool registry for dataset {dataset_id}: {str(e)}")
            elif dataset_id: # dataset_id was provided but no tools found across all traces
                logger.info(f"No new tools found across traces to update for dataset {dataset_id}")
            
            session.commit() # Commit all trace metadata changes and dataset registry changes

    except Exception as e:
        logger.error(f"Overall error in extract_and_save_batch_tool_calls: {str(e)}", exc_info=True)
        # Depending on desired behavior, could re-raise or just log
        # raise # Uncomment to propagate the error
