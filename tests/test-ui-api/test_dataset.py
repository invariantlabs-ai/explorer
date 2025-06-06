"""Tests for dataset API endpoints."""

import json
import os

# add tests folder (parent) to sys.path
import sys
import uuid

import pytest
from playwright.async_api import expect

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from util import TemporaryExplorerDataset

pytest_plugins = ("pytest_asyncio",)

SECRETS_POLICY = """
from invariant.detectors import secrets

raise PolicyViolation("found secrets", msg) if:
    (msg: Message)
    any(secrets(msg))
"""


async def update_dataset(context, url, dataset_id, is_dataset_public=True):
    """Updates the content of the dataset."""
    update_dataset_response = await context.request.put(
        f"{url}/api/v1/dataset/byid/{dataset_id}",
        data={"content": is_dataset_public},
    )
    await expect(update_dataset_response).to_be_ok()
    return await update_dataset_response.json()


async def create_policy(context, url, dataset_id, policy_content, policy_name):
    """Creates a policy for the dataset."""
    create_policy_response = await context.request.post(
        f"{url}/api/v1/dataset/{dataset_id}/policy",
        data={"policy": policy_content, "name": policy_name},
    )
    await expect(create_policy_response).to_be_ok()


async def get_metadata(context, url, dataset_name, headers=None):
    """Gets the metadata of the dataset."""
    get_metadata_response = await context.request.get(
        f"{url}/api/v1/dataset/metadata/{dataset_name}",
        headers=headers if headers else {},
    )
    await expect(get_metadata_response).to_be_ok()
    return await get_metadata_response.json()


async def update_metadata(context, url, dataset_name, data):
    """Updates the metadata of the dataset."""
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/{dataset_name}",
        data=data,
    )
    await expect(update_metadata_response).to_be_ok()
    return await update_metadata_response.json()


async def test_recreate_dataset_with_same_name_fails(context, url, data_abc):
    """Tests that creating a dataset with the same name as an existing dataset fails."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Create another dataset with the same name.
        response = await context.request.post(
            f"{url}/api/v1/dataset/create", data={"name": dataset["name"]}
        )

        # This should result in an error.
        assert response.status == 400
        assert "Dataset with the same name already exists" in await response.text()


async def test_get_own_metadata(context, url, data_abc):
    """Tests that getting metadata of a dataset works (both public and private)."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # The dataset is private.
        # Add some policy for the dataset.
        await create_policy(context, url, dataset["id"], SECRETS_POLICY, "test_policy")

        # Get metadata for the dataset.
        metadata = await get_metadata(context, url, dataset["name"])
        assert metadata == dataset.get("extra_metadata")
        assert "policies" not in metadata
        assert metadata == dataset["extra_metadata"]

        # Query the metadata with the owner_username parameter set to the dataset owner.
        get_metadata_response = await context.request.get(
            f"{url}/api/v1/dataset/metadata/{dataset['name']}?owner_username=developer",
        )
        assert get_metadata_response.status == 200
        metadata = await get_metadata_response.json()
        assert metadata == dataset.get("extra_metadata")

        # Make the dataset public.
        await update_dataset(context, url, dataset["id"], is_dataset_public=True)

        # Get metadata for the dataset.
        metadata = await get_metadata(context, url, dataset["name"])
        assert metadata == dataset.get("extra_metadata")
        assert "policies" not in metadata
        assert dataset["extra_metadata"] == metadata

        # Query the metadata with the owner_username parameter set to the dataset owner user_id.
        get_metadata_response = await context.request.get(
            f"{url}/api/v1/dataset/metadata/{dataset['name']}?owner_username=developer",
        )
        assert get_metadata_response.status == 200
        metadata = await get_metadata_response.json()
        assert metadata == dataset.get("extra_metadata")


async def test_get_metadata_for_non_existent_dataset_fails(context, url):
    """Tests that getting metadata of a non-existent dataset fails."""
    # Get metadata for a non-existent dataset for the caller user_id.
    get_metadata_response = await context.request.get(
        f"{url}/api/v1/dataset/metadata/some_dataset"
    )
    assert get_metadata_response.status == 404

    # Get metadata for a non-existent dataset for a user.
    get_metadata_response = await context.request.get(
        f"{url}/api/v1/dataset/metadata/some_dataset?owner_username=developer"
    )
    assert get_metadata_response.status == 404


