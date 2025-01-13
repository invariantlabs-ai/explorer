import os

# add tests folder (parent) to sys.path
import sys

import pytest
from playwright.async_api import expect

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import util
from util import *  # needed for pytest fixtures

pytest_plugins = ("pytest_asyncio",)

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


async def create_policy(context, url, dataset_id, policy_content, policy_name):
    """Creates a policy and returns the dataset after the creation."""
    create_policy_response = await context.request.post(
        f"{url}/api/v1/dataset/{dataset_id}/policy",
        data={"policy": policy_content, "name": policy_name},
    )
    await expect(create_policy_response).to_be_ok()
    updated_dataset = await create_policy_response.json()
    return updated_dataset


async def update_dataset(context, url, dataset_id, is_dataset_public=True):
    """Updates the content of the dataset."""
    update_dataset_response = await context.request.put(
        f"{url}/api/v1/dataset/byid/{dataset_id}",
        data={"content": is_dataset_public},
    )
    await expect(update_dataset_response).to_be_ok()
    return await update_dataset_response.json()


@pytest.mark.parametrize("is_dataset_public", [True, False])
async def test_create_policy(context, url, data_abc, is_dataset_public):
    """Tests that creating policies is successful."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        if is_dataset_public:
            # Make the dataset public.
            await update_dataset(context, url, dataset["id"], is_dataset_public=True)

        # Create a policy for the dataset.
        dataset = await create_policy(
            context, url, dataset["id"], SECRETS_POLICY, "test-policy-1"
        )

        # Verify that the policy is created.
        assert len(dataset["extra_metadata"]["policies"]) == 1
        assert dataset["extra_metadata"]["policies"][0]["content"] == SECRETS_POLICY
        assert dataset["extra_metadata"]["policies"][0]["name"] == "test-policy-1"
        assert dataset["extra_metadata"]["policies"][0]["last_updated_time"] is not None

        # Create another policy for the dataset.
        dataset = await create_policy(
            context, url, dataset["id"], COPYRIGHT_POLICY, "test-policy-2"
        )

        # Verify the presence of both policies with the specified content and names.
        policies = dataset["extra_metadata"]["policies"]
        policy_1 = next(
            (
                p
                for p in policies
                if p["content"] == SECRETS_POLICY and p["name"] == "test-policy-1"
            ),
            None,
        )
        policy_2 = next(
            (
                p
                for p in policies
                if p["content"] == COPYRIGHT_POLICY and p["name"] == "test-policy-2"
            ),
            None,
        )
        assert policy_1 is not None
        assert policy_2 is not None


async def test_create_policy_for_non_existent_dataset_fails(context, url):
    """Tests that creating a policy for a non existent dataset results in a 404"""
    # Create a policy for a non existent dataset.
    create_policy_response = await context.request.post(
        f"{url}/api/v1/dataset/d64d8682-9c12-4e44-ad7c-9908eba6c301/policy",
        data={"policy": EMAIL_POLICY, "name": "test-policy"},
    )

    # This should result in an error.
    assert create_policy_response.status == 404


async def test_create_policy_without_required_fields_fails(context, url, data_abc):
    """Tests that creating a policy without the necessary fields results in a 400."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Create a policy without a name.
        create_policy_response_1 = await context.request.post(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy',
            data={"policy": EMAIL_POLICY},
        )
        assert create_policy_response_1.status == 400

        # Create a policy without policy content.
        create_policy_response_2 = await context.request.post(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy', data={"name": "test-policy"}
        )
        assert create_policy_response_2.status == 400

        # Create a policy with an empty name.
        create_policy_response_3 = await context.request.post(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy',
            data={"policy": EMAIL_POLICY, "name": ""},
        )
        assert create_policy_response_3.status == 400

        # Create a policy with an empty policy content.
        create_policy_response_4 = await context.request.post(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy',
            data={"policy": "", "name": "test-policy"},
        )
        assert create_policy_response_4.status == 400

        # Create a policy with an empty payload.
        create_policy_response_5 = await context.request.post(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy', data={}
        )
        assert create_policy_response_5.status == 400


