import fastapi
from sqlalchemy.orm import Session
from sqlalchemy import func
import json
from typing import Any
from util.util import get_gravatar_hash

user = fastapi.FastAPI()

@user.get("/info")
def get_user(request: fastapi.Request):
    userinfo = request.state.userinfo
    
    if userinfo['sub'] == "anonymous":
        return {
            "id": "anonymous",
            "username": "not logged in",
            "email": "",
            "name": "Not Logged In",
            "image_url_hash": '0000'
        }

    return {
        "id": userinfo['sub'],
        "username": userinfo['preferred_username'],
        "email": userinfo['email'],
        "name": userinfo['name'],
        "image_url_hash": get_gravatar_hash(userinfo['email'])
    }
