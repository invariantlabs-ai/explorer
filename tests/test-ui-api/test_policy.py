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

SECRETS_POLICY = """
from invariant.detectors import secrets

raise PolicyViolation("found secrets", msg) if:
    (msg: Message)
    any(secrets(msg))
"""

COPYRIGHT_POLICY = """
from invariant.detectors import copyright

raise "found copyrighted code" if:
    (msg: Message)
    not empty(copyright(msg.content, threshold=0.75))
"""

EMAIL_POLICY = """
raise PolicyViolation("User's email address was leaked", call=call) if:
    (call: ToolCall)
    call is tool:search_web
    "@mail.com" in call.function.arguments.q
"""

INVALID_POLICY = """
random code here
"""

async def create_dataset(context, url, dataset_name):
    """Creates a dataset and returns it after the creation."""
    create_dataset_response = await context.request.post(f'{url}/api/v1/dataset/upload',
                                    multipart={'file': {
                                        'name': f'{dataset_name}.json',
                                        'mimeType': 'application/octet-stream',
                                        'buffer': b''
                                        },
                                        'name': dataset_name})
    await expect(create_dataset_response).to_be_ok()
    dataset = await create_dataset_response.json()
    return dataset


async def create_policy(context, url, dataset_id, policy_content):
    """Creates a policy and returns the dataset after the creation."""
    create_policy_response = await context.request.post(
        f'{url}/api/v1/dataset/{dataset_id}/policy',
        data={'policy': policy_content}
    )
    await expect(create_policy_response).to_be_ok()
    updated_dataset = await create_policy_response.json()
    return updated_dataset


async def test_create_policy(context, url, dataset_name):
    """Tests that creating policies is successful."""
    dataset = await create_dataset(context, url, dataset_name)

    # Create a policy for the dataset.
    dataset = await create_policy(context, url, dataset["id"], SECRETS_POLICY)

    # Verify that the policy is created.
    assert len(dataset["extra_metadata"]["policies"]) == 1
    assert dataset["extra_metadata"]["policies"][0]["content"] == SECRETS_POLICY

    # Create another policy for the dataset.
    dataset = await create_policy(context, url, dataset["id"], COPYRIGHT_POLICY)

    # Verify that the dataset now contains two policies.
    assert {p["content"] for p in dataset["extra_metadata"]["policies"]} == set(
        [COPYRIGHT_POLICY, SECRETS_POLICY]
    )

async def test_create_policy_for_non_existent_dataset_fails(context, url):
    """Tests that creating a policy for a non existent dataset results in a 404"""
    # Create a policy for a non existent dataset.
    create_policy_response = await context.request.post(
        f'{url}/api/v1/dataset/d64d8682-9c12-4e44-ad7c-9908eba6c301/policy',
        data={'policy': EMAIL_POLICY}
    )

    # This should result in an error.
    assert create_policy_response.status == 404


async def test_create_invalid_policy_fails(context, url, dataset_name):
    """Tests that creating an unparseable policy results in a 400."""
    dataset = await create_dataset(context, url, dataset_name)

    # Create an invalid policy for the dataset.
    create_policy_response = await context.request.post(
        f'{url}/api/v1/dataset/{dataset["id"]}/policy',
        data={'policy': INVALID_POLICY}
    )

    # This should result in an error.
    assert create_policy_response.status == 400


async def test_update_policy_successful(dataset_name, url, context):
    """Tests that updating an existing policy is successful."""
    dataset = await create_dataset(context, url, dataset_name)

    # Create two policies for the dataset.
    dataset = await create_policy(context, url, dataset["id"], SECRETS_POLICY)
    dataset = await create_policy(context, url, dataset["id"], COPYRIGHT_POLICY)
    assert {p["content"] for p in dataset["extra_metadata"]["policies"]} == set(
        [COPYRIGHT_POLICY, SECRETS_POLICY]
    )

    # Update a policy.
    policy_id = dataset["extra_metadata"]["policies"][0]["id"]
    update_policy_response = await context.request.put(
        f'{url}/api/v1/dataset/{dataset["id"]}/policy/{policy_id}',
        data={'policy': EMAIL_POLICY}
    )
    await expect(update_policy_response).to_be_ok()
    dataset = await update_policy_response.json()

    # Verify the update
    assert {p["content"] for p in dataset["extra_metadata"]["policies"]} == set(
        [COPYRIGHT_POLICY, EMAIL_POLICY]
    )


