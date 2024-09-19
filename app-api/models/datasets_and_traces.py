import hashlib
import os
import re
import json
import datetime

from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import String, Integer, Column, ForeignKey, DateTime, UniqueConstraint, Boolean, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import mapped_column
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Session
from sqlalchemy import create_engine

import uuid
from sqlalchemy.dialects.postgresql import UUID
from fastapi import FastAPI, File, UploadFile, Request, HTTPException

class Base(DeclarativeBase):
    pass

class Dataset(Base):
    __objectname__ = "Dataset"
    __tablename__ = "datasets"
    __table_args__ = (UniqueConstraint('user_id', 'name', name='_user_id_name_uc'),)

    # key is uuid that auto creates
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # user owning the dataset
    user_id = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # name of the dataset
    name = mapped_column(String, nullable=False)
    # is the dataset visible to other users
    is_public = mapped_column(Boolean, default=False, nullable=False) 
    time_created = mapped_column(DateTime(timezone=True), nullable=False, default=func.now())
    # JSON object of the metadata parsed at ingestion
    extra_metadata = mapped_column(JSON, nullable=False)

class SavedQueries(Base):
    __objectname__ = "SavedQueries"
    __tablename__ = "queries"
   
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4) 
    name = mapped_column(String, nullable=False)
    user_id = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    dataset_id = mapped_column(UUID(as_uuid=True), ForeignKey("datasets.id"), nullable=False)
    query = mapped_column(String, nullable=True)
   

class Trace(Base):
    __objectname__ = "Trace"
    __tablename__ = "traces"

    # key is uuid that auto creates
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # int index of trace in dataset
    index = mapped_column(Integer, nullable=False)
    # foreign dataset id that this trace belongs to
    dataset_id = mapped_column(UUID(as_uuid=True), ForeignKey("datasets.id"), nullable=True)
    # user that uploaded the trace
    user_id = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    
    content = mapped_column(JSON, nullable=False)
    extra_metadata = mapped_column(JSON, nullable=False)
    time_created = mapped_column(DateTime(timezone=True), nullable=False, default=func.now())
    
    @hybrid_property
    def num_messages(self):
        return int(self.content['num_messages'])

class User(Base):
    __objectname__ = "User"
    __tablename__ = "users"
    # database of users
    # this is NOT used for auth (see routes/auth.py), but just to map user_id -> display, image_path

    # key is uuid that must be supplied
    id = mapped_column(UUID(as_uuid=True), primary_key=True)
    username = mapped_column(String, nullable=False, unique=True)
    image_url_hash = mapped_column(String, nullable=False)

class Annotation(Base):
    __objectname__ = "Annotation"
    __tablename__ = "annotations"

    # key is uuid that auto creates
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # foreign trace id that this annotation belongs to
    trace_id = mapped_column(UUID(as_uuid=True), ForeignKey("traces.id"), nullable=False)
    # foreign user id that this annotation belongs to
    user_id = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # JSON object of the annotation
    content = mapped_column(String, nullable=False)
    # address within the trace that this annotation belongs to (e.g. message, offset, etc.)
    address = mapped_column(String, nullable=False)
    # timestamp of the creation of the comment
    time_created = mapped_column(DateTime(timezone=True), nullable=False, default=func.now())
    extra_metadata = mapped_column(JSON, nullable=True)

# simple table to capture all shared trace IDs
class SharedLinks(Base):
    __objectname__ = "SharedLinks"
    __tablename__ = "shared_links"

    # key is uuid that auto creates
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # foreign user id that this shared link belongs to
    trace_id = mapped_column(UUID(as_uuid=True), ForeignKey("traces.id"), nullable=False)
    # timestamp of the sharing of the trace
    time_created = mapped_column(DateTime(timezone=True), nullable=False, default=func.now())

class APIKey(Base):
    __objectname__ = "APIKeys"
    __tablename__ = "api_keys"

    # key id
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Hashed key (sha256 + last 4 characters of original key) 
    #  - Show [-4:] of this to the user to enable them to distinguish between keys.
    #  - Showing the rest would be a security risk, as they could then try to brute force the key.
    hashed_key = mapped_column(String, primary_key=True)
    # foreign user id that this api key belongs to
    user_id = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # timestamp of the creation of the api key
    time_created = mapped_column(DateTime(timezone=True), nullable=False, default=func.now())
    # expired (true if the key has been revoked)
    expired = mapped_column(Boolean, nullable=False, default=False)

    @staticmethod
    def hash_key(key):
        return hashlib.sha256(key.encode()).hexdigest() + key[-4:]
    
    @staticmethod
    def generate_key():
        # generate a random 32 character key
        return "inv-" + hashlib.sha256(os.urandom(32)).hexdigest()

def get_db_url():
    return "postgresql://{}:{}@database:5432/{}".format(os.environ["POSTGRES_USER"],
                                                        os.environ["POSTGRES_PASSWORD"],
                                                        os.environ["POSTGRES_DB"])

def db():
    """
    Returns a SQLAlchemy engine object that is connected to the database.
    """
    client = create_engine(get_db_url())
    return client