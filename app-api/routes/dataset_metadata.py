"""Defines routes for APIs related to dataset metadata."""

import datetime
import json
import os
import re
import uuid
from enum import Enum
from typing import Annotated, Any, Optional
from uuid import UUID

from cachetools import TTLCache, cached
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from models.datasets_and_traces import (
    Annotation,
    Dataset,
    DatasetPolicy,
    SavedQueries,
    SharedLinks,
    Trace,
    User,
    db,
)
from models.importers import import_jsonl
from models.queries import (
    dataset_to_json,
    get_savedqueries,
    load_annotations,
    load_dataset,
    query_traces,
    search_term_mappings,
    trace_to_exported_json,
    trace_to_json,
)
from pydantic import ValidationError
from routes.apikeys import APIIdentity
from routes.auth import AuthenticatedUserIdentity, UserIdentity
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.sql import exists, func
from util.util import validate_dataset_name

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
    def __init__(self, key: str, include_in_response: bool = True, clear_on_replace: bool = True):
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
    
    def update(self, metadata_dict: dict, new_value: Any|None, mode='incremental'):
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
        super().__init__('invariant.test_results')
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
                    detail=f"invariant.test_results.{key} must be of type {ttype.__name__} (got {type(value[key]).__name__})"
                )
            
        # make sure at least one of the allowed keys is present
        if not any(key in value for key, _ in self.allowed_keys):
            raise HTTPException(
                status_code=400,
                detail="invariant.test_results must not be empty if provided"
            )

    def update(self, metadata_dict: dict, new_value: Any|None, mode='incremental'):
        valid_keys = [k for k, _ in self.allowed_keys]
        if mode == 'replace_all':
            if new_value is None:
                metadata_dict.pop(self.key, None)
            else:
                metadata_dict[self.key] = {k: new_value[k] for k in new_value if new_value[k] is not None and k in valid_keys}
        else:
            if new_value is not None:
                metadata_dict[self.key] = {}
                for key in new_value:
                    if new_value[key] is not None and key in valid_keys:
                        metadata_dict[self.key][key] = new_value[key]

class PrimitiveMetadataField(MetadataField):
    def __init__(self, key: str, ttype: type, include_in_response: bool = True, clear_on_replace: bool = True):
        super().__init__(key, include_in_response=include_in_response, clear_on_replace=clear_on_replace)
        self.ttype = ttype

    def validate(self, value: Any):
        if not isinstance(value, self.ttype):
            types = ", ".join([t.__name__ for t in self.ttype]) if isinstance(self.ttype, tuple) else self.ttype.__name__
            raise HTTPException(
                status_code=400,
                detail=f"{self.key} must be of type {types}"
            )

    def update(self, metadata_dict: dict, new_value: Any|None, mode='incremental'):
        if mode == 'replace_all':
            if new_value is None:
                metadata_dict.pop(self.key, None)
            else:
                metadata_dict[self.key] = new_value
        else:
            if new_value is not None:
                metadata_dict[self.key] = new_value

class NonEmptyStringMetadataField(PrimitiveMetadataField):
    def validate(self, value: Any):
        super().validate(value)
        if not value:
            raise HTTPException(
                status_code=400,
                detail=f"{self.key} must be a non-empty string"
            )

class PositiveNumber(PrimitiveMetadataField):
    def validate(self, value: Any):
        super().validate(value)
        if value < 0:
            raise HTTPException(
                status_code=400,
                detail=f"{self.key} must be a non-negative number"
            )

class ReadOnlyMetadataField(MetadataField):
    def validate(self, value: Any):
        raise HTTPException(
            status_code=400,
            detail=f"{self.key} cannot be updated via the /metadata API"
        )

    def update(self, metadata_dict: dict, new_value: Any|None, mode='incremental'):
        pass
    
async def update_dataset_metadata(user_id: str, dataset_name: str, metadata: dict, replace_all: bool = False):
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
        NonEmptyStringMetadataField('benchmark', str),
        NonEmptyStringMetadataField('name', str),
        PositiveNumber('accuracy', (int, float)),
        ReadOnlyMetadataField('policies', include_in_response=False, clear_on_replace=False),
        PrimitiveMetadataField('analysis_report', str),
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
            detail=f"metadata must only contain the keys {', '.join([k for k in validated_keys])}"
        )
    
    # update the metadata (based on the update mode)
    with Session(db()) as session:
        dataset_response = load_dataset(
            session,
            {"name": dataset_name, "user_id": uuid.UUID(user_id)},
            user_id,
            allow_public=True,
            return_user=False,
        )
        # update all allowed fields
        if replace_all:
            for field in validated_fields:
                field.update(dataset_response.extra_metadata, metadata.get(field.key), mode='replace_all')
        else:
            for field in validated_fields:
                field.update(dataset_response.extra_metadata, metadata.get(field.key), mode='incremental')
        
        # mark the extra_metadata field as modified
        flag_modified(dataset_response, "extra_metadata")
        session.commit()
        
        metadata_response = dataset_response.extra_metadata
        updated_metadata = {}
        
        # system fields
        validated_field_names = [field.key for field in validated_fields]
        system_fields = [key for key in metadata_response if key not in validated_field_names]

        # remove fields that should not be visible in the response
        for field in validated_fields:
            if field.include_in_response and field.key in metadata_response:
                updated_metadata[field.key] = metadata_response[field.key]
        
        # add system fields 
        for field in system_fields:
            updated_metadata[field] = metadata_response[field]

        # return the updated metadata
        return updated_metadata
