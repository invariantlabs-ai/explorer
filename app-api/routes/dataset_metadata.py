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
from routes.apikeys import APIIdentity, UserOrAPIIdentity
from routes.auth import AuthenticatedUserIdentity, UserIdentity
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.sql import exists, func
from util.util import validate_dataset_name


class MetadataField:
    def __init__(self, key: str, include_in_response: bool = True):
        """
        :param key: The key of the field on the top level of the metadata dictionary.
        :param include_in_response: Whether to include the field in the response.
        """
        self.key = key
        self.include_in_response = include_in_response

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

    def validate(self, value: Any):
        if not isinstance(value, dict):
            raise HTTPException(
                status_code=400,
                detail="invariant.test_results must be a dictionary if provided",
            )
        
        allowed_keys = [("num_tests", int), ("num_passed", int)]
        
        for key, ttype in allowed_keys:
            if key not in value:
                raise HTTPException(
                    status_code=400,
                    detail=f"invariant.test_results must contain the key {key}"
                )
            if not isinstance(value[key], ttype):
                raise HTTPException(
                    status_code=400,
                    detail=f"invariant.test_results.{key} must be of type {ttype.__name__}"
                )

        if any(key not in allowed_keys for key in value):
            raise HTTPException(
                status_code=400,
                detail=f"invariant.test_results must only contain the keys {', '.join([k for k, _ in allowed_keys])}"
            )    

    def update(self, metadata_dict: dict, new_value: Any|None, mode='incremental'):
        if mode == 'replace_all':
            if new_value is None:
                metadata_dict.pop(self.key, None)
            else:
                metadata_dict[self.key] = new_value
        else:
            if new_value is not None:
                for key in new_value:
                    if new_value[key] is not None:
                        metadata_dict[self.key][key] = new_value[key]

class PrimitiveMetadataField(MetadataField):
    def __init__(self, key: str, ttype: type, include_in_response: bool = True):
        super().__init__(key, include_in_response=include_in_response)
        self.ttype = ttype

    def validate(self, value: Any):
        if not isinstance(value, self.ttype):
            raise HTTPException(
                status_code=400,
                detail=f"{self.key} must be of type {self.ttype.__name__}"
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

    
async def update_dataset_metadata(user_id: str, dataset_name: str, metadata: dict, replace_all: bool = False):
    """
    Updates the metadata of a dataset.

    :param dataset_name: The name of the dataset.
    :param user_id: The user ID of the dataset owner.
    :param metadata: The new metadata to update the dataset with.
    :param replace_all: Whether to replace the entire metadata dictionary with the new metadata. If False, only the
                        provided fields will be updated. Default is False.
    """
    allowed_field = [
        TestReportField(),
        PrimitiveMetadataField('benchmark', str),
        PrimitiveMetadataField('name', str),
        PrimitiveMetadataField('accuracy', (int, float)),
        PrimitiveMetadataField('policies', list, include_in_response=False),
        PrimitiveMetadataField('analysis_report', str),
    ]

    # validate all allowed fields
    validated_keys = []
    for field in allowed_field:
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
            for field in allowed_field:
                field.update(dataset_response.extra_metadata, metadata.get(field.key), mode='replace_all')
        else:
            for field in allowed_field:
                field.update(dataset_response.extra_metadata, metadata.get(field.key), mode='incremental')
        
        # mark the extra_metadata field as modified
        flag_modified(dataset_response, "extra_metadata")
        session.commit()
        
        metadata_response = dataset_response.extra_metadata
        updated_metadata = {**metadata_response}
        
        # remove fields that should not be visible in the response
        for field in allowed_field:
            if field.include_in_response:
                updated_metadata.pop(field.key, None)
        
        # return the updated metadata
        return updated_metadata
