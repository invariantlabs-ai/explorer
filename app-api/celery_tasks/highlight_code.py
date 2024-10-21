"""Celery task to highlight code."""

from celery_config import celery_app


@celery_app.task(acks_late=True, ignore_result=True)
def highlight_code_for_snippet(trace_id: str):
    """Highlight code for a snippet."""
    print("Received task to highlight code for trace_id: ", trace_id)
    # - load trace from database
    # - highlight code
    # - save highlighted code to database
