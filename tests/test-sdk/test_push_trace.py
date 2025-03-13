"""Tests for the push trace API via SDK."""

import asyncio
import os
import sys
import uuid
from typing import Dict, List

import pytest
from invariant_sdk.types.push_traces import PushTracesResponse
from playwright.async_api import expect

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from util import *  # needed for pytest fixtures

pytest_plugins = ("pytest_asyncio",)


@pytest.fixture(name="push_traces_messages")
def fixture_push_traces_messages():
    """Fixture to create messages."""
    return [
        [
            {"role": "user", "content": "one"},
            {"role": "assistant", "content": "two \n three"},
        ],
        [
            {"role": "user", "content": "four"},
            {"role": "assistant", "content": "five \n six"},
        ],
    ]


@pytest.fixture(name="push_traces_annotations")
def fixture_push_traces_annotations():
    """Fixture to create annotations."""
    return [
        [
            {
                "content": "annotating one",
                "address": "messages[0].content:L0",
                "extra_metadata": {"key1": "value1"},
            },
            {
                "content": "annotating two",
                "address": "messages[1].content:L0",
                "extra_metadata": {"key2": "value2"},
            },
        ],
        [
            {
                "content": "annotating four",
                "address": "messages[0].content:L0",
                "extra_metadata": {"key5": "value5"},
            },
            {
                "content": "annotating five",
                "address": "messages[1].content:L0",
                "extra_metadata": {"key6": "value6"},
            },
        ],
    ]


@pytest.fixture(name="push_traces_metadata")
def fixture_push_traces_metadata():
    """Fixture to create metadata."""
    return [{"meta_key_1": "meta_value_1"}, {"meta_key_2": "meta_value_2"}]


def reduce_response_annotations(resp: PushTracesResponse) -> List[Dict]:
    """Reduce annotation fields from the response for comparison."""
    result = []
    for annotation in resp["annotations"]:
        result.append(
            {
                "content": annotation["content"],
                "address": annotation["address"],
                "extra_metadata": annotation["extra_metadata"],
            }
        )
    return result


def validate_trace_responses(
    trace_1,
    trace_2,
    push_traces_messages,
    push_traces_annotations,
    include_annotations,
    push_traces_metadata,
    include_metadata,
):  # pylint: disable=too-many-arguments
    """Validate trace responses."""

    assert push_traces_messages[0] in (
        trace_1["messages"],
        trace_2["messages"],
    ) and push_traces_messages[1] in (
        trace_1["messages"],
        trace_2["messages"],
    )

    if include_annotations:
        trace_1_annotations = reduce_response_annotations(trace_1)
        trace_2_annotations = reduce_response_annotations(trace_2)
        assert push_traces_annotations[0] in (
            trace_1_annotations,
            trace_2_annotations,
        ) and push_traces_annotations[1] in (
            trace_1_annotations,
            trace_2_annotations,
        )
    else:
        assert trace_1["annotations"] == [] and trace_2["annotations"] == []
    return True


@pytest.mark.parametrize(
    "is_async, include_annotations, include_metadata",
    [
        (True, True, True),
        (True, True, False),
        (True, False, True),
        (True, False, False),
        (False, True, True),
        (False, True, False),
        (False, False, True),
        (False, False, False),
    ],
)
async def test_create_request_and_push_trace_without_dataset(
    is_async,
    context,
    url,
    async_invariant_client,
    invariant_client,
    push_traces_messages,
    push_traces_annotations,
    include_annotations,
    push_traces_metadata,
    include_metadata,
):  # pylint: disable=too-many-arguments disable=too-many-locals
    """Test creating request and pushing trace without dataset."""
    annotations = push_traces_annotations if include_annotations else None
    metadata = push_traces_metadata if include_metadata else None
    if is_async:
        response = await async_invariant_client.create_request_and_push_trace(
            messages=push_traces_messages,
            annotations=annotations,
            metadata=metadata,
        )
    else:
        response = invariant_client.create_request_and_push_trace(
            messages=push_traces_messages,
            annotations=annotations,
            metadata=metadata,
        )

    assert len(response.id) == 2
    assert response.dataset is None
    assert response.username == "developer"

    trace_response_1 = await context.request.get(f"{url}/api/v1/trace/{response.id[0]}")
    trace_response_2 = await context.request.get(f"{url}/api/v1/trace/{response.id[1]}")
    await expect(trace_response_1).to_be_ok()
    await expect(trace_response_2).to_be_ok()
    trace_1 = await trace_response_1.json()
    trace_2 = await trace_response_2.json()

    assert trace_1["dataset"] is None and trace_2["dataset"] is None
    validate_trace_responses(
        trace_1,
        trace_2,
        push_traces_messages,
        push_traces_annotations,
        include_annotations,
        push_traces_metadata,
        include_metadata,
    )