async def test_get_metadata_created_by_different_user(context, url, data_abc):
    """Tests that getting metadata of a dataset created by a different user fails for private datasets."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Add some policy for the dataset.
        await create_policy(context, url, dataset["id"], SECRETS_POLICY, "test_policy")

        # A different user tries to get the metadata for the dataset when it is private.
        get_metadata_response = await context.request.get(
            f"{url}/api/v1/dataset/metadata/{dataset['name']}?owner_username=developer",
            headers={"referer": "noauth=user1"},
        )
        assert get_metadata_response.status == 403

        # If no owner_username is provided, the request should fail with 404 since the lookup is done by the caller user_id.
        get_metadata_response = await context.request.get(
            f"{url}/api/v1/dataset/metadata/{dataset['name']}",
            headers={"referer": "noauth=user1"},
        )
        assert get_metadata_response.status == 404

        # Make the dataset public.
        await update_dataset(context, url, dataset["id"], is_dataset_public=True)

        # A different user tries to get the metadata for the dataset when it is public.
        # The lookup is done by the owner_username for which a dataset with the same name exists and the dataset is public.
        get_metadata_response = await context.request.get(
            f"{url}/api/v1/dataset/metadata/{dataset['name']}?owner_username=developer",
            headers={"referer": "noauth=user1"},
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
        }
        # Succeeds because the dataset is public.
        metadata = await get_metadata_response.json()
        assert metadata == expected_metadata
        assert "policies" not in metadata

        # If no owner_username is provided and the caller is not the owner, the request should fail with 404.
        # The lookup is done by the caller user_id for which a dataset with the same name does not exist.
        get_metadata_response = await context.request.get(
            f"{url}/api/v1/dataset/metadata/{dataset['name']}",
            headers={"referer": "noauth=user1"},
        )
        assert get_metadata_response.status == 404


async def test_update_metadata_own_dataset(context, url, data_abc):
    """Tests that updating metadata of a dataset works (both public and private) when the caller is the owner."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Add some policy for the dataset.
        await create_policy(context, url, dataset["id"], SECRETS_POLICY, "test_policy")

        # Update metadata for the dataset.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={"metadata": {"benchmark": "random", "accuracy": 12.3, "name": "abc"}},
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random",
            "accuracy": 12.3,
            "name": "abc",
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata

        # Make the dataset public.
        await update_dataset(context, url, dataset["id"], is_dataset_public=True)

        # Update the metadata for the dataset again.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={"metadata": {"benchmark": "random2", "accuracy": 5, "name": "def"}},
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random2",
            "accuracy": 5,
            "name": "def",
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata


