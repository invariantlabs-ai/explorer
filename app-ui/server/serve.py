import os
import fastapi
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from auth import install_authorization_endpoints, require_authorization

app = fastapi.FastAPI()

install_authorization_endpoints(app)
# app.middleware("http")(require_authorization(exceptions = ["/login"], redirect=True, exception_handlers=[lambda r: r.url.path.startswith("/trace/") or r.url.path.startswith("/assets/")]))

static_files_cache = {}
def is_static_file(path):
    if path in static_files_cache:
        return True
    
    if not os.path.exists(os.path.join("../dist", path)) or not os.path.isfile(os.path.join("../dist", path)):
        return False
    static_files_cache[path] = True
    
    return True


@app.get("/{path:path}")
async def index(path):
    if is_static_file(path) and not ".." in path:
        media_type = "text/html" if path.endswith(".html") else None
        return FileResponse(os.path.join("../dist", path), media_type=media_type)
    return FileResponse(os.path.join("../dist", "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)