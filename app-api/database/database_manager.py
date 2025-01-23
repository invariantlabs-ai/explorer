"""Database manager singleton class."""

import os
import threading

from sqlalchemy import create_engine


class DatabaseManager:
    """Singleton class for the SQLAlchemy engine."""

    _engine = None
    _lock = threading.Lock()

    def __new__(cls):
        """Prevent direct instantiation of the class."""
        raise RuntimeError("Use DatabaseManager.get_engine() instead")

    @staticmethod
    def get_engine():
        """Initialize and return the single SQLAlchemy engine instance."""
        if DatabaseManager._engine is None:
            with DatabaseManager._lock:
                if DatabaseManager._engine is None:
                    DatabaseManager._engine = create_engine(
                        DatabaseManager.get_db_url(),
                        pool_size=int(os.environ.get("DB_POOL_SIZE", 10)),
                        max_overflow=int(os.environ.get("DB_MAX_OVERFLOW", 5)),
                        pool_recycle=1800,
                        pool_pre_ping=True,
                    )
        return DatabaseManager._engine

    @staticmethod
    def get_db_url():
        """Return the database URL."""
        return (
            f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
            f"@{os.getenv('POSTGRES_HOST')}:5432/{os.getenv('POSTGRES_DB')}"
        )
