"""Defines routes for APIs related to benchmarks."""

import copy
import datetime
import json
import os
import re
import uuid
from typing import Annotated
from fastapi import Depends, FastAPI, File, UploadFile, Request, HTTPException
from fastapi.responses import StreamingResponse
from invariant.policy import AnalysisResult, Policy
from invariant.runtime.input import mask_json_paths
from models.datasets_and_traces import (Annotation, Dataset, DatasetPolicy,
                                        SavedQueries, SharedLinks, Trace, User,
                                        db)
from models.importers import import_jsonl
from models.queries import (dataset_to_json, get_savedqueries, load_annoations,
                            load_dataset, load_trace, query_traces,
                            search_term_mappings, trace_to_exported_json,
                            trace_to_json)
from sqlalchemy import or_
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from util.util import validate_dataset_name

# dataset routes
benchmark = FastAPI()

"""
Public routes for listing and getting all public datasets that are linked to a given benchmark.
"""
@benchmark.get("/{benchmark_name}/leaderboard")
def get_leaderboard(benchmark_name: str, request: Request):
    """Get leaderboard for a dataset."""

    if request.headers.get('Authorization') != os.getenv("PRIVATE_EXPLORER_APIS_ACCESS_TOKEN", ""):
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    # curl -X GET "https://localhost/benchmark/webarena/leaderboard" -H  "accept: application/json" -H  "Authorization: <PRIVATE_EXPLORER_APIS_ACCESS>"
    
    with Session(db()) as session:
        datasets = session.query(Dataset, User)\
            .join(User, User.id == Dataset.user_id)\
            .filter(or_(Dataset.is_public))\
            .order_by(Dataset.time_created.desc())\
            .all()
    
    datasets = [(dataset, user) for dataset, user in datasets if dataset.extra_metadata.get('benchmark') == benchmark_name]

    # get leaderboard entries
    entries = []

    for (dataset, user) in datasets:
        dataset_identifier = f'{user.username}/{dataset.name}'
        dataset_name = dataset.extra_metadata.get('name', dataset_identifier)
        accuracy = dataset.extra_metadata.get('accuracy')
        
        if accuracy:
            entries.append({'name': dataset_name, 'dataset': dataset_identifier, 'accuracy': accuracy})

    # sort leaderboard by accuracy, descending, by name secondarily
    entries = sorted(entries, key=lambda x: (-x['accuracy'], x['name']))

    return entries