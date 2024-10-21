"""Celery app for background tasks."""

import os

from celery import Celery

celery_app = Celery(
    "celery_app",
    broker=os.getenv("CELERY_BROKER_URL"),
    backend=os.getenv("CELERY_RESULT_BACKEND"),
    imports=["celery_tasks.highlight_code"],
)
