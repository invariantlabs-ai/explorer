import os

import fastapi
from fastapi import HTTPException
from metrics.active_users import install_metrics_middleware
from prometheus_fastapi_instrumentator import Instrumentator, metrics
from routes.apikeys import apikeys
from routes.auth import write_back_refreshed_token
from routes.benchmark import benchmark
from routes.dataset import dataset
from routes.push import push
from routes.trace import trace
from routes.user import user

v1 = fastapi.FastAPI()

# install the API routes
v1.mount("/user", user)
v1.mount("/dataset", dataset)
v1.mount("/trace", trace)
v1.mount("/keys", apikeys)
v1.mount("/push", push)
v1.mount("/benchmark", benchmark)


# for debugging, we can check if the API is up
@v1.get("/")
async def home():
    return {"message": "Hello v1"}


# mount the API under /api/v1
app = fastapi.FastAPI()

# Initialize Redis pool on startup
from util.redis_client import init_redis_pool

@app.on_event("startup")
async def startup_event():
    await init_redis_pool()
    # Add other startup procedures here if any in the future

app.mount("/api/v1", v1)


# enforces that the request knows the PROMETHEUS_TOKEN when requesting metrics
def auth_metrics(request: fastapi.Request):
    # in case of DEV_MODE, we don't require a token for metrics
    if os.getenv("DEV_MODE") == "true":
        return True

    request_token = request.headers.get("authorization", "")
    token = os.getenv("PROMETHEUS_TOKEN", "")
    if not token or request_token != f"Bearer {token}":
        raise HTTPException(status_code=401, detail="Unauthorized")


if os.getenv("DEV_MODE") != "true":
    install_metrics_middleware(app)

# write back the refreshed token to the response if auth refreshed an access token
app.middleware("http")(write_back_refreshed_token)

# expose standard FastAPI request metrics to observability stack
Instrumentator(
    # Ignore the /api/v1/metrics endpoint and /api/v1/ directly. The latter we use for health checks in status monitoring.
    excluded_handlers=["/api/v1/", "/api/v1/metrics"],
).add(
    metrics.default(
        metric_namespace="invariant",
        metric_subsystem="explorer",
    )
).instrument(app).expose(v1, dependencies=[fastapi.Depends(auth_metrics)])

# serve the API
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
