"""
Prometheus count and middleware to track active users (anonymous or authenticated) in the last 5 minutes.
"""

import datetime

from fastapi import Request
from prometheus_client import Gauge
from routes.auth import UserIdentity

# the gauge tracks active users (active within the last 5 minutes)
active_users = Gauge(
    name="active_users",
    documentation="Number of active users",
    namespace="invariant",
    subsystem="explorer",
)

active_anonymous_users = Gauge(
    name="active_anonymous_users",
    documentation="Number of active anonymous users",
    namespace="invariant",
    subsystem="explorer",
)


# set that automatically removes elements after a certain time
class max_live_set:
    def __init__(self, max_live=5 * 60):
        self.elements = {}
        self.max_live = max_live

    def add(self, element):
        self.cleanup(self.max_live)
        self.elements[element] = datetime.datetime.now()

    def __contains__(self, element):
        self.cleanup(self.max_live)
        return element in self.elements

    def __len__(self):
        self.cleanup(self.max_live)
        return len(self.elements)

    def __iter__(self):
        self.cleanup(self.max_live)
        return iter(self.elements)

    def cleanup(self, timeout):
        sorted_elements = sorted(self.elements.items(), key=lambda x: x[1])
        for element, timestamp in sorted_elements:
            if datetime.datetime.now() - timestamp > datetime.timedelta(
                seconds=timeout
            ):
                del self.elements[element]
            else:
                break


# set of active users (anonymous or authenticated)
ACTIVE_USERS = max_live_set()
ACTIVE_ANONYMOUS_USERS = max_live_set()


def install_metrics_middleware(app):
    @app.middleware("http")
    async def count_active_users(request: Request, call_next):
        try:
            user_id = await UserIdentity(request)
        except Exception:
            user_id = None

        userid = user_id or request.headers.get("x-forwarded-for", "anonymous")

        # ignore the /metrics endpoint and user identity checks by other services
        if not request.url.path.endswith("/metrics") and not request.url.path.endswith(
            "/user/identity"
        ):
            ACTIVE_USERS.add(userid)
            # track anonymous users in a separate set
            if user_id is None:
                ACTIVE_ANONYMOUS_USERS.add(userid)

        active_users.set(len(ACTIVE_USERS))
        active_anonymous_users.set(len(ACTIVE_ANONYMOUS_USERS))

        return await call_next(request)
