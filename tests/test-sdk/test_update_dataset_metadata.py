"""Tests for the UpdateDatasetMetadata API via SDK."""

import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from util import *  # needed for pytest fixtures

pytest_plugins = ("pytest_asyncio",)


async def test_update_metadata_without_replace_all(
    context, url, invariant_client, data_abc
):
    """Tests that updating metadata of a dataset works using replace_all set to False (Default)."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Update metadata for the dataset with replace_all set to False.
        _ = invariant_client.create_request_and_update_dataset_metadata(
            dataset_name=dataset["name"],
            metadata={"benchmark": "random", "accuracy": 12.3},
            replace_all=False,
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random",
            "accuracy": 12.3,
        }
        assert (
            invariant_client.get_dataset_metadata(dataset_name=dataset["name"])
            == expected_metadata
        )

        # Update only the accuracy without replace_all (defaults to False).
        _ = invariant_client.create_request_and_update_dataset_metadata(
            dataset_name=dataset["name"],
            metadata={"accuracy": 5},
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random",
            "accuracy": 5,
        }
        assert (
            invariant_client.get_dataset_metadata(dataset_name=dataset["name"])
            == expected_metadata
        )

        # Update only the benchmark with replace_all set to False.
        _ = invariant_client.create_request_and_update_dataset_metadata(
            dataset_name=dataset["name"],
            metadata={"benchmark": "benchmark2"},
            replace_all=False,
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "benchmark2",
            "accuracy": 5,
        }
        assert (
            invariant_client.get_dataset_metadata(dataset_name=dataset["name"])
            == expected_metadata
        )

        # Update only the name with replace_all set to False.
        _ = invariant_client.create_request_and_update_dataset_metadata(
            dataset_name=dataset["name"],
            metadata={"name": "abc"},
            replace_all=False,
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "benchmark2",
            "accuracy": 5,
            "name": "abc",
        }
        assert (
            invariant_client.get_dataset_metadata(dataset_name=dataset["name"])
            == expected_metadata
        )


async def test_update_metadata_with_replace_all(
    context, url, invariant_client, data_abc
):
    """Tests that updating metadata of a dataset works using replace_all."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # Update metadata for the dataset with replace_all set to True.
        _ = invariant_client.create_request_and_update_dataset_metadata(
            dataset_name=dataset["name"],
            metadata={"benchmark": "random", "accuracy": 12.3, "name": "abc"},
            replace_all=True,
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random",
            "accuracy": 12.3,
            "name": "abc",
        }
        assert (
            invariant_client.get_dataset_metadata(dataset_name=dataset["name"])
            == expected_metadata
        )

        # Update only the accuracy with replace_all set to True.
        _ = invariant_client.create_request_and_update_dataset_metadata(
            dataset_name=dataset["name"],
            metadata={"accuracy": 5},
            replace_all=True,
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "accuracy": 5,
        }
        updated_metadata = invariant_client.get_dataset_metadata(
            dataset_name=dataset["name"]
        )
        assert updated_metadata == expected_metadata
        assert "benchmark" not in updated_metadata
        assert "name" not in updated_metadata

        # Update only the benchmark with replace_all set to True.
        _ = invariant_client.create_request_and_update_dataset_metadata(
            dataset_name=dataset["name"],
            metadata={"benchmark": "benchmark2"},
            replace_all=True,
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "benchmark2",
        }
        updated_metadata = invariant_client.get_dataset_metadata(
            dataset_name=dataset["name"]
        )
        assert updated_metadata == expected_metadata
        assert "accuracy" not in updated_metadata
        assert "name" not in updated_metadata

        # Update only the name with replace_all set to True.
        _ = invariant_client.create_request_and_update_dataset_metadata(
            dataset_name=dataset["name"],
            metadata={"name": "xyz"},
            replace_all=True,
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "name": "xyz",
        }
        updated_metadata = invariant_client.get_dataset_metadata(
            dataset_name=dataset["name"]
        )
        assert updated_metadata == expected_metadata
        assert "benchmark" not in updated_metadata
        assert "accuracy" not in updated_metadata


async def test_update_metadata_with_replace_all_to_clear_all_metadata(
    context, url, invariant_client, data_abc
):
    """Tests updating metadata of a dataset works using replace_all to clear all metadata."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        _ = invariant_client.create_request_and_update_dataset_metadata(
            dataset_name=dataset["name"],
            metadata={"benchmark": "random", "accuracy": 12.3, "name": "abc"},
            replace_all=False,
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random",
            "accuracy": 12.3,
            "name": "abc",
        }
        assert (
            invariant_client.get_dataset_metadata(dataset_name=dataset["name"])
            == expected_metadata
        )

        # With replace_all set to True, pass in empty metadata to clear all metadata.
        _ = invariant_client.create_request_and_update_dataset_metadata(
            dataset_name=dataset["name"],
            metadata={},
            replace_all=True,
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
        }
        updated_metadata = invariant_client.get_dataset_metadata(
            dataset_name=dataset["name"]
        )
        assert updated_metadata == expected_metadata
        assert "benchmark" not in updated_metadata
        assert "name" not in updated_metadata
        assert "accuracy" not in updated_metadata
