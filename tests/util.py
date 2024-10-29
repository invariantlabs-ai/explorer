from playwright.async_api import async_playwright, expect
import pytest
import os
import sys
from datetime import datetime
from pathlib import Path
import inspect
from uuid import uuid4
import json

@pytest.fixture
def url():
    if "URL" in os.environ:
        return os.environ["URL"]
    else:
        return "https://127.0.0.0:443"

@pytest.fixture
def api_server_http_endpoint():
    if "API_SERVER_HTTP_ENDPOINT" in os.environ:
        return os.environ["API_SERVER_HTTP_ENDPOINT"]
    sys.exit("API_SERVER_HTTP_ENDPOINT is not set, exiting.")

@pytest.fixture
def name():
    return f"test-{str(uuid4())}"

@pytest.fixture
async def context(request):
    playwright = await async_playwright().start()
    # launch a chrome browser that ignores certificate errors
    browser = await playwright.firefox.launch(headless=True, slow_mo=250)
    context = await browser.new_context(ignore_https_errors=True)
    return context

@pytest.fixture(scope='function')
async def screenshot(request):
    # setup
    test_name = request.node.name
    folder = Path(f"screenshots/{test_name}_{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}")
    # create folder, if it does not exist
    folder.mkdir(parents=True, exist_ok=True)
    # provide the screenshot function
    async def _screenshot(page):
        try:
            previous_frame = inspect.currentframe().f_back
            lineno = inspect.getframeinfo(previous_frame).lineno
        except:
            lineno = 0
        screenshot_path = str(folder / f"line_{lineno}_{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.png")
        await page.screenshot(path=screenshot_path)
        return screenshot_path
    yield _screenshot
   
    # teardown after test 
    # if test failed, keep the screenshots, else we delete
    if not request.node.rep_call.failed:
        for file in folder.iterdir():
            file.unlink()
        folder.rmdir()

def _dataset_name(test_name=None):
    frame = inspect.currentframe()
    while test_name is None:
        try:
            frame = frame.f_back
            if frame is None:
                break
            fn = inspect.getframeinfo(frame).function
            if fn.startswith('test_'):
                test_name = fn
                break
        except:
            break
    if test_name is None:
        test_name = "test"

    return f"{test_name}-{str(uuid4())}"

@pytest.fixture(scope='function')
def dataset_name(request):
    test_name = request.node.name
    return _dataset_name(test_name)

####################
# data fixtures    #
####################

@pytest.fixture
def data_webarena_with_metadata():
    with open('./data/webarena.jsonl', 'r') as f:
        return f.read()
    
@pytest.fixture
def data_abc():
    with open('./data/abc.jsonl', 'r') as f:
        return f.read()

@pytest.fixture
def data_code():
    with open('./data/code.jsonl', 'r') as f:
        return f.read()
    

####################
# helper functions #
####################

async def async_create_dataset_by_id(url, context, name, data):
    assert type(data) == str # we want a string not a dict/list (JSON)
    response = await context.request.post(url + '/api/v1/dataset/upload',
                                    multipart={'file': {
                                        'name': name + '.json',
                                        'mimeType': 'application/octet-stream',
                                        'buffer': data.encode('utf-8')
                                        },
                                        'name': name})
    await expect(response).to_be_ok()
    return await response.json()
 
async def async_delete_dataset_by_id(url, context, dataset_id):
    response = await context.request.delete(url + '/api/v1/dataset/byid/' + dataset_id)
    await expect(response).to_be_ok()
 
async def async_delete_trace_by_id(url, context, trace_id):
    response = await context.request.delete(url + '/api/v1/trace/' + trace_id)
    await expect(response).to_be_ok()

class TemporaryExplorerDataset:
    
    def __init__(self, url, context, data):
        self.url = url
        self.context = context
        self.data = data
        self.dataset = None
        
    async def open(self):
        self.dataset = await async_create_dataset_by_id(self.url, self.context, _dataset_name(), self.data)
        return self.dataset
    
    async def close(self):
        await async_delete_dataset_by_id(self.url, self.context, self.dataset['id']) 
  
    async def __aenter__(self):
        return await self.open()
    
    async def __aexit__(self, exc_type, exc_value, traceback):
        return await self.close()
