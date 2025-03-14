import os

# add tests folder (parent) to sys.path
import sys

from playwright.async_api import expect

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import json

from util import TemporaryExplorerDataset, get_apikey

pytest_plugins = ("pytest_asyncio",)


async def test_create_apikey(url, context):
    key = await get_apikey(url, context)


async def test_upload_traces(url, context, dataset_name, data_webarena_with_metadata):
    # create empty dataset via UI-API
    response = await context.request.post(
        url + "/api/v1/dataset/upload",
        multipart={
            "file": {
                "name": dataset_name + ".json",
                "mimeType": "application/json",
                "buffer": b"",
            },
            "name": dataset_name,
        },
    )
    await expect(response).to_be_ok()
    returned_object = await response.json()
    assert returned_object["name"] == dataset_name

    # get an API key
    key = await get_apikey(url, context)
    headers = {"Authorization": "Bearer " + key}

    # add traces to the dataset via the push API (component under test here)
    traces = data_webarena_with_metadata.split("\n")[1:]
    traces = [json.loads(trace) for trace in traces]
    data = {
        "messages": traces,
        "annotations": None,
        "metadata": None,
        "dataset": dataset_name,
    }

    response = await context.request.post(
        url + "/api/v1/push/trace", data=data, headers=headers
    )
    await expect(response).to_be_ok()
    push_trace_response = await response.json()
    assert (
        isinstance(push_trace_response["id"], list)
        and len(push_trace_response["id"]) == 2
    )
    assert "dataset" in push_trace_response
    assert "username" in push_trace_response

    # delete dataset via UI-API
    response = await context.request.delete(
        url + "/api/v1/dataset/byid/" + returned_object["id"]
    )
    await expect(response).to_be_ok()


async def test_annotate_trace(url, context, data_abc):
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        id = dataset["id"]

        # get first trace in the dataet
        response = await context.request.get(url + f"/api/v1/dataset/byid/{id}/traces")
        trace_id = (await response.json())[0]["id"]

        # annotate trace
        response = await context.request.post(
            url + f"/api/v1/trace/{trace_id}/annotate",
            data={"content": "test annotation", "address": "messages[0].content:L0"},
        )

        # get annotations of a trace
        response = await context.request.get(
            url + f"/api/v1/trace/{trace_id}/annotations"
        )
        annotations = await response.json()

        assert len(annotations) == 1
        assert annotations[0]["content"] == "test annotation"
        assert annotations[0]["address"] == "messages[0].content:L0"


async def test_push_trace_with_invalid_dataset_name(context, url):
    """Tests that pushing trace with an invalid dataset name returns an error."""
    for invalid_character in "!@#$%^&*()+=':;<>,.?/\\|`~":
        dataset_name = f"some{invalid_character}name"
        response = await context.request.post(
            url + "/api/v1/push/trace",
            data={
                "messages": [
                    [
                        {"role": "user", "content": "one"},
                        {"role": "assistant", "content": "two \n three"},
                    ]
                ],
                "annotations": None,
                "metadata": None,
                "dataset": dataset_name,
            },
            headers={"Authorization": "Bearer " + await get_apikey(url, context)},
        )

        assert response.status == 400
        assert (
            "Dataset name can only contain A-Z, a-z, 0-9, - and _"
            in await response.text()
        )


async def test_push_trace_with_hierarchy_name(context, url, dataset_name):
    async with TemporaryExplorerDataset(url, context, "") as dataset:
        dataset_name = dataset["name"]

        # get an API key
        key = await get_apikey(url, context)
        headers = {"Authorization": "Bearer " + key}
        data = {
            "messages": [
                [{"role": "user", "content": "Hello Bananas"}],
                [{"role": "user", "content": "Hello Apples"}],
            ],
            "annotations": None,
            "metadata": [
                {"name": "bananas", "hierarchy_path": ["fruit", "yellow"]},
                {"name": "apple", "hierarchy_path": ["fruit", "green"]},
            ],
            "dataset": dataset_name,
        }

        response = await context.request.post(
            url + "/api/v1/push/trace", data=data, headers=headers
        )
        await expect(response).to_be_ok()


