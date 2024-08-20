import re
import fastapi

from routes.user import user
from routes.auth import require_authorization
from routes.dataset import dataset
from routes.trace import trace
from models.query import has_link_sharing
from models.datasets_and_traces import db
from sqlalchemy.orm import Session

from fastapi.exception_handlers import http_exception_handler
import traceback

v1 = fastapi.FastAPI()

@v1.exception_handler(Exception)
async def custom_http_exception_handler(request, exc):
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

# implements exception, where a trace and its annotations can be accessed without authorization
# if the trace has a link sharing enabled
def allow_traces_with_link_sharing(request: fastapi.Request): 
    if not re.match(r"^/api/v1/trace/[a-z0-9-]+$", request.url.path) and not re.match(r"^/api/v1/trace/[a-z0-9-]+/annotations$", request.url.path):
        return False
    
    path = request.url.path
    if path.endswith("/annotations"):
        trace_id = path.split("/")[-2]
    else:
        trace_id = path.split("/")[-1]

    with Session(db()) as session:
        result = has_link_sharing(session, trace_id)
    request.state.userinfo = {
        "sub": "anonymous"
    }
    return result

# makes sure everything else requires a JWT for authorization, obtained by visiting auth.invariantlabs.ai
app.middleware("http")(require_authorization(exceptions=[], exception_handlers = [allow_traces_with_link_sharing]))  

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
