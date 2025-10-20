"""
This static file server is used inside a container to serve
the built frontend React application in production.

In development, the frontend is served by a hot-reloading 
vitejs instance.
"""
import os
import re
import fastapi
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from auth import install_authorization_endpoints

app = fastapi.FastAPI()

# adds /login and /logout endpoints
install_authorization_endpoints(app)

BASE_DIR = os.path.realpath(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dist")))
static_files = StaticFiles(directory=BASE_DIR, html=False, check_dir=True)

# Client-side route patterns that should serve index.html
CLIENT_ROUTES = [
    r"^$",  # root path
    r"^u/[^/]+$",  # /u/:username
    r"^u/[^/]+/[^/]+$",  # /u/:username/:datasetname
    r"^u/[^/]+/[^/]+/t/\d+$",  # /u/:username/:datasetname/t/:traceIndex
    r"^u/[^/]+/[^/]+/t$",  # /u/:username/:datasetname/t
    r"^trace/[^/]+$",  # /trace/:traceId
    r"^traceview$",  # /traceview
    r"^playground$",  # /playground
    r"^new$",  # /new
    r"^deploy-guardrail$",  # /deploy-guardrail
    r"^signup$",  # /signup
    r"^snippets$",  # /snippets
    r"^settings$",  # /settings
    r"^terms$",  # /terms
    r"^policy$",  # /policy
]

def is_client_route(path: str) -> bool:
    """Check if the path matches any client-side route pattern."""
    for pattern in CLIENT_ROUTES:
        if re.match(pattern, path):
            return True
    return False

# serve static files
@app.get("/{path:path}")
async def index(path: str, request: fastapi.Request):
    # Check if this is a client-side route
    if is_client_route(path):
        return FileResponse(os.path.join(BASE_DIR, "index.html"))
    
    # default to index.html for empty path
    if path == "":
        return FileResponse(os.path.join(BASE_DIR, "index.html"))
    
    # Try to serve the static file
    response = await static_files.get_response(path, request.scope)
    if response.status_code != 404:
        return response
    
    # If file not found, serve index.html for client-side routing
    return FileResponse(os.path.join(BASE_DIR, "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)