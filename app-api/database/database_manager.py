"""Database manager singleton class."""

import os
import threading
import time

from sqlalchemy import create_engine, event


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
                    DatabaseManager.attach_query_logger(DatabaseManager._engine)
        return DatabaseManager._engine

    @staticmethod
    def attach_query_logger(engine):
        """Attach event listeners to measure query execution time."""

        @event.listens_for(engine, "before_cursor_execute")
        def before_cursor_execute(
            conn, cursor, statement, parameters, context, executemany
        ):
            context._query_start_time = time.time()

        @event.listens_for(engine, "after_cursor_execute")
        def after_cursor_execute(
            conn, cursor, statement, parameters, context, executemany
        ):
            total_time = time.time() - context._query_start_time
            print(f"SQL Query: {statement} | Duration: {total_time:.4f} seconds")

    @staticmethod
    def get_db_url():
        """Return the database URL."""
        return (
            f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
            f"@{os.getenv('POSTGRES_HOST')}:5432/{os.getenv('POSTGRES_DB')}"
        )
