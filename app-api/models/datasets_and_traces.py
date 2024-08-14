import hashlib
import os
import re
import json
import datetime

from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import String, Integer, Column, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import Session
from sqlalchemy import create_engine

import uuid
from sqlalchemy.dialects.postgresql import UUID
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

class Trace(Base):
    __tablename__ = "traces"

    # key is uuid that auto creates
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # int index of trace in dataset
    index = mapped_column(Integer, nullable=False)
    # foreign dataset id that this trace belongs to
    dataset_id = mapped_column(UUID(as_uuid=True), ForeignKey("datasets.id"), nullable=False)
    content = mapped_column(String, nullable=False)
    extra_metadata = mapped_column(String, nullable=False)

class User(Base):
    __tablename__ = "users"
    # database of users
    # this is NOT used for auth (see routes/auth.py), but just to map user_id -> display, image_path

    # key is uuid that must be supplied
    id = mapped_column(UUID(as_uuid=True), primary_key=True)
    username = mapped_column(String, nullable=False)
    image_url_hash = mapped_column(String, nullable=False)

class Annotation(Base):
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
    # JSON object of the metadata parsed at ingestion
    extra_metadata = mapped_column(String, nullable=False)

# simple table to capture all shared trace IDs
class SharedLinks(Base):
    __tablename__ = "shared_links"

    # key is uuid that auto creates
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # foreign user id that this shared link belongs to
    trace_id = mapped_column(UUID(as_uuid=True), ForeignKey("traces.id"), nullable=False)

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