async def test_update_metadata_without_replace_all(context, url, data_abc):
    """Tests that updating metadata of a dataset works using replace_all set to False (Default)."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Add some policy for the dataset.
        await create_policy(context, url, dataset["id"], SECRETS_POLICY, "test_policy")

        # Update metadata for the dataset with replace_all set to False.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={
                "metadata": {"benchmark": "random", "accuracy": 12.3},
                "replace_all": False,
            },
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random",
            "accuracy": 12.3,
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata

        # Update only the accuracy without replace_all (defaults to False).
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={"metadata": {"accuracy": 5}},
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random",
            "accuracy": 5,
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata

        # Update only the benchmark with replace_all set to False.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={"metadata": {"benchmark": "benchmark2"}, "replace_all": False},
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "benchmark2",
            "accuracy": 5,
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata

        # Update only the name with replace_all set to False.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={"metadata": {"name": "abc"}, "replace_all": False},
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "benchmark2",
            "accuracy": 5,
            "name": "abc",
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata

        # Update only the invariant.test_results.num_tests with replace_all set to False.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={
                "metadata": {"invariant.test_results": {"num_tests": 5}},
                "replace_all": False,
            },
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "benchmark2",
            "accuracy": 5,
            "name": "abc",
            "invariant.test_results": {"num_tests": 5},
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata

        # Update only the invariant.test_results.num_passed with replace_all set to False.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={
                "metadata": {"invariant.test_results": {"num_passed": 3}},
                "replace_all": False,
            },
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "benchmark2",
            "accuracy": 5,
            "name": "abc",
            "invariant.test_results": {"num_passed": 3},
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata

        # Update only invariant.test_results with replace_all set to False.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={
                "metadata": {
                    "invariant.test_results": {
                        "num_tests": 9,
                        "num_passed": 6,
                    }
                },
                "replace_all": False,
            },
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "benchmark2",
            "accuracy": 5,
            "name": "abc",
            "invariant.test_results": {"num_tests": 9, "num_passed": 6},
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata

        # With only invalid keys in invariant.test_results, after filtering
        # invariant.test_results becomes {} and that fails validation.
        response = await context.request.put(
            f"{url}/api/v1/dataset/metadata/{dataset['name']}",
            data={
                "metadata": {
                    "invariant.test_results": {"ignored_key": "ignored_value"}
                },
                "replace_all": False,
            },
        )
        assert response.status == 400
        assert "invariant.test_results must not be empty if provided" in (
            await response.text()
        )


async def test_update_metadata_with_replace_all(context, url, data_abc):
    """Tests that updating metadata of a dataset works using replace_all."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Add some policy for the dataset.
        await create_policy(context, url, dataset["id"], SECRETS_POLICY, "test_policy")

        # Update metadata for the dataset with replace_all set to True.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={
                "metadata": {
                    "benchmark": "random",
                    "accuracy": 12.3,
                    "name": "abc",
                    "invariant.test_results": {
                        "num_tests": 5,
                        "num_passed": 3,
                        "ignored_key": "ignored_value",  # Ignored key.
                    },
                },
                "replace_all": True,
            },
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random",
            "accuracy": 12.3,
            "name": "abc",
            "invariant.test_results": {"num_tests": 5, "num_passed": 3},
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata

        # Update only the accuracy with replace_all set to True.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={"metadata": {"accuracy": 5}, "replace_all": True},
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "accuracy": 5,
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata
        assert "benchmark" not in metadata
        assert "name" not in metadata
        assert "invariant.test_results" not in metadata

        # Update only the benchmark with replace_all set to True.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={"metadata": {"benchmark": "benchmark2"}, "replace_all": True},
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "benchmark2",
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata
        assert "accuracy" not in metadata
        assert "name" not in metadata
        assert "invariant.test_results" not in metadata

        # Update only the name with replace_all set to True.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={"metadata": {"name": "xyz"}, "replace_all": True},
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "name": "xyz",
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata
        assert "benchmark" not in metadata
        assert "accuracy" not in metadata
        assert "invariant.test_results" not in metadata

        # Update only invariant.test_results.num_tests with replace_all set to True.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={
                "metadata": {"invariant.test_results": {"num_tests": 5}},
                "replace_all": True,
            },
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "invariant.test_results": {"num_tests": 5},
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata
        assert "benchmark" not in metadata
        assert "accuracy" not in metadata
        assert "name" not in metadata

        # Update only invariant.test_results.num_passed with replace_all set to True.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={
                "metadata": {"invariant.test_results": {"num_passed": 5}},
                "replace_all": True,
            },
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "invariant.test_results": {"num_passed": 5},
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata
        assert "benchmark" not in metadata
        assert "accuracy" not in metadata
        assert "name" not in metadata

        # With only invalid keys in invariant.test_results, after filtering
        # invariant.test_results becomes {} and that fails validation.
        response = await context.request.put(
            f"{url}/api/v1/dataset/metadata/{dataset['name']}",
            data={
                "metadata": {
                    "invariant.test_results": {"ignored_key": "ignored_value"}
                },
                "replace_all": True,
            },
        )
        assert response.status == 400
        assert "invariant.test_results must not be empty if provided" in (
            await response.text()
        )


