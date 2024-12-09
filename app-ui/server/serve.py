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

# serve static files
static_files_cache = {}
def is_static_file(path):
    if path in static_files_cache:
        return True
    
    if not os.path.exists(os.path.join("../dist", path)) or not os.path.isfile(os.path.join("../dist", path)):
        return False
    static_files_cache[path] = True
    
    return True

# serve static files
@app.get("/{path:path}")
async def index(path):
    if is_static_file(path) and not ".." in path:
        media_type = "text/html" if path.endswith(".html") else None
        return FileResponse(os.path.join("../dist", path), media_type=media_type)
    return FileResponse(os.path.join("../dist", "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)