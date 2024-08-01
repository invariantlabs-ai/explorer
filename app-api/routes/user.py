import fastapi
from model import trace_db, TracedAgentStep
from sqlalchemy.orm import Session
from sqlalchemy import func
import json
from typing import Any

user = fastapi.FastAPI()

@user.get("/info")
def get_user(request: fastapi.Request):
    userinfo = request.state.userinfo
    print("userinfo", userinfo, flush=True)
    return {
        "username": userinfo['preferred_username'],
        "email": userinfo['email'],
        "name": userinfo['name']
    }
