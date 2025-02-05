"""Tests for the trace APIs."""

import os

# add tests folder (parent) to sys.path
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid

import util
from deepdiff import DeepDiff
from util import *  # needed for pytest fixtures

pytest_plugins = ("pytest_asyncio",)

MESSAGES_WITHOUT_TOOL_CALLS = [
    {"role": "user", "content": "test XYZ test"},
    {"role": "assistant", "content": "i like XYZ!"},
]

MESSAGES_WITH_OLD_TIMESTAMP = [
    {
        "role": "user",
        "content": "Older message 1",
        "timestamp": "2021-01-01T00:00:00+00:00",
    },
    {
        "role": "assistant",
        "content": "Older message 2",
        "timestamp": "2021-01-01T00:00:00+00:00",
    },
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


async def append_messages(context, url, trace_id, messages, headers=None):
    """Helper function to post messages to a trace."""
    return await context.request.post(
        f"{url}/api/v1/trace/{trace_id}/messages",
        data={"messages": messages},
        headers=headers or {},
    )


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


async def test_append_messages_incorrect_type(url, context):
    """Test that appending messages with incorrect types fails."""
    invalid_inputs = [
        {"messages": "not a list"},
        {"messages": []},
        {"messages": ["1"]},
    ]

    for data in invalid_inputs:
        response = await context.request.post(
            f"{url}/api/v1/trace/{str(uuid.uuid4())}/messages",
            data=data,
        )
        assert response.status == 400


async def test_append_messages_fails_on_non_existing_trace(url, context):
    """Test that appending messages to a non-existing trace fails."""
    response = await append_messages(
        context, url, str(uuid.uuid4()), MESSAGES_WITHOUT_TOOL_CALLS
    )
    assert response.status == 404


async def test_append_messages_fails_when_caller_is_not_owner(url, context, data_abc):
    """Test that appending messages to a trace fails when the caller is not the owner."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        traces = await get_traces_for_dataset(context, url, dataset["id"])
        trace_id = traces[0]["id"]

        # Test for unauthorized user
        response = await append_messages(
            context,
            url,
            trace_id,
            MESSAGES_WITHOUT_TOOL_CALLS,
            headers={"referer": "noauth=user1"},
        )
        assert response.status == 404

        # Make dataset public and retry
        await context.request.put(
            f"{url}/api/v1/dataset/byid/{dataset['id']}", data={"content": True}
        )
        response = await append_messages(
            context,
            url,
            trace_id,
            MESSAGES_WITHOUT_TOOL_CALLS,
            headers={"referer": "noauth=user1"},
        )
        assert response.status == 404


async def test_append_messages_succeeds_on_dataset_trace_with_consecutive_calls(
    url, context, data_abc
):
    """Test that consecutive calls to append_messages succeeds."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        traces = await get_traces_for_dataset(context, url, dataset["id"])
        trace_id = traces[0]["id"]

        # Validate initial messages
        initial_messages = await get_trace_messages(context, url, trace_id)
        assert len(initial_messages) == 2

        # Append first set of messages
        response = await append_messages(
            context, url, trace_id, MESSAGES_WITHOUT_TOOL_CALLS
        )
        assert response.status == 200

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
        response = await append_messages(
            context, url, trace_id, MESSAGES_WITH_TOOL_CALLS
        )
        assert response.status == 200

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


async def test_append_messages_timestamp_with_invalid_format_fails(
    url, context, data_abc
):
    """Test that appending messages with invalid timestamp format fails."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        traces = await get_traces_for_dataset(context, url, dataset["id"])
        trace_id = traces[0]["id"]

        # Append messages with invalid timestamp format
        for invalid_timestamp in [
            1737668759,
            "01-01-2021 00:00:00",
        ]:
            invalid_messages = [
                {
                    "role": "user",
                    "content": "test XYZ test",
                    "timestamp": invalid_timestamp,
                },
                {"role": "assistant", "content": "i like XYZ!"},
            ]
            response = await append_messages(context, url, trace_id, invalid_messages)
            assert response.status == 400


async def test_append_messages_succeeds_on_dataset_trace_with_order_by_timestamp(
    context, url, data_abc
):
    """
    Test that consecutive calls to append_messages result in correct ordering by
    taking the timestamp field into account.
    It is possible that an append_messages call is made with messages that have
    older timestamps than the existing messages in the trace.
    In that case the new messages should be inserted before the existing messages.
    """
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        traces = await get_traces_for_dataset(context, url, dataset["id"])
        trace_id = traces[0]["id"]

        # Validate initial messages
        initial_messages = await get_trace_messages(context, url, trace_id)
        assert len(initial_messages) == 2

        # Append first set of messages
        response = await append_messages(
            context, url, trace_id, MESSAGES_WITHOUT_TOOL_CALLS
        )
        assert response.status == 200

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
        response = await append_messages(
            context, url, trace_id, MESSAGES_WITH_OLD_TIMESTAMP
        )
        assert response.status == 200

        # verify that the messages were appended
        updated_trace = await get_trace_messages(context, url, trace_id)
        assert len(updated_trace) == 6
        # the first two messages are the ones in MESSAGES_WITH_OLD_TIMESTAMP
        # since they have an older timestamp than all the other messages
        assert updated_trace[0:2] == MESSAGES_WITH_OLD_TIMESTAMP
        # the next two messages are initial_messages and the two messages
        # after that are MESSAGES_WITHOUT_TOOL_CALLS
        assert updated_trace[2:4] == initial_messages
        assert (
            "timestamp" in updated_trace[4]
            and "timestamp" in updated_trace[5]
            and updated_trace[4]["timestamp"] == updated_trace[5]["timestamp"]
        )
        del updated_trace[4]["timestamp"]
        del updated_trace[5]["timestamp"]
        assert updated_trace[4:] == MESSAGES_WITHOUT_TOOL_CALLS


async def test_append_messages_succeeds_on_snippet_trace(context, url):
    """Test that append_messages call succeeds for a trace snippet."""
    snippet_response = await context.request.post(
        f"{url}/api/v1/trace/snippets/new",
        data={"content": MESSAGES_WITHOUT_TOOL_CALLS},
    )
    assert snippet_response.status == 200
    snippet = await snippet_response.json()
    snippet_id = snippet["id"]

    # Append messages to the snippet
    response = await append_messages(context, url, snippet_id, MESSAGES_WITH_TOOL_CALLS)
    assert response.status == 200

    # Retrieve the snippet and validate the messages
    snippet_response = await context.request.get(f"{url}/api/v1/trace/{snippet_id}")
    snippet = await snippet_response.json()
    assert len(snippet["messages"]) == 4
    assert snippet["messages"][:2] == MESSAGES_WITHOUT_TOOL_CALLS
    del snippet["messages"][2]["timestamp"]
    del snippet["messages"][3]["timestamp"]
    assert snippet["messages"][2:] == MESSAGES_WITH_TOOL_CALLS

    # Delete the snippet
    deletion_response = await context.request.delete(f"{url}/api/v1/trace/{snippet_id}")
    assert deletion_response.status == 200


async def test_append_messages_succeeds_starting_with_empty_snippet_trace(context, url):
    """Test that append_messages call succeeds for a trace snippet which starts out empty."""
    # Create an empty snippet
    snippet_response = await context.request.post(
        f"{url}/api/v1/trace/snippets/new",
        data={"content": []},
    )
    assert snippet_response.status == 200
    snippet = await snippet_response.json()
    snippet_id = snippet["id"]

    # Append messages to the snippet
    # The resultant messages might not have the same order
    response = await append_messages(
        context, url, snippet_id, MESSAGES_WITHOUT_TOOL_CALLS
    )
    assert response.status == 200
    response = await append_messages(context, url, snippet_id, MESSAGES_WITH_TOOL_CALLS)
    assert response.status == 200

    # Retrieve the snippet and validate the messages
    snippet_response = await context.request.get(f"{url}/api/v1/trace/{snippet_id}")
    snippet = await snippet_response.json()
    assert len(snippet["messages"]) == 4
    for message in snippet["messages"]:
        assert "timestamp" in message
        del message["timestamp"]
    assert (
        DeepDiff(
            snippet["messages"],
            MESSAGES_WITHOUT_TOOL_CALLS + MESSAGES_WITH_TOOL_CALLS,
            ignore_order=True,
        )
        == {}
    )

    # Delete the snippet
    deletion_response = await context.request.delete(f"{url}/api/v1/trace/{snippet_id}")
    assert deletion_response.status == 200

#
async def test_add_and_get_simple_annotation(url, context, data_abc):
    """Test that adding and getting a simple annotation works."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        traces = await get_traces_for_dataset(context, url, dataset["id"])
        trace_id = traces[0]["id"]

        # get all annotations of a trace
        response = await context.request.get(f"{url}/api/v1/trace/{trace_id}/annotations")

        assert response.status == 200
        annotations = await response.json()
        assert len(annotations) == 0

        # add an annotation
        annotation = {
            "content": "test annotation",
            "address": "messages[0]:L0",
            "extra_metadata": {"source": "test"},
        }
        response = await context.request.post(
            f"{url}/api/v1/trace/{trace_id}/annotate", data=annotation
        )

        assert response.status == 200
        annotation = await response.json()
        assert annotation["content"] == "test annotation"
        assert annotation["address"] == "messages[0]:L0"
        assert annotation["extra_metadata"] == {"source": "test"}


async def test_add_annotation_without_source_then_with_then_replace_but_only_source(url, context, data_abc):
    """Test that adding an annotation without a source, then with a source, then replacing only the source works."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        traces = await get_traces_for_dataset(context, url, dataset["id"])
        trace_id = traces[0]["id"]

        # get all annotations of a trace
        response = await context.request.get(f"{url}/api/v1/trace/{trace_id}/annotations")
        assert response.status == 200
        annotations = await response.json()
        assert len(annotations) == 0

        # add an annotation without source
        annotation = {
            "content": "test annotation",
            "address": "messages[0]:L0",
            "extra_metadata": {},
        }
        response = await context.request.post(
            f"{url}/api/v1/trace/{trace_id}/annotate", data=annotation
        )
        assert response.status == 200

        # add an annotation with source
        annotation = {
            "content": "test annotation with source",
            "address": "messages[0]:L0",
            "extra_metadata": {"source": "test"},
        }
        response = await context.request.post(
            f"{url}/api/v1/trace/{trace_id}/annotate", data=annotation
        )
        assert response.status == 200

        # get all annotations of a trace
        response = await context.request.get(f"{url}/api/v1/trace/{trace_id}/annotations")
        assert response.status == 200
        annotations = await response.json()
        assert len(annotations) == 2

        # replace all annotations of a certain source
        response = await context.request.post(
            f"{url}/api/v1/trace/{trace_id}/annotations/update",
            data={"source": "test", "annotations": [{
                "content": "replaced annotation",
                "address": "messages[0]:L0",
                "extra_metadata": {"source": "test"},
            }]},
        )
        assert response.status == 200

        # get all annotations of a trace
        response = await context.request.get(f"{url}/api/v1/trace/{trace_id}/annotations")
        assert response.status == 200
        annotations = await response.json()
        assert len(annotations) == 2
        assert annotations[0]["content"] == "test annotation"
        assert annotations[1]["content"] == "replaced annotation"