async def test_update_metadata_with_replace_all_to_clear_all_metadata(
    context, url, data_abc
):
    """Tests updating metadata of a dataset works using replace_all to clear all metadata."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Add some policy for the dataset.
        await create_policy(context, url, dataset["id"], SECRETS_POLICY, "test_policy")

        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={
                "metadata": {
                    "benchmark": "random",
                    "accuracy": 12.3,
                    "name": "abc",
                    "invariant.test_results": {"num_tests": 5, "num_passed": 3},
                },
            },
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random",
            "accuracy": 12.3,
            "name": "abc",
            "invariant.test_results": {"num_tests": 5, "num_passed": 3},
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata

        # With replace_all set to True, pass in empty metadata to clear all metadata.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={"replace_all": True},
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
        }
        assert metadata == expected_metadata
        assert "policies" not in metadata
        assert "benchmark" not in metadata
        assert "name" not in metadata
        assert "accuracy" not in metadata
        assert "invariant.test_results" not in metadata


async def test_update_metadata_for_non_existent_dataset_fails(context, url):
    """Tests that updating metadata of a non-existent dataset fails."""
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"benchmark": "random", "accuracy": 123}},
    )
    assert update_metadata_response.status == 404


async def test_update_metadata_created_by_different_user_fails(url, context, data_abc):
    """Tests that updating metadata of a dataset created by a different user fails."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # A different user tries to update the metadata for the dataset.
        update_metadata_response = await context.request.put(
            f"{url}/api/v1/dataset/metadata/{dataset['name']}",
            data={"metadata": {"benchmark": "random", "accuracy": 123}},
            headers={"referer": "noauth=user1"},
        )
        assert update_metadata_response.status == 404

        # Make the dataset public.
        await update_dataset(context, url, dataset["id"], is_dataset_public=True)

        # A different user tries to update the metadata for the dataset.
        update_metadata_response = await context.request.put(
            f"{url}/api/v1/dataset/metadata/{dataset['name']}",
            data={"metadata": {"benchmark": "random", "accuracy": 123}},
            headers={"referer": "noauth=user1"},
        )
        assert update_metadata_response.status == 404


async def test_update_metadata_with_invalid_field_fails(context, url):
    """Tests that updating metadata of a dataset with invalid fields fails."""
    # Update metadata with empy benchmark.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"benchmark": ""}},
    )
    assert update_metadata_response.status == 400
    assert (
        "benchmark must be a non-empty string" in await update_metadata_response.text()
    )

    # Update metadata with invalid benchmark type.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"benchmark": 500}},
    )
    assert update_metadata_response.status == 400
    assert "benchmark must be of type str" in await update_metadata_response.text()

    # Update metadata with empy name.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"name": ""}},
    )
    assert update_metadata_response.status == 400
    assert "name must be a non-empty string" in await update_metadata_response.text()

    # Update metadata with invalid name type.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"name": 5}},
    )
    assert update_metadata_response.status == 400
    assert "name must be of type str" in await update_metadata_response.text()

    # Update metadata with invalid accuracy type.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"accuracy": "random-text"}},
    )
    assert update_metadata_response.status == 400
    assert (
        "accuracy must be of type int, float" in await update_metadata_response.text()
    )

    # Update metadata with negative accuracy.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"accuracy": -5}},
    )
    assert update_metadata_response.status == 400
    assert (
        "accuracy must be a non-negative number"
        in await update_metadata_response.text()
    )

    # Update metadata with invalid replace_all value type.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"accuracy": 5}, "replace_all": "random"},
    )
    assert update_metadata_response.status == 400
    assert "replace_all must be a boolean" in await update_metadata_response.text()

    # Update metadata with invalid metadata value type.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": "random", "replace_all": True},
    )
    assert update_metadata_response.status == 400
    assert "metadata must be a dictionary" in await update_metadata_response.text()

    # Update metadata with invalid invariant.test_results type.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"invariant.test_results": 5}},
    )
    assert update_metadata_response.status == 400
    assert (
        "invariant.test_results must be a dictionary if provided"
        in await update_metadata_response.text()
    )

    # Update metadata with empty invariant.test_results.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"invariant.test_results": {}}},
    )
    assert update_metadata_response.status == 400
    assert (
        "invariant.test_results must not be empty if provided"
        in await update_metadata_response.text()
    )

    # Update metadata with invalid invariant.test_results.num_tests type.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"invariant.test_results": {"num_tests": "random"}}},
    )
    assert update_metadata_response.status == 400
    assert (
        "invariant.test_results.num_tests must be of type int"
        in await update_metadata_response.text()
    )

    # Update metadata with invalid invariant.test_results.num_passed type.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"invariant.test_results": {"num_passed": "random"}}},
    )
    assert update_metadata_response.status == 400
    assert (
        "invariant.test_results.num_passed must be of type int"
        in await update_metadata_response.text()
    )


