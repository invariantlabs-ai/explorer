import os
from typing import List
from typing import Optional
from sqlalchemy import ForeignKey
from sqlalchemy import String, Integer
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship
from sqlalchemy import create_engine

from sqlalchemy.dialects.postgresql import UUID
import uuid
from models.apikeys import db, APIKey

class TraceBase(DeclarativeBase):
    pass

class TracedAgentStep(TraceBase):
    __tablename__ = "traced_agent_steps"

    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    index = mapped_column(Integer, nullable=False)
    trace_id = mapped_column(UUID(as_uuid=True), nullable=False)
    created_on = mapped_column(String, nullable=False)
    type = mapped_column(String, nullable=False)
    data = mapped_column(String, nullable=False)
    deployment_id = mapped_column(String, nullable=False)

def trace_db():
    client = create_engine("postgresql://{}:{}@database:5432/{}".format(
        os.environ["POSTGRES_USER"], os.environ["POSTGRES_PASSWORD"], os.environ["POSTGRES_DB"]
    ))

    TraceBase.metadata.create_all(client)

    return client