@pytest.mark.parametrize(
    "is_async, include_annotations, include_metadata",
    [
        (True, True, True),
        (True, True, False),
        (True, False, True),
        (True, False, False),
        (False, True, True),
        (False, True, False),
        (False, False, True),
        (False, False, False),
    ],
)
async def test_create_request_and_push_trace_with_existing_dataset(
    is_async,
    context,
    url,
    data_abc,
    async_invariant_client,
    invariant_client,
    push_traces_messages,
    push_traces_annotations,
    include_annotations,
    push_traces_metadata,
    include_metadata,
):  # pylint: disable=too-many-arguments disable=too-many-locals
    """Test creating request and pushing trace with dataset."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        annotations = push_traces_annotations if include_annotations else None
        metadata = push_traces_metadata if include_metadata else None
        if is_async:
            response = await async_invariant_client.create_request_and_push_trace(
                messages=push_traces_messages,
                annotations=annotations,
                metadata=metadata,
                dataset=dataset["name"],
            )
        else:
            response = invariant_client.create_request_and_push_trace(
                messages=push_traces_messages,
                annotations=annotations,
                metadata=metadata,
                dataset=dataset["name"],
            )

        assert len(response.id) == 2
        assert response.dataset == dataset["name"]
        assert response.username == "developer"

        trace_response_1 = await context.request.get(
            f"{url}/api/v1/trace/{response.id[0]}"
        )
        trace_response_2 = await context.request.get(
            f"{url}/api/v1/trace/{response.id[1]}"
        )
        await expect(trace_response_1).to_be_ok()
        await expect(trace_response_2).to_be_ok()
        trace_1 = await trace_response_1.json()
        trace_2 = await trace_response_2.json()

        assert (
            trace_1["dataset"] == dataset["id"] and trace_2["dataset"] == dataset["id"]
        )
        validate_trace_responses(
            trace_1,
            trace_2,
            push_traces_messages,
            push_traces_annotations,
            include_annotations,
            push_traces_metadata,
            include_metadata,
        )


@pytest.mark.parametrize(
    "is_async, include_annotations, include_metadata",
    [
        (True, True, True),
        (True, True, False),
        (True, False, True),
        (True, False, False),
        (False, True, True),
        (False, True, False),
        (False, False, True),
        (False, False, False),
    ],
)
async def test_create_request_and_push_trace_while_creating_dataset(
    is_async,
    context,
    url,
    async_invariant_client,
    invariant_client,
    push_traces_messages,
    push_traces_annotations,
    include_annotations,
    push_traces_metadata,
    include_metadata,
):  # pylint: disable=too-many-arguments disable=too-many-locals
    """Test creating request and pushing traces while creating corresponding datasets."""
    annotations = push_traces_annotations if include_annotations else None
    metadata = push_traces_metadata if include_metadata else None
    # This dataset doesn't exist and will be created as part of the push traces request.
    dataset_name = "test_dataset" + str(uuid.uuid4())
    if is_async:
        response = await async_invariant_client.create_request_and_push_trace(
            messages=push_traces_messages,
            annotations=annotations,
            metadata=metadata,
            dataset=dataset_name,
        )
    else:
        response = invariant_client.create_request_and_push_trace(
            messages=push_traces_messages,
            annotations=annotations,
            metadata=metadata,
            dataset=dataset_name,
        )

    assert len(response.id) == 2
    assert response.dataset == dataset_name
    assert response.username == "developer"

    trace_response_1 = await context.request.get(f"{url}/api/v1/trace/{response.id[0]}")
    trace_response_2 = await context.request.get(f"{url}/api/v1/trace/{response.id[1]}")
    await expect(trace_response_1).to_be_ok()
    await expect(trace_response_2).to_be_ok()
    trace_1 = await trace_response_1.json()
    trace_2 = await trace_response_2.json()

    validate_trace_responses(
        trace_1,
        trace_2,
        push_traces_messages,
        push_traces_annotations,
        include_annotations,
        push_traces_metadata,
        include_metadata,
    )

    # Clean up the dataset created.
    dataset_id = trace_1["dataset"]
    dataset_delete_response = await context.request.delete(
        f"{url}/api/v1/dataset/byid/{dataset_id}"
    )
    await expect(dataset_delete_response).to_be_ok()


async def test_push_multiple_traces_in_parallel_to_same_dataset(
    context, url, async_invariant_client
):
    """Test that push_traces works correctly when we push multiple traces in parallel."""
    dataset_name = "test_dataset" + str(uuid.uuid4())
    number_requests = 50  # Number of traces to push in parallel

    async def push_trace(i):
        try:
            response = await async_invariant_client.create_request_and_push_trace(
                messages=[
                    [
                        {"role": "user", "content": f"request: {str(i)}"},
                        {"role": "assistant", "content": f"response: {str(i)}"},
                    ]
                ],
                dataset=dataset_name,
            )
            return response.id[0]
        except Exception as _:
            return None

    # Run all tasks in parallel
    trace_ids = await asyncio.gather(*[push_trace(i) for i in range(number_requests)])

    trace_ids = [t for t in trace_ids if t is not None]
    assert len(trace_ids) == number_requests, "Some push trace requests failed"

    trace_indices = []
    trace_names = []
    trace_user_contents = []
    trace_assistant_contents = []

    dataset_id = None
    for trace_id in trace_ids:
        trace_response = await context.request.get(f"{url}/api/v1/trace/{trace_id}")
        await expect(trace_response).to_be_ok()
        trace = await trace_response.json()
        trace_indices.append(trace["index"])
        trace_names.append(trace["name"])
        trace_user_contents.append(trace["messages"][0]["content"])
        trace_assistant_contents.append(trace["messages"][1]["content"])
        if dataset_id is None:
            dataset_id = trace["dataset"]
        else:
            assert (
                dataset_id == trace["dataset"]
            ), "All traces should belong to same dataset"

    assert set(trace_indices) == set(range(number_requests))
    assert set(trace_names) == {f"Run {i}" for i in range(number_requests)}
    assert set(trace_user_contents) == {f"request: {i}" for i in range(number_requests)}
    assert set(trace_assistant_contents) == {
        f"response: {i}" for i in range(number_requests)
    }

    # Clean up the dataset created.
    dataset_delete_response = await context.request.delete(
        f"{url}/api/v1/dataset/byid/{dataset_id}"
    )
    await expect(dataset_delete_response).to_be_ok()
