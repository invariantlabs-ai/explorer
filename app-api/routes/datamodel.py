import hashlib
import os
import json
import datetime
from sqlalchemy import String
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import Session
from sqlalchemy import create_engine

from sqlalchemy.dialects.postgresql import UUID
import uuid

from fastapi import FastAPI, File, UploadFile, Request, HTTPException

class Base(DeclarativeBase):
    pass

class Dataset(Base):
    __tablename__ = "datasets"

    # key is uuid that auto creates
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = mapped_column(String, nullable=False)
    name = mapped_column(String, nullable=False)
    # path to the dataset relative to the user's directory
    path = mapped_column(String, nullable=False)
    # JSON object of the metadata parsed at ingestion
    extra_metadata = mapped_column(String, nullable=False)

def db():
    client = create_engine("postgresql://{}:{}@database:5432/{}".format(
        os.environ["POSTGRES_USER"], os.environ["POSTGRES_PASSWORD"], os.environ["POSTGRES_DB"]
    ))

    Base.metadata.create_all(client)

    return client

# dataset routes
dataset = FastAPI()

# now the relevant fastapi endpoints for that
@dataset.post("/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    try:
        # get name from the form
        name = (await request.form()).get("name")
        # save the file to the user's directory
        # /srv/datasets
        userid = request.state.userinfo["sub"]
        if userid is None:
            raise HTTPException(status_code=401, detail="Unauthorized upload")
        uuid_to_ensure_it_is_unique = hashlib.sha256(file.filename.encode()).hexdigest()
        
        # check that there is not a dataset with the same name
        with Session(db()) as session:
            dataset = session.query(Dataset).filter(Dataset.name == name).first()
            if dataset is not None:
                raise HTTPException(status_code=400, detail="Dataset with the same name already exists")

        # make sure user directory exists
        os.makedirs(os.path.join("/srv/datasets", userid), exist_ok=True)
        path = os.path.join("/srv/datasets", userid, uuid_to_ensure_it_is_unique)
        with open(path, "wb") as f:
            f.write(file.file.read())
        
        # determine file size
        file_size = os.path.getsize(path)
        # number of lines
        num_lines = sum(1 for line in open(path))
        # create metadata
        metadata = {
            "file_size": file_size,
            "num_lines": num_lines,
            "created_on": str(datetime.datetime.now())
        }
        
        # save the metadata to the database
        with Session(db()) as session:
            dataset = Dataset(
                id=uuid.uuid4(),
                user_id=userid,
                name=name,
                path=path,
                extra_metadata=json.dumps(metadata)
            )
            session.add(dataset)
            session.commit()
            
            return {
                "id": dataset.id,
                "path": path,
                "extra_metadata": metadata
            }
    except Exception as e:
        import traceback
        traceback.print_exc()
        if type(e) == HTTPException:
            raise e
        raise HTTPException(status_code=500, detail="Failed to upload file")
    
@dataset.get("/list")
def list_datasets(request: Request):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized list")
    
    with Session(db()) as session:
        datasets = session.query(Dataset).filter(Dataset.user_id == userid).all()
        return [{"id": dataset.id, "name": dataset.name, "path": dataset.path, "extra_metadata": dataset.extra_metadata} for dataset in datasets]

@dataset.delete("/{id}")
def delete_dataset(request: Request, id: str):
    userid = request.state.userinfo["sub"]
    if userid is None:
        raise HTTPException(status_code=401, detail="Unauthorized delete")
    
    with Session(db()) as session:
        dataset = session.query(Dataset).filter(Dataset.id == id).first()
        if dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if dataset.user_id != userid:
            raise HTTPException(status_code=401, detail="Unauthorized delete")
        
        os.remove(dataset.path)
        session.delete(dataset)
        session.commit()
        return {"message": "Deleted"}