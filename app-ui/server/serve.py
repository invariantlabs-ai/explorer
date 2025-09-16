"""
This static file server is used inside a container to serve
the built frontend React application in production.

In development, the frontend is served by a hot-reloading 
vitejs instance.
"""
import os
import fastapi
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from auth import install_authorization_endpoints

app = fastapi.FastAPI()

# adds /login and /logout endpoints
install_authorization_endpoints(app)

BASE_DIR = os.path.realpath(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dist")))
static_files = StaticFiles(directory=BASE_DIR, html=False, check_dir=True)

# serve static files
@app.get("/{path:path}")
async def index(path: str, request: fastapi.Request):
    # default to index.html
    if path == "":
        path = "index.html"
    response = await static_files.get_response(path, request.scope)
    if response.status_code != 404:
        return response
    return FileResponse(os.path.join(BASE_DIR, "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)