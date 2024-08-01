import fastapi

from routes.user import user
from routes.auth import require_authorization
from routes.datamodel import dataset

v1 = fastapi.FastAPI()
v1.mount("/user", user)
v1.mount("/dataset", dataset)

@v1.get("/")
async def home():
    return {"message": "Hello v1"}

app = fastapi.FastAPI()
app.mount("/api/v1", v1)

app.middleware("http")(require_authorization(exceptions = []))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