async def test_create_dataset_with_invalid_name_fails(context, url, data_abc):
    """Tests that creating a dataset with an invalid name fails."""
    error_message = "Dataset name can only contain A-Z, a-z, 0-9, - and _"
    for invalid_character in "!@#$%^&*()+=':;<>,.?/\\|`~":
        # Create a dataset with an invalid name.
        dataset_name = f"some{invalid_character}name"
        response = await context.request.post(
            f"{url}/api/v1/dataset/create",
            data={"name": dataset_name},
        )
        assert response.status == 400
        assert error_message in await response.text()

        # Upload a dataset with an invalid name.
        response = await context.request.post(
            url + "/api/v1/dataset/upload",
            multipart={
                "file": {
                    "name": dataset_name + ".json",
                    "mimeType": "application/octet-stream",
                    "buffer": data_abc.encode("utf-8"),
                },
                "name": dataset_name,
            },
        )
        assert response.status == 400
        assert error_message in await response.text()


@pytest.mark.parametrize("is_public", [True, False, None])
async def test_create_dataset_for_is_public_cases(context, url, is_public):
    """Tests that creating a dataset with is_public works."""
    dataset_name = f"some_name-{uuid.uuid4()}"
    request = {"name": dataset_name}
    if is_public is not None:
        request["is_public"] = is_public

    response = await context.request.post(
        f"{url}/api/v1/dataset/create",
        data=request,
    )
    await expect(response).to_be_ok()

    dataset_json = await response.json()
    assert dataset_json["is_public"] is (is_public is True)

    # Cleanup the dataset.
    _ = await context.request.delete(f"{url}/api/v1/dataset/byid/{dataset_json['id']}")


async def test_create_dataset_validate_field_types(context, url):
    """Tests that creating a dataset with invalid field types fails."""
    dataset_name = f"some_name-{uuid.uuid4()}"
    response = await context.request.post(
        f"{url}/api/v1/dataset/create",
        data={"name": dataset_name, "is_public": "random"},
    )
    assert response.status == 400
    assert "is_public must be a boolean" in await response.text()

    response = await context.request.post(
        f"{url}/api/v1/dataset/create", data={"name": 1234, "is_public": "random"}
    )
    assert response.status == 400
    assert "name must be a string" in await response.text()

    response = await context.request.post(
        f"{url}/api/v1/dataset/create",
        data={"name": dataset_name, "is_public": True, "metadata": "random"},
    )
    assert response.status == 400
    assert "metadata must be a dict" in await response.text()


@pytest.mark.parametrize("is_public", [True, False, None])
async def test_upload_dataset_for_is_public_cases(context, url, data_abc, is_public):
    """Tests that uploading a dataset with is_public works."""
    dataset_name = f"some_name-{uuid.uuid4()}"
    request = {
        "name": dataset_name,
        "file": {
            "name": dataset_name + ".json",
            "mimeType": "application/octet-stream",
            "buffer": data_abc.encode("utf-8"),
        },
    }
    if is_public is not None:
        # is_public has to be a string to be passed in the Multipart request.
        request["is_public"] = str(is_public)
    response = await context.request.post(
        f"{url}/api/v1/dataset/upload",
        multipart=request,
    )
    await expect(response).to_be_ok()

    dataset_json = await response.json()
    assert dataset_json["is_public"] is (is_public is True)

    # Cleanup the dataset.
    _ = await context.request.delete(f"{url}/api/v1/dataset/byid/{dataset_json['id']}")


async def test_upload_dataset_validate_field_types(context, url, data_abc):
    """Tests that uploading a dataset with invalid field types fails."""
    dataset_name = f"some_name-{uuid.uuid4()}"
    response = await context.request.post(
        f"{url}/api/v1/dataset/upload",
        multipart={
            "name": dataset_name,
            "file": {
                "name": dataset_name + ".json",
                "mimeType": "application/octet-stream",
                "buffer": data_abc.encode("utf-8"),
            },
            # is_public is not a string representing a boolean
            "is_public": "random",
        },
    )

    assert response.status == 400
    assert "is_public must be a string representing a boolean" in await response.text()


