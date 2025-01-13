"""Defines routes for APIs related to benchmarks."""

from fastapi import FastAPI, Request
from models.datasets_and_traces import Dataset, User, db
from sqlalchemy import Float, cast, desc, func
from sqlalchemy.orm import Session

# dataset routes
benchmark = FastAPI()

"""
Public routes for listing and getting all public datasets that are linked to a given benchmark.
"""


@benchmark.get("/{benchmark_name}/leaderboard")
def get_leaderboard(benchmark_name: str, _: Request):
    """Get leaderboard for a dataset."""

    with Session(db()) as session:
        agent_name_expr = func.json_extract_path_text(
            Dataset.extra_metadata, "name"
        ).label("agent_name")
        accuracy_expr = cast(
            func.json_extract_path_text(Dataset.extra_metadata, "accuracy"), Float
        ).label("accuracy")
        benchmark_expr = func.json_extract_path_text(
            Dataset.extra_metadata, "benchmark"
        )

        datasets = (
            session.query(
                Dataset.name,
                User.username,
                agent_name_expr,
                accuracy_expr,
            )
            .join(User, User.id == Dataset.user_id)
            .filter(
                Dataset.is_public,
                benchmark_expr.isnot(None),
                accuracy_expr.isnot(None),
                benchmark_expr == benchmark_name,
            )
            .order_by(desc(accuracy_expr), agent_name_expr)
            .all()
        )

    return [
        {
            "name": agent_name if agent_name else f"{username}/{name}",
            "dataset": f"{username}/{name}",
            "accuracy": accuracy,
        }
        for name, username, agent_name, accuracy in datasets
    ]
