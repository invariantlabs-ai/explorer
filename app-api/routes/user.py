from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request
from models.datasets_and_traces import Annotation, Dataset, SharedLinks, Trace, User, db
from models.queries import (
    annotation_to_json,
    dataset_to_json,
    save_user,
    trace_to_json,
    user_to_json,
)
from routes.apikeys import UserOrAPIIdentity
from routes.auth import AuthenticatedUserIdentity, UserIdentity
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

user = FastAPI()


def user_by_id(user_id: UUID) -> User | None:
    with Session(db()) as session:
        return session.query(User).filter(User.id == user_id).first()


@user.get("/info")
def get_user(request: Request, user_id: Annotated[UUID | None, Depends(UserIdentity)]):
    if user_id is not None:
        session_user = user_by_id(user_id)
        if session_user is None:
            # stange edge condition where the user is not in the database
            return {
                "id": user_id,
                "username": "unknown",
                "signedUp": False,
            }

        user_info = user_to_json(session_user)
        user_info["signedUp"] = True
        user_info["name"] = request.state.userinfo["name"]
        user_info["email"] = request.state.userinfo["email"]
        return user_info

    # anonymous user
    return {
        "id": None,
        "username": "unknown",
        "email": "unknown",
        "name": "unknown",
        "image_url_hash": "unknown",
        "signedUp": False,
    }


@user.post("/signup")
def signup(
    request: Request, user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)]
):
    with Session(db()) as session:
        save_user(session, request.state.userinfo)
        session.commit()
    return {"success": True}


# to get the user identity for an API key, run
# curl <INSTANCE_URL>/api/v1/user/identity -H "Authorization: Bearer <API_KEY>"
@user.get("/identity")
def identity(user_id: Annotated[UUID, Depends(UserOrAPIIdentity)]):
    user = user_by_id(user_id)

    if user is None:
        raise HTTPException(status_code=403, detail="not authorized")

    return {
        "username": user.username,
    }


@user.get("/events")
def events(
    request: Request,
    user_id: Annotated[UUID | None, Depends(UserIdentity)],
    limit: int = 20,
):
    # events are:
    # - public dataset is created
    # - new comment on a trace
    # - new reply to a comment
    # - newly shared trace

    with Session(db()) as session:
        # get get up to <limit> many of each type of event, and then choose the top <limit> events in python
        # this this is easier than the pure SQL version, and should be fine for now
        events = []

        # public datasets (from other users)
        datasets = (
            session.query(Dataset, User)
            .filter(and_(Dataset.is_public, Dataset.user_id != user_id))
            .join(User, User.id == Dataset.user_id)
            .order_by(Dataset.id.desc())
            .limit(limit)
            .all()
        )
        for dataset, user in datasets:
            events.append(
                {
                    "time": dataset.time_created,
                    "text": "created a new dataset",
                    "type": "dataset",
                    "user": user_to_json(user),
                    "details": dataset_to_json(dataset),
                }
            )

        # annotations/comments on datasets visible to the user
        annotations = (
            session.query(Annotation, Trace, User, Dataset)
            .join(User, User.id == Annotation.user_id)
            .join(Trace, Annotation.trace_id == Trace.id)
            .join(Dataset, Trace.dataset_id == Dataset.id, isouter=True)
            .join(SharedLinks, Trace.id == SharedLinks.trace_id, isouter=True)
            .filter(
                and_(
                    Annotation.user_id != user_id,
                    or_(
                        Dataset.is_public,  # public dataset
                        Dataset.user_id == user_id,  # user's own dataset,
                        Trace.user_id == user_id,  # user's own trace
                        SharedLinks.id != None,  # trace is shared
                    ),
                )
            )
            .order_by(Annotation.time_created.desc())
            .limit(limit)
            .all()
        )
        for annotation, trace, user, dataset in annotations:
            events.append(
                {
                    "time": annotation.time_created,
                    "text": "annotated a trace",
                    "type": "annotation",
                    "user": user_to_json(user),
                    "dataset": {
                        "name": dataset.name if dataset else None,
                        "id": dataset.id if dataset else None,
                    },
                    "details": annotation_to_json(
                        annotation, trace=trace_to_json(trace)
                    ),
                }
            )

        # sort events by time
        events = sorted(events, key=lambda e: e["time"], reverse=True)
        # take the top <limit> events
        events = events[:limit]

        return events
