"""Tests for the GetDatasetMetadata API via SDK."""

import os
import sys

import pytest

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from util import *  # needed for pytest fixtures

pytest_plugins = ("pytest_asyncio",)

MESSAGES_WITHOUT_TOOL_CALLS = [
    {"role": "user", "content": "test XYZ test"},
    {"role": "assistant", "content": "i like XYZ!"},
]

MESSAGES_WITH_TOOL_CALLS = [
    {"role": "user", "content": "Solve a quadratic equation where a=2, b=6, and c=5"},
    {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            {
                "id": "call_CsSvRivBjvhkgmAegBJS",
                "type": "function",
                "function": {
                    "name": "solve_quadratic_equation",
                    "arguments": {"a": 2, "b": 6, "c": 5},
                },
            }
        ],
    },
]


async def get_traces_for_dataset(context, url, dataset_id):
    """Helper function to retrieve traces for a dataset."""
    response = await context.request.get(
        f"{url}/api/v1/dataset/byid/{dataset_id}/traces"
    )
    return await response.json()


async def get_trace_messages(context, url, trace_id):
    """Helper function to retrieve trace messages."""
    response = await context.request.get(f"{url}/api/v1/trace/{trace_id}")
    trace = await response.json()
    return trace.get("messages", [])


@pytest.mark.parametrize("is_async", [True, False])
async def test_append_messages(
    is_async,
    context,
    url,
    data_abc,
    invariant_client,
    async_invariant_client,
):
    """Test that consecutive calls to append_messages succeeds."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        traces = await get_traces_for_dataset(context, url, dataset["id"])
        trace_id = traces[0]["id"]

        # Validate initial messages
        initial_messages = await get_trace_messages(context, url, trace_id)
        assert len(initial_messages) == 2

        # Append first set of messages
        if is_async:
            response = await async_invariant_client.create_request_and_append_messages(
                trace_id=trace_id, messages=MESSAGES_WITHOUT_TOOL_CALLS
            )
        else:
            response = invariant_client.create_request_and_append_messages(
                trace_id=trace_id, messages=MESSAGES_WITHOUT_TOOL_CALLS
            )
        assert response.get("success", False)

        # verify that the messages were appended
        updated_trace = await get_trace_messages(context, url, trace_id)
        assert len(updated_trace) == 4
        # the first two messages are the original ones
        assert updated_trace[0:2] == initial_messages
        # the last two messages are the new ones we appended
        assert (
            "timestamp" in updated_trace[2]
            and "timestamp" in updated_trace[3]
            and updated_trace[2]["timestamp"] == updated_trace[3]["timestamp"]
        )
        del updated_trace[2]["timestamp"]
        del updated_trace[3]["timestamp"]
        assert updated_trace[2:] == MESSAGES_WITHOUT_TOOL_CALLS

        # Append second set of messages
        if is_async:
            response = await async_invariant_client.create_request_and_append_messages(
                trace_id=trace_id, messages=MESSAGES_WITH_TOOL_CALLS
            )
        else:
            response = invariant_client.create_request_and_append_messages(
                trace_id=trace_id, messages=MESSAGES_WITH_TOOL_CALLS
            )
        assert response.get("success", False)

        # verify that the messages were appended
        updated_trace = await get_trace_messages(context, url, trace_id)
        assert len(updated_trace) == 6
        # the first two messages are the original ones
        assert updated_trace[0:2] == initial_messages
        # the next two messages are the new ones we appended in the previous step
        assert (
            "timestamp" in updated_trace[2]
            and "timestamp" in updated_trace[3]
            and updated_trace[2]["timestamp"] == updated_trace[3]["timestamp"]
        )
        del updated_trace[2]["timestamp"]
        del updated_trace[3]["timestamp"]
        assert updated_trace[2:4] == MESSAGES_WITHOUT_TOOL_CALLS
        # the last two messages are the new ones we appended
        assert (
            "timestamp" in updated_trace[4]
            and "timestamp" in updated_trace[5]
            and updated_trace[4]["timestamp"] == updated_trace[5]["timestamp"]
        )
        del updated_trace[4]["timestamp"]
        del updated_trace[5]["timestamp"]
        assert updated_trace[4:] == MESSAGES_WITH_TOOL_CALLS