async def test_push_trace_with_image(context, url):
    """Tests that pushing a trace with an image works."""
    async with TemporaryExplorerDataset(url, context, "") as dataset:
        import base64
        import io

        from PIL import Image

        blue_img = Image.new("RGB", (100, 100), color="blue")
        blue_buffer = io.BytesIO()
        blue_img.save(blue_buffer, format="PNG")
        blue_base64 = base64.b64encode(blue_buffer.getvalue()).decode("utf-8")

        green_img = Image.new("RGB", (100, 100), color="green")
        green_buffer = io.BytesIO()
        green_img.save(green_buffer, format="PNG")
        green_base64 = base64.b64encode(green_buffer.getvalue()).decode("utf-8")

        trace = [
            {"role": "assistant", "content": "How can I help you?"},
            {"role": "user", "content": "I want a blue image"},
            {
                "role": "assistant",
                "content": "Here is a blue image",
                "tool_calls": [
                    {
                        "type": "function",
                        "function": {
                            "name": "generate_img",
                            "arguments": {"description": "blue"},
                        },
                    }
                ],
            },
            {"role": "tool", "content": f"local_base64_img: {blue_base64}"},
            {"role": "user", "content": "I want a green image"},
            {
                "role": "assistant",
                "content": "Here is a green image",
                "tool_calls": [
                    {
                        "type": "function",
                        "function": {
                            "name": "generate_img",
                            "arguments": {"description": "green"},
                        },
                    }
                ],
            },
            {"role": "tool", "content": f"local_base64_img: {green_base64}"},
        ]

        data = {"messages": [trace], "dataset": dataset["name"]}
        # get an API key and push the trace
        key = await get_apikey(url, context)
        headers = {"Authorization": "Bearer " + key}

        response = await context.request.post(
            url + "/api/v1/push/trace", data=data, headers=headers
        )
        await expect(response).to_be_ok()
        trace_id = (await response.json())["id"][0]

        # get the trace and check that the images are present
        response = await context.request.get(url + f"/api/v1/trace/{trace_id}")
        await expect(response).to_be_ok()
        trace = await response.json()
        assert len(trace["messages"]) == 7
        assert "local_img_link" in trace["messages"][3]["content"]
        assert "local_img_link" in trace["messages"][6]["content"]


async def test_push_trace_with_tool_call_arguments_parsed_successfully(
    context, url, data_with_json_parseable_tool_call_arguments
):
    """Tests that pushing a trace with tool call arguments that are parseable to JSON works."""
    async with TemporaryExplorerDataset(url, context, "") as dataset:
        data = {
            "messages": [json.loads(data_with_json_parseable_tool_call_arguments)],
            "annotations": None,
            "metadata": None,
            "dataset": dataset["name"],
        }

        key = await get_apikey(url, context)
        headers = {"Authorization": "Bearer " + key}
        response = await context.request.post(
            url + "/api/v1/push/trace", data=data, headers=headers
        )
        await expect(response).to_be_ok()
        trace_id = (await response.json())["id"][0]

        # get the trace and check that the tool_call arguments are parsed
        response = await context.request.get(url + f"/api/v1/trace/{trace_id}")
        await expect(response).to_be_ok()
        trace = await response.json()
        messages_with_tool_calls = [
            msg
            for msg in trace["messages"]
            if msg["role"] == "assistant" and msg.get("tool_calls")
        ]
        assert len(messages_with_tool_calls) == 1
        assert len(messages_with_tool_calls[0]["tool_calls"]) == 1
        assert messages_with_tool_calls[0]["tool_calls"][0]["function"][
            "arguments"
        ] == {"country_name": "France"}


async def test_push_trace_with_tool_call_arguments_not_parsed_successfully(
    context, url, data_with_non_json_parseable_tool_call_arguments
):
    """Tests that pushing a trace with tool call arguments that are not parseable to JSON works."""
    async with TemporaryExplorerDataset(url, context, "") as dataset:
        data = {
            "messages": [json.loads(data_with_non_json_parseable_tool_call_arguments)],
            "annotations": None,
            "metadata": None,
            "dataset": dataset["name"],
        }

        key = await get_apikey(url, context)
        headers = {"Authorization": "Bearer " + key}
        response = await context.request.post(
            url + "/api/v1/push/trace", data=data, headers=headers
        )
        await expect(response).to_be_ok()
        trace_id = (await response.json())["id"][0]

        # get the trace and check that the tool_call arguments are parsed
        response = await context.request.get(url + f"/api/v1/trace/{trace_id}")
        await expect(response).to_be_ok()
        trace = await response.json()
        messages_with_tool_calls = [
            msg
            for msg in trace["messages"]
            if msg["role"] == "assistant" and msg.get("tool_calls")
        ]
        assert len(messages_with_tool_calls) == 1
        assert len(messages_with_tool_calls[0]["tool_calls"]) == 1
        assert (
            messages_with_tool_calls[0]["tool_calls"][0]["function"]["arguments"]
            == '["fiction", "mystery"], ["Agatha Christie", "Dan Brown"]'
        )
