from playwright.async_api import expect
import asyncio # even if not used, required for pytest-asyncio
import pytest
import os
from uuid import uuid4
# add tests folder (parent) to sys.path
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import util
from util import * # needed for pytest fixtures

pytest_plugins = ('pytest_asyncio',)

@pytest.mark.parametrize("delete_by", ["id", "user"])
async def test_upload_and_delete_dataset(dataset_name, url, context, delete_by):
    # create empty dataset via UI-API
    response = await context.request.post(url + '/api/v1/dataset/upload',
                                    multipart={'file': {
                                        'name': dataset_name + '.json',
                                        'mimeType': 'application/octet-stream',
                                        'buffer': b''
                                        },
                                        'name': dataset_name})
    await expect(response).to_be_ok()
    returned_object = await response.json()
    assert returned_object['name'] == dataset_name
  
    # list datasets via UI-API and check
    # if the created dataset is in the list
    response = await context.request.get(url + '/api/v1/dataset/list')
    await expect(response).to_be_ok()
    datasets = await response.json()
    datasets = list(filter(lambda dataset: dataset['id'] == returned_object['id'], datasets))
    assert len(datasets) == 1, "Dataset not found in list"
    dataset = datasets[0]
    assert dataset['name'] == dataset_name

    # delete dataset via UI-API 
    if delete_by == "id":
        response = await context.request.delete(url + '/api/v1/dataset/byid/' + returned_object['id'])
    elif delete_by == "user":
        response = await context.request.delete(url + '/api/v1/dataset/byuser/' + dataset['user']['username'] + '/' + dataset['name'])
    else:
        raise ValueError("Invalid delete_by value")
    await expect(response).to_be_ok()
    
    # check if dataset is deleted
    response = await context.request.get(url + '/api/v1/dataset/list')
    await expect(response).to_be_ok()
    datasets = await response.json()
    datasets = list(filter(lambda dataset: dataset['id'] == returned_object['id'], datasets))
    assert len(datasets) == 0, "Dataset not deleted"

async def test_upload_data(dataset_name, url, context, data_webarena_with_metadata):
    response = await context.request.post(url + '/api/v1/dataset/upload',
                                    multipart={'file': {
                                        'name': dataset_name + '.json',
                                        'mimeType': 'application/octet-stream',
                                        'buffer': data_webarena_with_metadata.encode('utf-8')
                                        },
                                        'name': dataset_name})
    await expect(response).to_be_ok()
    returned_object = await response.json()
    assert returned_object['name'] == dataset_name
    await util.async_delete_dataset_by_id(url, context, returned_object['id']) 
       
async def test_reupload_api(url, context, dataset_name, data_webarena_with_metadata):
    
    async with util.TemporaryExplorerDataset(url, context, data_webarena_with_metadata) as dataset:
        dataset_id = dataset['id']
        
        # download the dataset
        response = await context.request.get(url + f'/api/v1/dataset/byid/{dataset_id}/download') 
        jsonl_data = await response.text()
        downloaded_dataset = [json.loads(line) for line in jsonl_data.split("\n") if line]

        async with util.TemporaryExplorerDataset(url, context, "\n".join(jsonl_data.split("\n"))) as dataset:
            pass
    
   
async def test_snippet(url, context):
    response = await context.request.post(url + '/api/v1/trace/snippets/new', data={"content": "test", "extra_metadata": dict()})
    await expect(response).to_be_ok()
    response = await response.json()
    meta = response.get('extra_metadata', dict())
    assert isinstance(meta, dict)
    assert len(meta) == 0
    await util.async_delete_trace_by_id(url, context, response['id']) 


    