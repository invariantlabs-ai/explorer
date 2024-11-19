from playwright.async_api import expect
import asyncio # even if not used, required for pytest-asyncio
import pytest
import os
# add tests folder (parent) to sys.path
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import tempfile 
from pytest_lazy_fixtures import lf
import json
from util import * # needed for pytest fixtures

pytest_plugins = ('pytest_asyncio',)

# helper function to get an API key
async def get_apikey(url, context):
    response = await context.request.post(url + '/api/v1/keys/create')
    await expect(response).to_be_ok()
    out = await response.json()
    return out['key']

async def test_create_apikey(url, context):
    key = await get_apikey(url, context)

async def test_upload_traces(url, context, dataset_name, data_webarena_with_metadata):
    # create empty dataset via UI-API
    response = await context.request.post(url + '/api/v1/dataset/upload',
                                    multipart={'file': {
                                        'name': dataset_name + '.json',
                                        'mimeType': 'application/json',
                                        'buffer': b''
                                        },
                                        'name': dataset_name})
    await expect(response).to_be_ok()
    returned_object = await response.json()
    assert returned_object['name'] == dataset_name
    
    # get an API key
    key = await get_apikey(url, context)
    headers = {"Authorization": "Bearer " + key}

    # add traces to the dataset via the push API (component under test here)
    traces = data_webarena_with_metadata.split("\n")[1:]
    traces = [json.loads(trace) for trace in traces]
    data = {"messages": traces,
             "annotations": None,
             "metadata": None,
             "dataset": dataset_name}

    response = await context.request.post(url + '/api/v1/push/trace',
                                          data=data,
                                          headers=headers)
    await expect(response).to_be_ok()
    push_trace_response = await response.json()
    assert isinstance(push_trace_response['id'], list) and len(push_trace_response['id']) == 2
    assert 'dataset' in push_trace_response
    assert 'username' in push_trace_response
 
    # delete dataset via UI-API 
    response = await context.request.delete(url + '/api/v1/dataset/byid/' + returned_object['id'])
    await expect(response).to_be_ok()


async def test_annotate_trace(url, context, data_abc):
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        id = dataset["id"]

        # get first trace in the dataet
        response = await context.request.get(url + f'/api/v1/dataset/byid/{id}/traces')
        trace_id = (await response.json())[0]["id"]

        # annotate trace
        response = await context.request.post(url + f'/api/v1/trace/{trace_id}/annotate',
                                             data={"content": "test annotation", "address": "messages[0].content:L0"})

        # get annotations of a trace
        response = await context.request.get(url + f'/api/v1/trace/{trace_id}/annotations')
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
        )

        assert response.status == 400
        assert "Dataset name can only contain A-Z, a-z, 0-9, - and _" in await response.text()

async def test_push_trace_with_hierarchy_name(context, url, dataset_name):
    async with TemporaryExplorerDataset(url, context, '') as dataset:
        dataset_name = dataset["name"]

        # get an API key
        key = await get_apikey(url, context)
        headers = {"Authorization": "Bearer " + key}
        data = {"messages": [[{"role": "user", "content": "Hello Bananas"}],
                             [{"role": "user", "content": "Hello Apples"}]],
                 "annotations": None,
                 "metadata": [{'name': 'bananas', 'hierarchy_path': ['fruit', 'yellow']},
                              {'name': 'apple', 'hierarchy_path': ['fruit', 'green']}],
                 "dataset": dataset_name}

        response = await context.request.post(url + '/api/v1/push/trace',
                                              data=data,
                                              headers=headers)
        await expect(response).to_be_ok()