"""Tests for dataset API endpoints."""

import os

# add tests folder (parent) to sys.path
import sys

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
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Create another dataset with the same name.
        response = await context.request.post(
            f"{url}/api/v1/dataset/create", data={"name": dataset["name"]}
        )

        # This should result in an error.
        assert response.status == 400
        assert "Dataset with the same name already exists" in await response.text()


async def test_get_metadata(context, url, data_abc):
    """Tests that getting metadata of a dataset works (both public and private)."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Add some policy for the dataset.
        await create_policy(context, url, dataset["id"], SECRETS_POLICY, "test_policy")

        # Get metadata for the dataset.
        metadata = await get_metadata(context, url, dataset["name"])
        assert metadata == dataset.get("extra_metadata")
        assert "policies" not in metadata

        # Make the dataset public.
        await update_dataset(context, url, dataset["id"], is_dataset_public=True)

        # Get metadata for the dataset.
        metadata = await get_metadata(context, url, dataset["name"])
        assert metadata == dataset.get("extra_metadata")
        assert "policies" not in metadata


async def test_get_metadata_for_non_existent_dataset_fails(context, url):
    """Tests that getting metadata of a non-existent dataset fails."""
    get_metadata_response = await context.request.get(
        f"{url}/api/v1/dataset/metadata/some_dataset"
    )
    assert get_metadata_response.status == 404


async def test_get_metadata_created_by_different_user(context, url, data_abc):
    """Tests that getting metadata of a dataset created by a different user fails for private datasets."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Add some policy for the dataset.
        await create_policy(context, url, dataset["id"], SECRETS_POLICY, "test_policy")

        # A different user tries to get the metadata for the dataset.
        get_metadata_response = await context.request.get(
            f"{url}/api/v1/dataset/metadata/{dataset['name']}",
            headers={"referer": "noauth=user1"},
        )
        assert get_metadata_response.status == 401

        # Make the dataset public.
        await update_dataset(context, url, dataset["id"], is_dataset_public=True)

        # A different user tries to get the metadata for the dataset.
        metadata = await get_metadata(
            context, url, dataset["name"], headers={"referer": "noauth=user1"}
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
        }
        # Succeeds because the dataset is public.
        assert metadata == expected_metadata
        assert "policies" not in metadata


async def test_update_metadata_for_public_and_private_dataset_types(
    context, url, data_abc
):
    """Tests that updating metadata of a dataset works (both public and private)."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
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
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
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


async def test_update_metadata_with_replace_all(context, url, data_abc):
    """Tests that updating metadata of a dataset works using replace_all."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Add some policy for the dataset.
        await create_policy(context, url, dataset["id"], SECRETS_POLICY, "test_policy")

        # Update metadata for the dataset with replace_all set to True.
        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={
                "metadata": {"benchmark": "random", "accuracy": 12.3, "name": "abc"},
                "replace_all": True,
            },
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random",
            "accuracy": 12.3,
            "name": "abc",
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


async def test_update_metadata_with_replace_all_to_clear_all_metadata(
    context, url, data_abc
):
    """Tests updating metadata of a dataset works using replace_all to clear all metadata."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Add some policy for the dataset.
        await create_policy(context, url, dataset["id"], SECRETS_POLICY, "test_policy")

        metadata = await update_metadata(
            context,
            url,
            dataset["name"],
            data={
                "metadata": {"benchmark": "random", "accuracy": 12.3, "name": "abc"},
            },
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random",
            "accuracy": 12.3,
            "name": "abc",
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


async def test_update_metadata_for_non_existent_dataset_fails(context, url):
    """Tests that updating metadata of a non-existent dataset fails."""
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"benchmark": "random", "accuracy": 123}},
    )
    assert update_metadata_response.status == 404


async def test_update_metadata_created_by_different_user_fails(url, context, data_abc):
    """Tests that updating metadata of a dataset created by a different user fails."""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # A different user tries to update the metadata for the dataset.
        update_metadata_response = await context.request.put(
            f"{url}/api/v1/dataset/metadata/{dataset['name']}",
            data={"metadata": {"benchmark": "random", "accuracy": 123}},
            headers={"referer": "noauth=user1"},
        )
        assert update_metadata_response.status == 401

        # Make the dataset public.
        await update_dataset(context, url, dataset["id"], is_dataset_public=True)

        # A different user tries to update the metadata for the dataset.
        update_metadata_response = await context.request.put(
            f"{url}/api/v1/dataset/metadata/{dataset['name']}",
            data={"metadata": {"benchmark": "random", "accuracy": 123}},
            headers={"referer": "noauth=user1"},
        )
        assert update_metadata_response.status == 403


async def test_update_metadata_with_invalid_field_fails(context, url):
    """Tests that updating metadata of a dataset with invalid fields fails."""
    # Update metadata with empy benchmark.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"benchmark": ""}},
    )
    assert update_metadata_response.status == 400
    assert (
        "Benchmark must be a non-empty string if provided"
        in await update_metadata_response.text()
    )

    # Update metadata with invalid benchmark type.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"benchmark": 500}},
    )
    assert update_metadata_response.status == 400
    assert (
        "Benchmark must be a non-empty string if provided"
        in await update_metadata_response.text()
    )

    # Update metadata with empy name.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"name": ""}},
    )
    assert update_metadata_response.status == 400
    assert (
        "Name must be a non-empty string if provided"
        in await update_metadata_response.text()
    )

    # Update metadata with invalid name type.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"name": 5}},
    )
    assert update_metadata_response.status == 400
    assert (
        "Name must be a non-empty string if provided"
        in await update_metadata_response.text()
    )

    # Update metadata with invalid accuracy type.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"accuracy": "random-text"}},
    )
    assert update_metadata_response.status == 400
    assert (
        "Accuracy score must be a non-negative float or int if provided"
        in await update_metadata_response.text()
    )

    # Update metadata with negative accuracy.
    update_metadata_response = await context.request.put(
        f"{url}/api/v1/dataset/metadata/some_dataset",
        data={"metadata": {"accuracy": -5}},
    )
    assert update_metadata_response.status == 400
    assert (
        "Accuracy score must be a non-negative float or int if provided"
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