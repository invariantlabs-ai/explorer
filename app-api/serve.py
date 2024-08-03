import fastapi
import re

from routes.user import user
from routes.auth import require_authorization
from routes.datamodel import dataset, trace, has_link_sharing

v1 = fastapi.FastAPI()
v1.mount("/user", user)
v1.mount("/dataset", dataset)
v1.mount("/trace", trace)

@v1.get("/")
async def home():
    return {"message": "Hello v1"}

app = fastapi.FastAPI()
app.mount("/api/v1", v1)

def allow_traces_with_link_sharing(request: fastapi.Request): 
    if not re.match(r"^/api/v1/trace/[a-z0-9-]+$", request.url.path) and not re.match(r"^/api/v1/trace/[a-z0-9-]+/annotations$", request.url.path):
        print("not an path exemption")
        return False
    
    path = request.url.path
    if path.endswith("/annotations"):
        trace_id = path.split("/")[-2]
    else:
        trace_id = path.split("/")[-1]
 
    result = has_link_sharing(trace_id)
    request.state.userinfo = {
        "sub": "anonymous"
    }
    return result

app.middleware("http")(require_authorization(exceptions=[], exception_handlers = [allow_traces_with_link_sharing]))  

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
