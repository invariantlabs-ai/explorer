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

async def test_apikey_needed(url, context):
    response = await context.request.post(url + '/api/v1/push/trace',
                                          data={})
    # expect 401, because no API key is provided
    assert response.status == 401

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
