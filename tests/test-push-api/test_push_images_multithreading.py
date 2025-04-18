import os
import sys

# add tests folder (parent) to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
import threading
from time import time

import pytest
import requests
from util import get_apikey

pytest_plugins = ("pytest_asyncio",)

NUM_PICTURE = 15
NUM_MESSAGE = 5


@pytest.fixture
def trace_with_image():
    with open(f"./data/trace_with_{NUM_PICTURE}_images.jsonl", "r") as f:
        data = f.read()
        return json.loads(data)


# helper function to get an API key
def get_apikey(url):
    response = requests.post(url + "/api/v1/keys/create")
    out = response.json()
    return out["key"]


def upload_traces(url, context, dataset_name, trace_with_image):
    # create empty dataset
    response = requests.post(
        url + "/api/v1/dataset/upload",
        files={"file": (f"{dataset_name}.json", b"", "application/json")},
        data={"name": dataset_name},
        timeout=5,
    )
    assert response.status_code == 200
    dataset_id = response.json()["id"]
    # get an API key
    key = get_apikey(url)
    headers = {"Authorization": "Bearer " + key}

    # add traces to the dataset, repeat NUM_MESSAGE times for each message
    traces = trace_with_image
    data = {
        "messages": [traces for _ in range(NUM_MESSAGE)],
        "annotations": None,
        "metadata": None,
        "dataset": dataset_name,
    }
    response = requests.post(
        url + "/api/v1/push/trace", json=data, headers=headers, timeout=5
    )
    assert response.status_code == 200

    response = requests.delete(
        url + f"/api/v1/dataset/byid/{dataset_id}", headers=headers, timeout=5
    )
    assert response.status_code == 200


async def test_upload_traces_multithread(url, context, dataset_name, trace_with_image):
    thread_list = []
    start_time = time()
    for i in range(10):
        t = threading.Thread(
            target=upload_traces,
            args=(url, context, dataset_name + "-" + str(i), trace_with_image),
        )
        t.start()
        thread_list.append(t)

    for i, n in enumerate(thread_list):
        n.join()
    finish_time = time()

    # send 10 requests with 5 traces with 15 images each cost about 10 seconds
    assert finish_time - start_time < 30
