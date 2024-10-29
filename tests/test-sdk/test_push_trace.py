"""Tests for the push trace API via SDK."""

import os
import sys
from typing import Dict, List

import pytest
from invariant_sdk.client import Client
from invariant_sdk.types.push_traces import PushTracesResponse
from playwright.async_api import expect

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from util import *  # needed for pytest fixtures

pytest_plugins = ("pytest_asyncio",)


@pytest.fixture(name="invariant_client")
def fixture_invariant_client():
    """Fixture to create Client instance."""
    return Client(
        api_url="http://localhost:8000",
        api_key="<test-api-key>",  # When DEV_MODE is true, this is not used.
    )


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

    if include_metadata:
        expected_metadata_1 = {
            "uploader": "Via API with DEV_MODE true",
            **push_traces_metadata[0],
        }
        expected_metadata_2 = {
            "uploader": "Via API with DEV_MODE true",
            **push_traces_metadata[1],
        }
        assert expected_metadata_1 in (
            trace_1["extra_metadata"],
            trace_2["extra_metadata"],
        ) and expected_metadata_2 in (
            trace_1["extra_metadata"],
            trace_2["extra_metadata"],
        )
    else:
        assert trace_1["extra_metadata"] == {
            "uploader": "Via API with DEV_MODE true"
        } and trace_2["extra_metadata"] == {"uploader": "Via API with DEV_MODE true"}
    return True


@pytest.mark.parametrize(
    "include_annotations, include_metadata",
    [(True, True), (True, False), (False, True), (False, False)],
)
async def test_create_request_and_push_trace_without_dataset(
    context,
    url,
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
    response = invariant_client.create_request_and_push_trace(
        messages=push_traces_messages,
        annotations=annotations,
        metadata=metadata,
    )

    assert len(response.id) == 2
    assert response.dataset is None

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
    "include_annotations, include_metadata",
    [(True, True), (True, False), (False, True), (False, False)],
)
async def test_create_request_and_push_trace_with_dataset(
    context,
    url,
    data_abc,
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
        response = invariant_client.create_request_and_push_trace(
            messages=push_traces_messages,
            annotations=annotations,
            metadata=metadata,
            dataset=dataset["name"],
        )

        assert len(response.id) == 2
        assert response.dataset == dataset["name"]

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
