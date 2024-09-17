import os
import pytest
import random
import requests

INVARIANT_API_KEY = os.environ['INVARIANT_API_KEY']

def get_random_dataset_name():
    return "test-analysis-" + "".join([str(random.randint(0, 9)) for _ in range(10)])


def get_temp_dataset_name(host):
    dataset_name = get_random_dataset_name()
    response = requests.get(host + "/api/v1/dataset/list", verify=False)
    dataset_names = [dataset["name"] for dataset in response.json()]
    while dataset_name in dataset_names:
        dataset_name = get_random_dataset_name()
    return dataset_name


@pytest.fixture
def host():
    if 'API_URL' in os.environ:
        return os.environ['API_URL']
    else:
        return "https://localhost"


@pytest.fixture
def temp_dataset(host):
    dataset_name = get_temp_dataset_name(host)
    response = requests.post(host + "/api/v1/dataset/create", json={"name": dataset_name}, verify=False)
    yield response.json()
    requests.delete(host + "/api/v1/dataset/byid/" + response.json()["id"], verify=False)

def test_analysis(host, temp_dataset):
    dataset_name, dataset_id = temp_dataset["name"], temp_dataset["id"]

    # Upload some test traces to the dataset
    traces = [
        [{"role": "user", "content": "test ABC test"}, {"role": "assistant", "content": "i like ABC!"}],
        [{"role": "user", "content": "what is your name?"}, {"role": "assistant", "content": "my name is ABC!"}],
    ]
    headers = {"Authorization": f"Bearer {INVARIANT_API_KEY}", "Content-Type": "application/json"}
    requests.post(
        host + "/api/v1/push/trace", 
        json={"messages": traces, "dataset": dataset_name}, 
        headers=headers, verify=False)

    # Now run the analysis
    policy_str = """
    raise PolicyViolation("found ABC") if:
        (msg: Message)
        "ABC" in msg.content
    """

    response = requests.post(
        host + "/api/v1/dataset/analyze/" + dataset_id, 
        json={"policy_str": policy_str}, 
        headers=headers, verify=False)
    
    total_errors = response.json()["total_errors"]
    assert total_errors == 3










