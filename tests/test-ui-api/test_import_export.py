import json
import os

# add tests folder (parent) to sys.path
import sys

import pytest
from playwright.async_api import expect

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import util
from util import *  # needed for pytest fixtures

pytest_plugins = ("pytest_asyncio",)


def read_dataset_upload_file(file_name):
    """Reads the content of a dataset upload file and returns it."""
    with open(f"./data/{file_name}", "r", encoding="utf-8") as f:
        return f.read()


async def upload_dataset_file(
    context, url: str, dataset_name: str, file_content: bytes
):
    """Uploads a dataset file to the server."""
    return await context.request.post(
        url + "/api/v1/dataset/upload",
        multipart={
            "file": {
                "name": dataset_name + ".json",
                "mimeType": "application/octet-stream",
                "buffer": file_content,
            },
            "name": dataset_name,
        },
    )


@pytest.mark.parametrize("delete_by", ["id", "user"])
async def test_upload_and_delete_dataset(dataset_name, url, context, delete_by):
    # create empty dataset via UI-API
    response = await upload_dataset_file(context, url, dataset_name, b"")

    await expect(response).to_be_ok()
    returned_object = await response.json()
    assert returned_object["name"] == dataset_name

    # list datasets via UI-API and check
    # if the created dataset is in the list
    response = await context.request.get(url + "/api/v1/dataset/list?kind=any")
    await expect(response).to_be_ok()
    datasets = await response.json()
    datasets = list(
        filter(lambda dataset: dataset["id"] == returned_object["id"], datasets)
    )
    assert len(datasets) == 1, "Dataset not found in list"
    dataset = datasets[0]
    assert dataset["name"] == dataset_name

    # delete dataset via UI-API
    if delete_by == "id":
        response = await context.request.delete(
            url + "/api/v1/dataset/byid/" + returned_object["id"]
        )
    elif delete_by == "user":
        response = await context.request.delete(
            url
            + "/api/v1/dataset/byuser/"
            + dataset["user"]["username"]
            + "/"
            + dataset["name"]
        )
    else:
        raise ValueError("Invalid delete_by value")
    await expect(response).to_be_ok()

    # check if dataset is deleted
    response = await context.request.get(url + "/api/v1/dataset/list?kind=any")
    await expect(response).to_be_ok()
    datasets = await response.json()
    datasets = list(
        filter(lambda dataset: dataset["id"] == returned_object["id"], datasets)
    )
    assert len(datasets) == 0, "Dataset not deleted"


async def test_upload_data(dataset_name, url, context, data_webarena_with_metadata):
    response = await upload_dataset_file(
        context, url, dataset_name, data_webarena_with_metadata.encode("utf-8")
    )
    await expect(response).to_be_ok()
    returned_object = await response.json()
    assert returned_object["name"] == dataset_name
    await util.async_delete_dataset_by_id(url, context, returned_object["id"])


async def test_reupload_dataset_with_same_name_fails(
    dataset_name, url, context, data_abc
):
    """Tests that uploading a dataset with the same name as an existing dataset fails."""
    response = await upload_dataset_file(
        context, url, dataset_name, data_abc.encode("utf-8")
    )
    await expect(response).to_be_ok()
    returned_object = await response.json()
    assert returned_object["name"] == dataset_name

    # Create another dataset with the same name.
    response = await upload_dataset_file(
        context, url, dataset_name, data_abc.encode("utf-8")
    )
    # This should result in an error.
    assert response.status == 400
    assert "Dataset with the same name already exists" in await response.text()

    await util.async_delete_dataset_by_id(url, context, returned_object["id"])


async def test_upload_dataset_with_two_metadata_rows_fails(context, url, dataset_name):
    """Tests that uploading a dataset with two metadata rows fails."""
    file_content = read_dataset_upload_file("two_metadata_rows.jsonl")
    response = await upload_dataset_file(
        context, url, dataset_name, file_content.encode("utf-8")
    )

    assert response.status == 400
    assert "metadata row can appear at most once in the file" in await response.text()


async def test_upload_dataset_metadata_not_in_first_row_fails(
    context, url, dataset_name
):
    """Tests that uploading a dataset with with metadata not in the first row fails."""
    file_content = read_dataset_upload_file("metadata_not_in_first_row.jsonl")
    response = await upload_dataset_file(
        context, url, dataset_name, file_content.encode("utf-8")
    )

    assert response.status == 400
    assert "metadata row must be the first row in the file" in await response.text()


async def test_upload_dataset_with_duplicate_index_fails(context, url, dataset_name):
    """Tests that uploading a dataset with duplicate indices fails."""
    file_content = read_dataset_upload_file("duplicate_index.jsonl")
    response = await upload_dataset_file(
        context, url, dataset_name, file_content.encode("utf-8")
    )

    assert response.status == 400
    assert "Duplicate index found" in await response.text()


