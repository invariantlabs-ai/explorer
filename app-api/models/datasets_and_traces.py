import datetime
import hashlib
import os
import uuid

from database.database_manager import DatabaseManager
from pydantic import BaseModel, Field
from sqlalchemy import (
    ARRAY,
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


class Dataset(Base):
    __objectname__ = "Dataset"
    __tablename__ = "datasets"
    __table_args__ = (
        Index("idx_datasets_user_id", "user_id"),
        UniqueConstraint("user_id", "name", name="_user_id_name_uc"),
    )

    # key is uuid that auto creates
    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # user owning the dataset
    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    # name of the dataset
    name: Mapped[str] = mapped_column(String, nullable=False)
    # is the dataset visible to other users
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    time_created = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now()
    )
    # JSON object of the metadata parsed at ingestion
    extra_metadata = mapped_column(JSON, nullable=False)


class SavedQueries(Base):
    __objectname__ = "SavedQueries"
    __tablename__ = "queries"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    dataset_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    query: Mapped[str] = mapped_column(String, nullable=True)


class Trace(Base):
    __objectname__ = "Trace"
    __tablename__ = "traces"
    __table_args__ = (Index("idx_traces_dataset_id", "dataset_id"),)

    # key is uuid that auto creates
    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # int index of trace in dataset
    index: Mapped[int] = mapped_column(Integer, nullable=False)
    # foreign dataset id that this trace belongs to
    dataset_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("datasets.id"), nullable=True
    )
    # user that uploaded the trace
    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    # display name of the trace
    name: Mapped[str] = mapped_column(String, nullable=False)

    # hierarchy path of the trace
    hierarchy_path: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)

    content = mapped_column(JSON, nullable=False)
    extra_metadata = mapped_column(JSON, nullable=False)
    time_created = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now()
    )

    @hybrid_property
    def num_messages(self):
        return int(self.content["num_messages"])


class User(Base):
    __objectname__ = "User"
    __tablename__ = "users"
    __table_args__ = (Index("idx_users_username", "username"),)
    # database of users
    # this is NOT used for auth (see routes/auth.py), but just to map user_id -> display, image_path

    # key is uuid that must be supplied
    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    username: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    image_url_hash: Mapped[str] = mapped_column(String, nullable=False)


class Annotation(Base):
    __objectname__ = "Annotation"
    __tablename__ = "annotations"
    __table_args__ = (Index("idx_annotations_trace_id", "trace_id"),)

    # key is uuid that auto creates
    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # foreign trace id that this annotation belongs to
    trace_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("traces.id"), nullable=False
    )
    # foreign user id that this annotation belongs to
    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    # JSON object of the annotation
    content: Mapped[str] = mapped_column(String, nullable=False)
    # address within the trace that this annotation belongs to (e.g. message, offset, etc.)
    address: Mapped[str | None] = mapped_column(String, nullable=True)
    # timestamp of the creation of the comment
    time_created = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now()
    )
    extra_metadata = mapped_column(JSON, nullable=True)

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "content": self.content,
            "address": self.address,
            "time_created": self.time_created,
            "extra_metadata": self.extra_metadata,
        }


# simple table to capture all shared trace IDs
class SharedLinks(Base):
    __objectname__ = "SharedLinks"
    __tablename__ = "shared_links"

    # key is uuid that auto creates
    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # foreign user id that this shared link belongs to
    trace_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("traces.id"), nullable=False
    )
    # timestamp of the sharing of the trace
    time_created = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now()
    )


class APIKey(Base):
    __objectname__ = "APIKeys"
    __tablename__ = "api_keys"
    __table_args__ = (Index("idx_api_keys_user_id", "user_id"),)

    # key id
    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Hashed key (sha256 + last 4 characters of original key)
    #  - Show [-4:] of this to the user to enable them to distinguish between keys.
    #  - Showing the rest would be a security risk, as they could then try to brute force the key.
    hashed_key: Mapped[str] = mapped_column(String, primary_key=True)
    # foreign user id that this api key belongs to
    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    # timestamp of the creation of the api key
    time_created = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now()
    )
    # expired (true if the key has been revoked)
    expired: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    @staticmethod
    def hash_key(key):
        return hashlib.sha256(key.encode()).hexdigest() + key[-4:]

    @staticmethod
    def generate_key():
        # generate a random 32 character key
        return "inv-" + hashlib.sha256(os.urandom(32)).hexdigest()


class DatasetPolicy(BaseModel):
    """Describes a policy associated with a Dataset."""

    id: str
    name: str
    content: str
    # whether this policy is enabled
    enabled: bool
    # the mode of this policy (e.g. block, log, etc.)
    action: str
    # extra metadata for the policy (can be used to store internal extra data about a guardrail)
    extra_metadata: dict = Field(default_factory=dict)

    # The timestamp when the policy was created or last updated (whichever is later).
    last_updated_time: str = Field(
        default_factory=lambda: datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    )

    def to_dict(self) -> dict:
        """Represents the object as a dictionary."""
        return self.model_dump()


class DatasetJob(Base):
    """Describes a job associated with a Dataset (e.g. analysis)"""

    __objectname__ = "DatasetJob"
    __tablename__ = "dataset_jobs"

    # id of this job
    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # who triggered this job
    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    # which dataset this job is associated with
    dataset_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("datasets.id"), nullable=False
    )

    # extra metadata for the job (can be used to store job-specific data,
    # and can be shown to the user)
    extra_metadata: Mapped[dict] = mapped_column(JSON, nullable=False)

    # credentials for running the job (e.g. external API keys), should not
    # be shown to the user after initial entry
    secret_metadata: Mapped[dict] = mapped_column(JSON, nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "dataset_id": self.dataset_id,
            "extra_metadata": self.extra_metadata,
            # do not include secret_metadata
        }


def db():
    """
    Returns a SQLAlchemy engine object that is connected to the database.
    """
    return DatabaseManager.get_engine()