async def test_create_policy_for_dataset_not_owned_by_caller_fails(
    context, url, data_abc
):
    """Tests that creating a policy not owned by the current user results in an error."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # A different user tries to create a policy for the dataset.
        create_policy_response_1 = await context.request.post(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy',
            data={"policy": EMAIL_POLICY, "name": "test-policy"},
            headers={"referer": "noauth=user1"},
        )
        assert create_policy_response_1.status == 401

        # Update the dataset to make it public.
        await update_dataset(context, url, dataset["id"], is_dataset_public=True)

        # A different user tries to create a policy for the dataset.
        create_policy_response_2 = await context.request.post(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy',
            data={"policy": EMAIL_POLICY, "name": "test-policy"},
            headers={"referer": "noauth=user1"},
        )
        assert create_policy_response_2.status == 403


@pytest.mark.parametrize("is_dataset_public", [True, False])
async def test_update_policy_fields_successful(
    data_abc, url, context, is_dataset_public
):
    """Tests that updating an existing policy is successful."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        if is_dataset_public:
            # Make the dataset public.
            await update_dataset(context, url, dataset["id"], is_dataset_public=True)

        # Create three policies for the dataset.
        dataset = await create_policy(
            context, url, dataset["id"], SECRETS_POLICY, "test-policy-1"
        )
        dataset = await create_policy(
            context, url, dataset["id"], COPYRIGHT_POLICY, "test-policy-2"
        )
        dataset = await create_policy(
            context, url, dataset["id"], EMAIL_POLICY, "test-policy-3"
        )
        policy_1 = next(
            (
                p
                for p in dataset["extra_metadata"]["policies"]
                if p["content"] == SECRETS_POLICY and p["name"] == "test-policy-1"
            ),
            None,
        )
        policy_2 = next(
            (
                p
                for p in dataset["extra_metadata"]["policies"]
                if p["content"] == COPYRIGHT_POLICY and p["name"] == "test-policy-2"
            ),
            None,
        )
        policy_3 = next(
            (
                p
                for p in dataset["extra_metadata"]["policies"]
                if p["content"] == EMAIL_POLICY and p["name"] == "test-policy-3"
            ),
            None,
        )
        policy_id_1 = policy_1["id"]
        policy_id_2 = policy_2["id"]
        policy_id_3 = policy_3["id"]

        # Update both the policy content and name for policy_1.
        update_policy_response = await context.request.put(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy/{policy_id_1}',
            data={"policy": EMAIL_POLICY, "name": "new-test-policy-1"},
        )
        await expect(update_policy_response).to_be_ok()

        # Update only the policy content for policy_2.
        update_policy_response = await context.request.put(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy/{policy_id_2}',
            data={"policy": SECRETS_POLICY},
        )
        await expect(update_policy_response).to_be_ok()

        # Update only the policy name for policy_3.
        update_policy_response = await context.request.put(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy/{policy_id_3}',
            data={"name": "new-test-policy-3"},
        )
        await expect(update_policy_response).to_be_ok()
        dataset = await update_policy_response.json()

        # Verify the updates
        assert len(dataset["extra_metadata"]["policies"]) == 3
        updated_policy_1 = next(
            (
                p
                for p in dataset["extra_metadata"]["policies"]
                if p["id"] == policy_id_1
                and p["content"] == EMAIL_POLICY
                and p["name"] == "new-test-policy-1"
            ),
            None,
        )
        updated_policy_2 = next(
            (
                p
                for p in dataset["extra_metadata"]["policies"]
                if p["id"] == policy_id_2
                and p["content"] == SECRETS_POLICY
                and p["name"] == "test-policy-2"
            ),
            None,
        )
        updated_policy_3 = next(
            (
                p
                for p in dataset["extra_metadata"]["policies"]
                if p["id"] == policy_id_3
                and p["content"] == EMAIL_POLICY
                and p["name"] == "new-test-policy-3"
            ),
            None,
        )
        assert updated_policy_1 is not None
        assert updated_policy_2 is not None
        assert updated_policy_3 is not None


async def test_update_policy_for_non_existent_dataset_fails(context, url):
    """Tests that updating a policy for a non existent dataset results in a 404"""
    # Update a policy for a non existent dataset.
    update_policy_response = await context.request.put(
        f"{url}/api/v1/dataset/d64d8682-9c12-4e44-ad7c-9908eba6c301/policy/1234",
        data={"policy": EMAIL_POLICY},
    )

    # This should result in an error.
    assert update_policy_response.status == 404


async def test_update_policy_with_invalid_request_payload_fails(data_abc, url, context):
    """Tests that updating an existing policy with an invalid request payload results in a 400."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Create policy for the dataset.
        dataset = await create_policy(
            context, url, dataset["id"], SECRETS_POLICY, "test-policy"
        )
        policy_id = dataset["extra_metadata"]["policies"][0]["id"]

        # Update the policy without passing in name or content.
        update_policy_response_1 = await context.request.put(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy/{policy_id}', data={}
        )
        assert update_policy_response_1.status == 400

        # Update the policy with an empty name but a valid content.
        update_policy_response_2 = await context.request.put(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy/{policy_id}',
            data={"policy": SECRETS_POLICY, "name": ""},
        )
        assert update_policy_response_2.status == 400

        # Update the policy with a non empty name but an empty content.
        policy_id = dataset["extra_metadata"]["policies"][0]["id"]
        update_policy_response_3 = await context.request.put(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy/{policy_id}',
            data={"policy": "", "name": "another-name"},
        )
        assert update_policy_response_3.status == 400


async def test_update_non_existent_policy_fails(data_abc, url, context):
    """Tests that updating a non existent policy results in a 404."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Update a non-existent policy.
        update_policy_response = await context.request.put(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy/1234',
            data={"policy": EMAIL_POLICY, "name": "test-policy"},
        )

        # This should result in an error.
        assert update_policy_response.status == 404