async def test_upload_dataset_with_inconsistent_index_presence_fails(
    context, url, dataset_name
):
    """Tests that uploading a dataset with inconsistent index presence fails."""
    file_content = read_dataset_upload_file("inconsistent_index_presence.jsonl")
    response = await upload_dataset_file(
        context, url, dataset_name, file_content.encode("utf-8")
    )

    assert response.status == 400
    assert (
        "'index' key is inconsistently present — found in some events"
        in await response.text()
    )


async def test_upload_dataset_with_mixed_formats_fails(context, url, dataset_name):
    """
    Tests that uploading a dataset with mixed formats (both raw event lists
    and annotated event lists) fails.
    """
    file_content = read_dataset_upload_file("mixed_format.jsonl")
    response = await upload_dataset_file(
        context, url, dataset_name, file_content.encode("utf-8")
    )

    assert response.status == 400
    assert (
        "file cannot contain both raw event lists and annotated event lists"
        in await response.text()
    )


async def test_upload_dataset_with_incorrect_index_type_fails(
    context, url, dataset_name
):
    """Tests that uploading a dataset with incorrect index type fails."""
    file_content = read_dataset_upload_file("incorrect_index_type.jsonl")
    response = await upload_dataset_file(
        context, url, dataset_name, file_content.encode("utf-8")
    )

    assert response.status == 400
    assert "Index must be an integer" in await response.text()


async def test_upload_dataset_with_incorrect_annotations_structure_fails(
    context, url, dataset_name
):
    """Tests that uploading a dataset with incorrect annotations structure fails."""
    file_content = read_dataset_upload_file("trace_with_incorrect_annotation.jsonl")
    response = await upload_dataset_file(
        context, url, dataset_name, file_content.encode("utf-8")
    )

    assert response.status == 400
    assert "Failed to parse annotation" in await response.text()


async def test_upload_dataset_where_correct_indices_are_present(
    context, url, dataset_name
):
    """Tests that uploading a dataset where indices are present succeeds."""
    file_content = read_dataset_upload_file("correct_indices_present.jsonl")
    response = await upload_dataset_file(
        context, url, dataset_name, file_content.encode("utf-8")
    )

    await expect(response).to_be_ok()
    dataset_created = await response.json()
    assert dataset_created["name"] == dataset_name

    # Verify the traces.
    response = await context.request.get(
        url + f'/api/v1/dataset/byid/{dataset_created["id"]}/traces'
    )
    await expect(response).to_be_ok()
    traces_created = await response.json()

    assert len(traces_created) == 2
    trace_1 = next((trace for trace in traces_created if trace["index"] == 5), None)
    trace_2 = next((trace for trace in traces_created if trace["index"] == 812), None)
    assert trace_1 is not None
    assert trace_2 is not None

    # Verify trace attributes.
    assert trace_1["name"] == "Run 5"
    assert trace_2["name"] == "Run 812"
    assert trace_1["extra_metadata"]["success"] is True
    assert trace_2["extra_metadata"]["success"] is False
    assert trace_1["extra_metadata"]["task_id"] == 5
    assert trace_2["extra_metadata"]["task_id"] == 812

    # Delete the dataset.
    await util.async_delete_dataset_by_id(url, context, dataset_created["id"])


async def test_reupload_api(url, context, dataset_name, data_webarena_with_metadata):
    async with util.TemporaryExplorerDataset(
        url, context, data_webarena_with_metadata
    ) as dataset:
        dataset_id = dataset["id"]

        # download the dataset
        response = await context.request.get(
            url + f"/api/v1/dataset/byid/{dataset_id}/download"
        )
        jsonl_data = await response.text()
        downloaded_dataset = [
            json.loads(line) for line in jsonl_data.split("\n") if line
        ]

        async with util.TemporaryExplorerDataset(
            url, context, "\n".join(jsonl_data.split("\n"))
        ) as dataset:
            pass


async def test_snippet(url, context):
    messages = [
        {"role": "user", "content": "Hello!"},
        {"role": "assistant", "content": "hello back to you"},
    ]
    response = await context.request.post(
        url + "/api/v1/trace/snippets/new",
        data={
            "content": messages,
            "extra_metadata": {},
        },
    )
    await expect(response).to_be_ok()
    response = await response.json()

    trace_get_response = await context.request.get(
        url + f"/api/v1/trace/{response['id']}"
    )
    await expect(trace_get_response).to_be_ok()
    trace_response = await trace_get_response.json()
    assert trace_response["messages"] == messages

    await util.async_delete_trace_by_id(url, context, response["id"])
