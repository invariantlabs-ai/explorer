import datetime
import os
import re
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request
from models.datasets_and_traces import APIKey, db
from models.queries import *
from routes.auth import AuthenticatedUserIdentity, UserIdentity
from sqlalchemy.orm import Session

# dataset routes
apikeys = FastAPI()


@apikeys.post("/create")
async def create_apikey(user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)]):
    """
    Create a new API key for the user.
    """

    with Session(db()) as session:
        key = APIKey.generate_key()
        hashed_key = APIKey.hash_key(key)

        apikey = APIKey(
            hashed_key=hashed_key, user_id=user_id, time_created=datetime.datetime.now()
        )

        id = str(apikey.id)

        session.add(apikey)
        session.commit()

    return {"id": id, "key": key}


@apikeys.get("/list")
def get_apikeys(user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)]):
    """Get all API keys for the user."""

    with Session(db()) as session:
        apikeys = (
            session.query(APIKey)
            .filter(APIKey.user_id == user_id)
            .order_by(APIKey.expired, APIKey.time_created.desc())
            .all()
        )

        return {
            "userid": user_id,
            "keys": [
                {
                    "id": key.id,
                    "time_created": key.time_created,
                    "expired": key.expired,
                    "hashed_key": key.hashed_key[-4:],
                }
                for key in apikeys
            ],
        }


@apikeys.delete("/{key_id}")
def delete_apikey(key_id: str, user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)]):
    """Expire an API key. Keys are never truly deleted, only expired so they can be audited."""

    with Session(db()) as session:
        key = session.query(APIKey).filter(APIKey.id == key_id).first()
        if key is None:
            raise HTTPException(status_code=404, detail="API key not found")
        if str(key.user_id) != str(user_id):
            raise HTTPException(
                status_code=403, detail="API key does not belong to user"
            )

        key.expired = True

        session.commit()

    return {"success": True}


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


async def APIIdentity(request: Request) -> UUID:
    try:
        # check for DEV_MODE
        if os.getenv("DEV_MODE") == "true" and "noauth" not in request.headers.get(
            "referer", []
        ):
            return UUID("3752ff38-da1a-4fa5-84a2-9e44a4b167ca")
        if (
            "noauth=user1" in request.headers.get("referer", [])
            and os.getenv("DEV_MODE") == "true"
        ):
            return UUID("3752ff38-da1a-4fa5-84a2-9e44a4b167ca")

        apikey = request.headers.get("Authorization")
        bearer_token = re.match(r"Bearer (.+)", apikey)
        if bearer_token is None:
            raise HTTPException(
                status_code=401, detail="You must provide a valid API key."
            )

        apikey = bearer_token.group(1)
        hashed_key = APIKey.hash_key(apikey)

        with Session(db()) as session:
            key = (
                session.query(APIKey)
                .filter(APIKey.hashed_key == hashed_key)
                .first()
            )
            if key is None or key.APIKey.expired:
                raise HTTPException(
                    status_code=401, detail="You must provide a valid API key."
                )

            return UUID(key.user_id)

    except Exception:
        raise HTTPException(status_code=401, detail="You must provide a valid API key.")


async def UserOrAPIIdentity(request: Request) -> UUID | None:
    apikey = request.headers.get("Authorization")
    if apikey is not None:
        identity = await APIIdentity(request)
    else:
        identity = await UserIdentity(request)
    return identity


async def AuthenticatedUserOrAPIIdentity(
    identity: Annotated[UUID | None, Depends(UserOrAPIIdentity)],
) -> UUID:
    if identity is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    return identity
