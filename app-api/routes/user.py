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
    
    if userinfo['sub'] == "anonymous":
        return {
            "id": "anonymous",
            "username": "not logged in",
            "email": "",
            "name": "Not Logged In"
        }

    return {
        "id": userinfo['sub'],
        "username": userinfo['preferred_username'],
        "email": userinfo['email'],
        "name": userinfo['name']
    }
