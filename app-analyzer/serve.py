import fastapi
from fastapi import HTTPException, Request, Depends
from typing import Annotated

from utils.auth import AuthenticatedExplorerIdentity
from utils.explorer import AuthenticatedExplorer, Explorer

# base API should be /api/v1/analysis
app = fastapi.FastAPI()
analysis = fastapi.FastAPI()
app.mount("/api/v1/analysis", analysis)

@analysis.get("/")
def read_root(identity: Annotated[dict, Depends(AuthenticatedExplorerIdentity)], explorer: Annotated[Explorer, Depends(AuthenticatedExplorer)]):
    username = identity["username"]
    return {"Hello": "World", "username": username}

@analysis.get("/create")
def create_analysis(identity: Annotated[dict, Depends(AuthenticatedExplorerIdentity)]):
    username = identity["username"]
    return {"Hello": "World", "username": username}