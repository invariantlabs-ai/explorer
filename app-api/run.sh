#/bin/bash
alembic current
alembic upgrade head
uvicorn serve:app --host 0.0.0.0 --port 8000 --reload