@pytest.mark.parametrize(
    "endpoint, valid",
    [
        ("{url}/api/v1/dataset/byuser/{valid_user}/{valid_datset}", True),
        ("{url}/api/v1/dataset/byuser/{invalid_user}/{valid_datset}", False),
        ("{url}/api/v1/dataset/byuser/{valid_user}/{invalid_datset}", False),
        ("{url}/api/v1/dataset/byuser/{invalid_user}/{invalid_datset}", False),
        ("{url}/api/v1/dataset/byuser/{valid_user}/{valid_datset}/indices", True),
        ("{url}/api/v1/dataset/byuser/{invalid_user}/{valid_datset}/indices", False),
        ("{url}/api/v1/dataset/byuser/{valid_user}/{invalid_datset}/indices", False),
        ("{url}/api/v1/dataset/byuser/{invalid_user}/{invalid_datset}/indices", False),
        ("{url}/api/v1/dataset/list/byuser/{valid_user}", True),
        ("{url}/api/v1/dataset/list/byuser/{invalid_user}", False),
    ],
)
async def test_400_messages(context, url, data_abc, endpoint: str, valid: bool):
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        endpoint_formatted = endpoint.format(
            url=url,
            valid_user="developer",
            invalid_user="developer-does-not-exists",
            valid_datset=dataset["name"],
            invalid_datset="dataset-that-does-not-exist",
        )
        response = await context.request.get(endpoint_formatted)
        if valid:
            assert response.status == 200
        else:
            assert 400 <= response.status < 500


async def test_create_empty_dataset_and_upload_traces(context, url, data_abc):
    """Tests that creating an empty dataset and uploading traces works."""
    dataset_name = f"some_name-{uuid.uuid4()}"
    response = await context.request.post(
        f"{url}/api/v1/dataset/create",
        data={"name": dataset_name},
    )
    await expect(response).to_be_ok()

    dataset_json = await response.json()
    assert dataset_json["name"] == dataset_name
    assert dataset_json["latest_trace_time"] is not None
    assert dataset_json["time_created"] is not None

    response = await context.request.post(
        f"{url}/api/v1/dataset/upload",
        multipart={
            "name": dataset_name,
            "file": {
                "name": dataset_name + ".json",
                "mimeType": "application/octet-stream",
                "buffer": data_abc.encode("utf-8"),
            },
        },
    )
    await expect(response).to_be_ok()

    dataset_json = await response.json()
    assert dataset_json["name"] == dataset_name

    # Cleanup the dataset.
    _ = await context.request.delete(f"{url}/api/v1/dataset/byid/{dataset_json['id']}")


async def test_upload_traces_fails_for_non_empty_dataset(context, url, data_abc):
    """Tests that uploading traces to a non-empty dataset fails."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        response = await context.request.post(
            f"{url}/api/v1/dataset/upload",
            multipart={
                "name": dataset["name"],
                "file": {
                    "name": dataset["name"] + ".json",
                    "mimeType": "application/octet-stream",
                    "buffer": data_abc.encode("utf-8"),
                },
            },
        )
        assert response.status == 400
        assert (
            "Dataset with the same name already exists with traces, to add new traces use the push API"
            in await response.text()
        )


async def test_download_traces_annotated_is_empty_for_non_annotated_dataset(
    context, url, data_abc
):
    """Tests that downloading annotated traces for a non-annotated dataset is empty."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        response = await context.request.get(
            f"{url}/api/v1/dataset/byid/{dataset['id']}/download/annotated"
        )
        assert response.status == 200
        content = await response.text()
        props = jsonl_properties(content)
        num_lines = props["num_lines"]

        assert num_lines == 0, "Expected 0 trace lines"


# same with data_with_annotations, but this time there should be one trace in the output
# the data file contains two traces, but only one with annotations
async def test_download_traces_annotated_has_one_trace(
    context, url, data_with_annotations
):
    """Tests that downloading annotated traces for a dataset with annotations has one trace."""
    async with TemporaryExplorerDataset(url, context, data_with_annotations) as dataset:
        response = await context.request.get(
            f"{url}/api/v1/dataset/byid/{dataset['id']}/download/annotated"
        )
        assert response.status == 200
        content = await response.text()
        props = jsonl_properties(content)
        num_lines = props["num_lines"]
        assert num_lines == 1, "Expected 1 trace line"


def jsonl_properties(jsonl: str) -> dict:
    num_lines = 0

    for line in jsonl.split("\n"):
        if len(line.strip()) == 0:
            continue
        data = json.loads(line)

        # ignore the dataset metadata
        if "messages" in data.keys():
            num_lines += 1

    return {"num_lines": num_lines}
