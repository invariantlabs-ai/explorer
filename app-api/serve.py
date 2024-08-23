import re
import os
import json
import fastapi
from fastapi import HTTPException

from routes.user import user
from routes.auth import require_authorization, keycloak_openid
from routes.dataset import dataset
from routes.trace import trace
from models.queries import has_link_sharing, load_trace
from models.datasets_and_traces import db
from sqlalchemy.orm import Session

from fastapi.exception_handlers import http_exception_handler
import traceback

v1 = fastapi.FastAPI()

@v1.exception_handler(Exception)
async def custom_http_exception_handler(request, exc):
    print(request.url)
    traceback.print_exception(exc)
    return await http_exception_handler(request, exc)

v1.mount("/user", user)
v1.mount("/dataset", dataset)
v1.mount("/trace", trace)

@v1.get("/")
async def home():
    return {"message": "Hello v1"}

app = fastapi.FastAPI()
app.mount("/api/v1", v1)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
