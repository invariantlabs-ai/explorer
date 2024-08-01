import hashlib
import os
from sqlalchemy import String
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import Session
from sqlalchemy import create_engine

from sqlalchemy.dialects.postgresql import UUID
import uuid

class Base(DeclarativeBase):
    pass

class APIKey(Base):
    __tablename__ = "api_keys"

    # key is uuid that auto creates
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key_hash = mapped_column(String, nullable=False)
    created_on = mapped_column(String, nullable=False)
    redacted = mapped_column(String, nullable=False)

def db():
    client = create_engine("postgresql://{}:{}@database:5432/{}".format(
        os.environ["POSTGRES_USER"], os.environ["POSTGRES_PASSWORD"], os.environ["POSTGRES_DB"]
    ))

    Base.metadata.create_all(client)

    return client

def create_api_key():
    import random
    import string

    return "ivk-" + ''.join(random.choices(string.ascii_lowercase + string.digits, k=32))

def hash_key(key):
    # reproducible hash for API key checking
    hash = hashlib.sha256(key.encode("utf-8")).digest()
    # as string
    return hash.hex()

def check_key(key):
    hashed = hash_key(key)

    all_hashes = []
    client = db()
    with Session(client) as session:
        keys = session.query(APIKey).all()
        all_hashes = [key.key_hash for key in keys]

    with Session(db()) as session:
        key = session.query(APIKey).filter(APIKey.key_hash == hashed).first()
        return key is not None
    
def require_apikey(exceptions):
    import fastapi

    async def check_api_key(request: fastapi.Request, call_next):
        if request.url.path in exceptions:
            response = await call_next(request)
            return response

        headers = dict(request.headers)
        authorization = headers.get("authorization")
        
        if not authorization:
            return fastapi.Response(status_code=401, content="You must provide an Authorization header.")

        api_key = authorization.split("Bearer ")[1]
        
        if not check_key(api_key):
            return fastapi.Response(status_code=401, content="Invalid API key.")

        response = await call_next(request)
        return response
    return check_api_key