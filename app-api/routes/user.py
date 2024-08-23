import json
from typing import Any

from fastapi import Depends, Request, FastAPI
from typing import Annotated

from sqlalchemy import func
from sqlalchemy.orm import Session

from util.util import get_gravatar_hash

from models.datasets_and_traces import User, db
from models.queries import save_user

from routes.auth import UserIdentity, AuthenticatedUserIdentity

user = FastAPI()

@user.get("/info")
def get_user(userinfo: Annotated[dict, Depends(UserIdentity)]):
    return {
        "id": userinfo['sub'],
        "username": userinfo['preferred_username'],
        "email": userinfo['email'],
        "name": userinfo['name'],
        "image_url_hash": get_gravatar_hash(userinfo['email'])
    }

@user.post("/signup")
def signup(request: Request, userinfo: Annotated[dict, Depends(AuthenticatedUserIdentity)]):
    with Session(db()) as session:
        save_user(session, userinfo)
        session.commit()

    return {
        "success": True
    }