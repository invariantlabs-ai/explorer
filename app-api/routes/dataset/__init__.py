"""Defines routes for APIs related to dataset."""

from fastapi import FastAPI

from routes.dataset.crud import router as crud_router
from routes.dataset.traces import router as traces_router
from routes.dataset.policies import router as policies_router
from routes.dataset.analysis import router as analysis_router
from routes.dataset.metadata import router as metadata_router
from routes.dataset.synthesis import router as synthesis_router
from routes.dataset.jobs import router as jobs_router
from routes.dataset.list import router as list_router
from routes.dataset.queries import router as queries_router

# dataset routes
dataset = FastAPI()

# Include all sub-routers
dataset.include_router(crud_router)
dataset.include_router(traces_router)
dataset.include_router(policies_router)
dataset.include_router(analysis_router)
dataset.include_router(metadata_router)
dataset.include_router(synthesis_router)
dataset.include_router(jobs_router)
dataset.include_router(list_router)
dataset.include_router(queries_router)