async def test_update_policy_for_non_existent_dataset_fails(context, url):
    """Tests that updating a policy for a non existent dataset results in a 404"""
    # Update a policy for a non existent dataset.
    update_policy_response = await context.request.put(
        f'{url}/api/v1/dataset/d64d8682-9c12-4e44-ad7c-9908eba6c301/policy/1234',
        data={'policy': EMAIL_POLICY}
    )

    # This should result in an error.
    assert update_policy_response.status == 404


async def test_update_policy_with_invalid_content_fails(dataset_name, url, context):
    """Tests that updating an existing policy with an unparseable policy results in a 400."""
    dataset = await create_dataset(context, url, dataset_name)

    # Create policy for the dataset.
    dataset = await create_policy(context, url, dataset["id"], SECRETS_POLICY)

    # Set the policy content as an invalid value.
    policy_id = dataset["extra_metadata"]["policies"][0]["id"]
    update_policy_response = await context.request.put(
        f'{url}/api/v1/dataset/{dataset["id"]}/policy/{policy_id}',
        data={'policy': INVALID_POLICY}
    )

    # This should result in an error.
    assert update_policy_response.status == 400


async def test_update_non_existent_policy_fails(dataset_name, url, context):
    """Tests that updating a non existent policy results in a 404."""
    dataset = await create_dataset(context, url, dataset_name)

    # Update a non-existent policy.
    update_policy_response = await context.request.put(
        f'{url}/api/v1/dataset/{dataset["id"]}/policy/1234',
        data={'policy': EMAIL_POLICY}
    )

    # This should result in an error.
    assert update_policy_response.status == 404


async def test_delete_policy_successful(dataset_name, url, context):
    """Tests that deleting policies is successful."""
    dataset = await create_dataset(context, url, dataset_name)

    # Create two policies for the dataset.
    dataset = await create_policy(context, url, dataset["id"], SECRETS_POLICY)
    dataset = await create_policy(context, url, dataset["id"], COPYRIGHT_POLICY)

    secret_policy_id = -1
    copyright_policy_id = -1
    for policy in dataset["extra_metadata"]["policies"]:
        if policy["content"] == SECRETS_POLICY:
            secret_policy_id = policy["id"]
        if policy["content"] == COPYRIGHT_POLICY:
            copyright_policy_id = policy["id"]
    assert secret_policy_id != -1 and copyright_policy_id != -1

    # Delete first policy.
    delete_policy_response = await context.request.delete(
        f'{url}/api/v1/dataset/{dataset["id"]}/policy/{secret_policy_id}'
    )
    await expect(delete_policy_response).to_be_ok()
    dataset = await delete_policy_response.json()

    # Verify the deletion
    assert len(dataset["extra_metadata"]["policies"]) == 1
    assert dataset["extra_metadata"]["policies"][0]["id"] == copyright_policy_id
    assert dataset["extra_metadata"]["policies"][0]["content"] == COPYRIGHT_POLICY

    # Delete second policy.
    delete_policy_response = await context.request.delete(
        f'{url}/api/v1/dataset/{dataset["id"]}/policy/{copyright_policy_id}'
    )
    await expect(delete_policy_response).to_be_ok()
    dataset = await delete_policy_response.json()

    # Verify the deletion
    assert len(dataset["extra_metadata"]["policies"]) == 0

async def test_delete_policy_for_non_existent_dataset_fails(context, url):
    """Tests that deleting a policy for a non existent dataset results in a 404"""
    # Delete a policy for a non existent dataset.
    delete_policy_response = await context.request.delete(
        f'{url}/api/v1/dataset/d64d8682-9c12-4e44-ad7c-9908eba6c301/policy/1234'
    )

    # This should result in an error.
    assert delete_policy_response.status == 404


async def test_delete_non_existent_policy_fails(dataset_name, url, context):
    """Tests that deleting a non existent policy results in a 404."""
    dataset = await create_dataset(context, url, dataset_name)

    # Delete a non-existent policy.
    delete_policy_response = await context.request.delete(
        f'{url}/api/v1/dataset/{dataset["id"]}/policy/1234'
    )

    # This should result in an error.
    assert delete_policy_response.status == 404
