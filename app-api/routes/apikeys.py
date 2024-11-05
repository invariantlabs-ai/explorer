import re
import datetime
import os

from fastapi import Depends
from fastapi import FastAPI, Request, HTTPException
from sqlalchemy.orm import Session

from models.datasets_and_traces import Dataset, db, Trace, Annotation, User, APIKey
from models.queries import *

from typing import Annotated
from routes.auth import UserIdentity, AuthenticatedUserIdentity

# dataset routes
apikeys = FastAPI()

@apikeys.post("/create")
async def create_apikey(userinfo: UserIdentity = Depends(AuthenticatedUserIdentity)):
    """
    Create a new API key for the user.
    """
    userid = userinfo.get("sub")

    with Session(db()) as session:
        key = APIKey.generate_key()
        hashed_key = APIKey.hash_key(key)

        apikey = APIKey(
            hashed_key=hashed_key,
            user_id=userid,
            time_created=datetime.datetime.now()
        )

        id = str(apikey.id)

        session.add(apikey)
        session.commit()

    return {
        "id": id,
        "key": key
    }

@apikeys.get("/list")
def get_apikeys(userinfo: UserIdentity = Depends(AuthenticatedUserIdentity)):
    """Get all API keys for the user."""
    userid = userinfo.get("sub")

    with Session(db()) as session:
        apikeys = session.query(APIKey).filter(APIKey.user_id == userid).order_by(APIKey.expired, APIKey.time_created.desc()).all()
        
        return {
            "userid": userid,
            "keys": [{
                "id": key.id, 
                "time_created": key.time_created, 
                "expired": key.expired,
                "hashed_key": key.hashed_key[-4:]
            } for key in apikeys]
        }
    
@apikeys.delete("/{key_id}")
def delete_apikey(key_id: str, userinfo: UserIdentity = Depends(AuthenticatedUserIdentity)):
    """Expire an API key. Keys are never truly deleted, only expired so they can be audited."""
    userid = userinfo.get("sub")

    with Session(db()) as session:
        key = session.query(APIKey).filter(APIKey.id == key_id).first()
        if key is None:
            raise HTTPException(status_code=404, detail="API key not found")
        if str(key.user_id) != str(userid):
            raise HTTPException(status_code=403, detail="API key does not belong to user")

        key.expired = True

        session.commit()

    return {
        "success": True
    }

"""
Inject to obtain user info using a Bearer API token passed as "Authorization" header

Example: def f(..., userinfo: APIIdentity = Depends(APIIdentity))

The resulting user identity looks like a UserIdentity object, but limited to the following fields:
{
    "sub": "user_id",
    "username": "username",
    "apikey": "*******[last 4 characters of the API key]"
}

"""
async def APIIdentity(request: Request):
    try:
        # check for DEV_MODE
        if os.getenv("DEV_MODE") == "true" and "noauth" not in request.headers.get("referer", []):
            return {
                "sub": "3752ff38-da1a-4fa5-84a2-9e44a4b167ce",
                "username": "developer",
                "apikey": "with DEV_MODE true"
            }
        if "noauth=user1" in request.headers.get("referer", []) and os.getenv("DEV_MODE") == "true":
            return {
                "sub": "3752ff38-da1a-4fa5-84a2-9e44a4b167ca",
                "username": "Developer2",
                "apikey": "with DEV_MODE true"
            }

        apikey = request.headers.get("Authorization")
        bearer_token = re.match(r"Bearer (.+)", apikey)
        if bearer_token is None:
            raise HTTPException(status_code=401, detail="You must provide a valid API key.")
        

        apikey = bearer_token.group(1)
        hashed_key = APIKey.hash_key(apikey)

        with Session(db()) as session:
            key = session.query(APIKey, User).join(User, User.id == APIKey.user_id).filter(APIKey.hashed_key == hashed_key).first()
            if key is None or key.APIKey.expired:
                raise HTTPException(status_code=401, detail="You must provide a valid API key.")
            
            return {
                "sub": key.User.id,
                "username": key.User.username,
                "apikey": "*******" + key.APIKey.hashed_key[-4:]
            }
    except Exception as e:
        raise HTTPException(status_code=401, detail="You must provide a valid API key.")