async def test_update_policy_for_dataset_not_owned_by_caller_fails(
    context, url, data_abc
):
    """Tests that updating a policy not owned by the current user results in an error."""
    # Create a private dataset.
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Create policy for the dataset.
        dataset = await create_policy(
            context, url, dataset["id"], SECRETS_POLICY, "test-policy"
        )
        policy_id = dataset["extra_metadata"]["policies"][0]["id"]

        # A different user tries to update the policy.
        update_policy_response_1 = await context.request.put(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy/{policy_id}',
            headers={"referer": "noauth=user1"},
        )
        assert update_policy_response_1.status == 401

        # Update the dataset to make it public.
        await update_dataset(context, url, dataset["id"], is_dataset_public=True)

        # A different user tries to update the policy.
        update_policy_response_2 = await context.request.put(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy/{policy_id}',
            headers={"referer": "noauth=user1"},
        )
        assert update_policy_response_2.status == 403


@pytest.mark.parametrize("is_dataset_public", [True, False])
async def test_delete_policy_successful(data_abc, url, context, is_dataset_public):
    """Tests that deleting policies is successful."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        if is_dataset_public:
            # Make the dataset public.
            await update_dataset(context, url, dataset["id"], is_dataset_public=True)

        # Create two policies for the dataset.
        dataset = await create_policy(
            context, url, dataset["id"], SECRETS_POLICY, "test-policy-1"
        )
        dataset = await create_policy(
            context, url, dataset["id"], COPYRIGHT_POLICY, "test-policy-2"
        )

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
        f"{url}/api/v1/dataset/d64d8682-9c12-4e44-ad7c-9908eba6c301/policy/1234"
    )

    # This should result in an error.
    assert delete_policy_response.status == 404


async def test_delete_non_existent_policy_fails(data_abc, url, context):
    """Tests that deleting a non existent policy results in a 404."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Delete a non-existent policy.
        delete_policy_response = await context.request.delete(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy/1234'
        )

        # This should result in an error.
        assert delete_policy_response.status == 404


async def test_delete_policy_for_dataset_not_owned_by_caller_fails(
    context, url, data_abc
):
    """Tests that deleting a policy not owned by the current user results in an error."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Create policy for the dataset.
        dataset = await create_policy(
            context, url, dataset["id"], SECRETS_POLICY, "test-policy"
        )
        policy_id = dataset["extra_metadata"]["policies"][0]["id"]

        # A different user tries to delete the policy.
        delete_policy_response_1 = await context.request.delete(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy/{policy_id}',
            headers={"referer": "noauth=user1"},
        )
        assert delete_policy_response_1.status == 401

        # Update the dataset to make it public.
        await update_dataset(context, url, dataset["id"], is_dataset_public=True)

        # A different user tries to delete the policy.
        delete_policy_response_2 = await context.request.delete(
            f'{url}/api/v1/dataset/{dataset["id"]}/policy/{policy_id}',
            headers={"referer": "noauth=user1"},
        )
        assert delete_policy_response_2.status == 403


async def test_get_public_dataset_with_policies(data_abc, url, context):
    """Tests that fetching a public dataset includes policies only for the owner user."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Create policy for the dataset.
        dataset = await create_policy(
            context, url, dataset["id"], SECRETS_POLICY, "test-policy"
        )

        # Update the dataset to make it public.
        await update_dataset(context, url, dataset["id"], is_dataset_public=True)

        # Fetch the dataset as the owner.
        get_dataset_response_1 = await context.request.get(
            f'{url}/api/v1/dataset/byid/{dataset["id"]}'
        )
        await expect(get_dataset_response_1).to_be_ok()
        dataset_response_1 = await get_dataset_response_1.json()
        assert (
            "policies" in dataset_response_1["extra_metadata"]
            and len(dataset_response_1["extra_metadata"]["policies"]) == 1
            and dataset_response_1["extra_metadata"]["policies"][0]["content"]
            == SECRETS_POLICY
            and dataset_response_1["extra_metadata"]["policies"][0]["name"]
            == "test-policy"
        )

        # Fetch the dataset as another user.
        get_dataset_response_2 = await context.request.get(
            f'{url}/api/v1/dataset/byid/{dataset["id"]}',
            headers={"referer": "noauth=user1"},
        )
        await expect(get_dataset_response_2).to_be_ok()
        dataset_response_2 = await get_dataset_response_2.json()
        assert "policies" not in dataset_response_2["extra_metadata"]
