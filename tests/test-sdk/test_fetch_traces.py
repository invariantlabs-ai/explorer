import json
import os
import sys

import pytest

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from util import TemporaryExplorerDataset

pytest_plugins = ("pytest_asyncio",)


@pytest.mark.parametrize("is_async", [True, False])
async def test_fetch_dataset_byid(
    is_async, context, url, async_invariant_client, invariant_client, data_abc
):
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Download the trace
        if is_async:
            dataset_fetched = await async_invariant_client.request(
                method="GET",
                pathname=f"/api/v1/dataset/byid/{dataset['id']}",
                request_kwargs={},
            )
        else:
            dataset_fetched = invariant_client.request(
                method="GET",
                pathname=f"/api/v1/dataset/byid/{dataset['id']}",
                request_kwargs={},
            )
        assert dataset_fetched.status_code == 200
        dataset_fetched = json.loads(dataset_fetched.content)

    for key in dataset:
        assert dataset[key] == dataset_fetched[key]


@pytest.mark.parametrize("is_async", [True, False])
async def test_fetch_dataset_byuser(
    is_async, context, url, async_invariant_client, invariant_client, data_abc
):
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Download the trace
        if is_async:
            dataset_fetched = await async_invariant_client.request(
                method="GET",
                pathname=f"/api/v1/dataset/byuser/developer/{dataset['name']}",
                request_kwargs={},
            )
        else:
            dataset_fetched = invariant_client.request(
                method="GET",
                pathname=f"/api/v1/dataset/byuser/developer/{dataset['name']}",
                request_kwargs={},
            )
        assert dataset_fetched.status_code == 200
        dataset_fetched = json.loads(dataset_fetched.content)

    for key in dataset:
        assert dataset[key] == dataset_fetched[key]


@pytest.mark.parametrize("is_async", [True, False])
async def test_list_datasets(
    is_async, context, url, async_invariant_client, invariant_client, data_abc
):
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Download the trace
        if is_async:
            list_dataset_fetched = await async_invariant_client.request(
                method="GET",
                pathname="/api/v1/dataset/list",
                request_kwargs={"params": {"kind": "any"}},
            )
        else:
            list_dataset_fetched = invariant_client.request(
                method="GET",
                pathname="/api/v1/dataset/list",
                request_kwargs={"params": {"kind": "any"}},
            )
        assert list_dataset_fetched.status_code == 200
        list_dataset_fetched = json.loads(list_dataset_fetched.content)
        assert dataset["id"] in [dtst["id"] for dtst in list_dataset_fetched]


def fetch_trace_byid_sdk(id: str, invariant_client) -> dict:
    """Fetch a trace by its id using the SDK."""
    trace_fetched = invariant_client.request(
        method="GET",
        pathname=f"/api/v1/trace/{id}",
        request_kwargs={},
    )
    return json.loads(trace_fetched.content)


@pytest.mark.parametrize("is_async", [True, False])
async def test_fetch_traces_byid(
    is_async, context, url, async_invariant_client, invariant_client, data_abc
):
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Download the trace
        if is_async:
            traces_fetched = await async_invariant_client.request(
                method="GET",
                pathname=f"/api/v1/dataset/byid/{dataset['id']}/traces",
                request_kwargs={},
            )
        else:
            traces_fetched = invariant_client.request(
                method="GET",
                pathname=f"/api/v1/dataset/byid/{dataset['id']}/traces",
                request_kwargs={},
            )
        assert traces_fetched.status_code == 200
        traces_fetched = json.loads(traces_fetched.content)
        traces = [
            fetch_trace_byid_sdk(tf["id"], invariant_client) for tf in traces_fetched
        ]
    assert [trace["messages"] for trace in traces] == [
        json.loads(row) for row in data_abc.split("\n")[:-1]
    ]


@pytest.mark.parametrize("is_async", [True, False])
async def test_fetch_traces_byuser(
    is_async, context, url, async_invariant_client, invariant_client, data_abc
):
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Download the trace
        if is_async:
            traces_fetched = await async_invariant_client.request(
                method="GET",
                pathname=f"/api/v1/dataset/byuser/developer/{dataset['name']}/traces",
                request_kwargs={},
            )
        else:
            traces_fetched = invariant_client.request(
                method="GET",
                pathname=f"/api/v1/dataset/byuser/developer/{dataset['name']}/traces",
                request_kwargs={},
            )
        assert traces_fetched.status_code == 200
        traces_fetched = json.loads(traces_fetched.content)
        traces = [
            fetch_trace_byid_sdk(tf["id"], invariant_client) for tf in traces_fetched
        ]
    assert [trace["messages"] for trace in traces] == [
        json.loads(row) for row in data_abc.split("\n")[:-1]
    ]
