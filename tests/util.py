"""This module contains helper functions for the tests."""

import inspect
import uuid

from playwright.async_api import expect


async def get_apikey(url, context):
    """Get an API key."""
    response = await context.request.post(url + "/api/v1/keys/create")
    await expect(response).to_be_ok()
    out = await response.json()
    return out["key"]


async def async_create_dataset_by_upload(url, context, name, data):
    """Create a dataset by file upload"""
    assert isinstance(data, str)  # we want a string not a dict/list (JSON)
    response = await context.request.post(
        url + "/api/v1/dataset/upload",
        multipart={
            "file": {
                "name": name + ".json",
                "mimeType": "application/octet-stream",
                "buffer": data.encode("utf-8"),
            },
            "name": name,
        },
    )
    await expect(response).to_be_ok()
    return await response.json()


async def async_delete_dataset_by_id(url, context, dataset_id):
    """Delete a dataset by ID."""
    response = await context.request.delete(url + "/api/v1/dataset/byid/" + dataset_id)
    await expect(response).to_be_ok()


async def async_delete_trace_by_id(url, context, trace_id):
    """Delete a trace by ID."""
    response = await context.request.delete(url + "/api/v1/trace/" + trace_id)
    await expect(response).to_be_ok()


def generate_dataset_name(test_name=None):
    """Generate a dataset_name from the test_name."""
    frame = inspect.currentframe()
    while test_name is None:
        try:
            frame = frame.f_back
            if frame is None:
                break
            fn = inspect.getframeinfo(frame).function
            if fn.startswith("test_"):
                test_name = fn
                break
        except:
            break
    if test_name is None:
        test_name = "test"

    # Avoid special characters in the dataset name which are not allowed.
    return f"{test_name}-{str(uuid.uuid4())}".replace("[", "-").replace("]", "-")


class TemporaryExplorerDataset:
    """A temporary dataset for testing."""

    def __init__(self, url, context, data):
        self.url = url
        self.context = context
        self.data = data
        self.dataset = None

    async def open(self):
        self.dataset = await async_create_dataset_by_upload(
            self.url, self.context, generate_dataset_name(), self.data
        )
        return self.dataset

    async def close(self):
        await async_delete_dataset_by_id(self.url, self.context, self.dataset["id"])

    async def __aenter__(self):
        return await self.open()

    async def __aexit__(self, exc_type, exc_value, traceback):
        return await self.close()
