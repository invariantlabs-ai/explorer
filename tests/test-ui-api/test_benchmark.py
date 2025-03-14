"""Tests for benchmark API endpoints."""

import os

# add tests folder (parent) to sys.path
import sys
import uuid

from playwright.async_api import expect

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

pytest_plugins = ("pytest_asyncio",)


async def create_dataset(
    context, url, dataset_name, benchmark, agent_name, accuracy, is_public
):
    """Creates a dataset."""
    create_dataset_response = await context.request.post(
        f"{url}/api/v1/dataset/create",
        data={
            "name": dataset_name,
            "metadata": {
                "benchmark": benchmark,
                "name": agent_name,
                "accuracy": accuracy,
            },
            "is_public": is_public,
        },
    )
    await expect(create_dataset_response).to_be_ok()
    return await create_dataset_response.json()


async def delete_datasets(context, url, dataset_ids):
    """Deletes one or more datasets."""
    for dataset_id in dataset_ids:
        response = await context.request.delete(
            f"{url}/api/v1/dataset/byid/{dataset_id}"
        )
        await expect(response).to_be_ok()


async def get_leaderboard(context, url, benchmark_name):
    """Fetch leaderboard for a given benchmark."""
    response = await context.request.get(
        f"{url}/api/v1/benchmark/{benchmark_name}/leaderboard"
    )
    assert response.status == 200
    return await response.json()


async def test_get_leaderboard_for_non_existent_benchmark(context, url):
    """Test that the leaderboard for a non-existent benchmark is empty."""
    leaderboard = await get_leaderboard(context, url, uuid.uuid4())
    assert leaderboard == []


async def test_get_leaderboard_for_existing_benchmark(context, url):
    """Test that the leaderboard for an existing benchmark is not empty."""
    web_arena_dataset_1 = await create_dataset(
        context,
        url,
        f"web_arena_{uuid.uuid4()}",
        "web-arena",
        "gpt-4o-2024-05-13",
        0.5,
        True,
    )
    web_arena_dataset_2 = await create_dataset(
        context,
        url,
        f"web_arena_{uuid.uuid4()}",
        "web-arena",
        "claude-3-5-sonnet-20240620",
        0.5,
        True,
    )
    web_arena_dataset_3 = await create_dataset(
        context,
        url,
        f"web_arena_{uuid.uuid4()}",
        "web-arena",
        "o1-preview-2024-09-12",
        0.8,
        True,
    )

    tau_bench_dataset_1 = await create_dataset(
        context, url, f"tau_bench_{uuid.uuid4()}", "tau-bench", "gpt-4-0613", 0.5, False
    )
    tau_bench_dataset_2 = await create_dataset(
        context, url, f"tau_bench_{uuid.uuid4()}", "tau-bench", "SteP", 0.6, True
    )

    response_web_arena = await get_leaderboard(context, url, "web-arena")
    assert response_web_arena == [
        {
            "name": "o1-preview-2024-09-12",
            "dataset": f"developer/{web_arena_dataset_3['name']}",
            "accuracy": 0.8,
        },
        {
            "name": "claude-3-5-sonnet-20240620",
            "dataset": f"developer/{web_arena_dataset_2['name']}",
            "accuracy": 0.5,
        },
        {
            "name": "gpt-4o-2024-05-13",
            "dataset": f"developer/{web_arena_dataset_1['name']}",
            "accuracy": 0.5,
        },
    ]

    response_tau_bench = await get_leaderboard(context, url, "tau-bench")
    assert response_tau_bench == [
        {
            "name": "SteP",
            "dataset": f"developer/{tau_bench_dataset_2['name']}",
            "accuracy": 0.6,
        }
    ]

    await delete_datasets(
        context,
        url,
        [
            web_arena_dataset_1["id"],
            web_arena_dataset_2["id"],
            web_arena_dataset_3["id"],
            tau_bench_dataset_1["id"],
            tau_bench_dataset_2["id"],
        ],
    )
