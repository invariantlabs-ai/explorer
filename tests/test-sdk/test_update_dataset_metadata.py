"""Tests for the UpdateDatasetMetadata API via SDK."""

import os
import sys

import pytest

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from util import *  # needed for pytest fixtures

pytest_plugins = ("pytest_asyncio",)


@pytest.mark.parametrize("is_async", [True, False])
async def test_update_metadata_without_replace_all(
    is_async, context, url, invariant_client, async_invariant_client, data_abc
):
    """Tests that updating metadata of a dataset works using replace_all set to False (Default)."""

    client = async_invariant_client if is_async else invariant_client
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:

        async def update_metadata(metadata, replace_all=False):
            if is_async:
                return await client.create_request_and_update_dataset_metadata(
                    dataset_name=dataset["name"],
                    metadata=metadata,
                    replace_all=replace_all,
                )
            return client.create_request_and_update_dataset_metadata(
                dataset_name=dataset["name"], metadata=metadata, replace_all=replace_all
            )

        async def get_metadata():
            return (
                await client.get_dataset_metadata(dataset_name=dataset["name"])
                if is_async
                else client.get_dataset_metadata(dataset_name=dataset["name"])
            )

        # Update metadata with replace_all=False
        await update_metadata(
            {"benchmark": "random", "accuracy": 12.3}, replace_all=False
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random",
            "accuracy": 12.3,
        }
        assert await get_metadata() == expected_metadata

        # Update only accuracy
        await update_metadata({"accuracy": 5})
        expected_metadata["accuracy"] = 5
        assert await get_metadata() == expected_metadata

        # Update only benchmark
        await update_metadata({"benchmark": "benchmark2"}, replace_all=False)
        expected_metadata["benchmark"] = "benchmark2"
        assert await get_metadata() == expected_metadata

        # Update only name
        await update_metadata({"name": "abc"}, replace_all=False)
        expected_metadata["name"] = "abc"
        assert await get_metadata() == expected_metadata

        # Update test results
        await update_metadata(
            {"invariant.test_results": {"num_tests": 10, "num_passed": 5}},
            replace_all=False,
        )
        expected_metadata["invariant.test_results"] = {"num_tests": 10, "num_passed": 5}
        assert await get_metadata() == expected_metadata


@pytest.mark.parametrize("is_async", [True, False])
async def test_update_metadata_with_replace_all(
    is_async, context, url, invariant_client, async_invariant_client, data_abc
):
    """Tests that updating metadata of a dataset works using replace_all."""

    client = async_invariant_client if is_async else invariant_client
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:

        async def update_metadata(metadata, replace_all=False):
            if is_async:
                return await client.create_request_and_update_dataset_metadata(
                    dataset_name=dataset["name"],
                    metadata=metadata,
                    replace_all=replace_all,
                )
            return client.create_request_and_update_dataset_metadata(
                dataset_name=dataset["name"], metadata=metadata, replace_all=replace_all
            )

        async def get_metadata():
            return (
                await client.get_dataset_metadata(dataset_name=dataset["name"])
                if is_async
                else client.get_dataset_metadata(dataset_name=dataset["name"])
            )

        # Update metadata with replace_all=True
        await update_metadata(
            {"benchmark": "random", "accuracy": 12.3, "name": "abc"}, replace_all=True
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random",
            "accuracy": 12.3,
            "name": "abc",
        }
        assert await get_metadata() == expected_metadata

        # Update only accuracy
        await update_metadata({"accuracy": 5}, replace_all=True)
        expected_metadata = {**dataset.get("extra_metadata", {}), "accuracy": 5}
        assert await get_metadata() == expected_metadata
        assert "benchmark" not in expected_metadata
        assert "name" not in expected_metadata

        # Update only benchmark
        await update_metadata({"benchmark": "benchmark2"}, replace_all=True)
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "benchmark2",
        }
        assert await get_metadata() == expected_metadata
        assert "accuracy" not in expected_metadata
        assert "name" not in expected_metadata

        # Update only name
        await update_metadata({"name": "xyz"}, replace_all=True)
        expected_metadata = {**dataset.get("extra_metadata", {}), "name": "xyz"}
        assert await get_metadata() == expected_metadata
        assert "benchmark" not in expected_metadata
        assert "accuracy" not in expected_metadata

        # Update test results
        await update_metadata(
            {"invariant.test_results": {"num_tests": 10}}, replace_all=True
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "invariant.test_results": {"num_tests": 10},
        }
        assert await get_metadata() == expected_metadata
        assert "benchmark" not in expected_metadata
        assert "accuracy" not in expected_metadata
        assert "name" not in expected_metadata


@pytest.mark.parametrize("is_async", [True, False])
async def test_update_metadata_with_replace_all_to_clear_all_metadata(
    is_async, context, url, invariant_client, async_invariant_client, data_abc
):
    """Tests updating metadata of a dataset works using replace_all to clear all metadata."""

    client = async_invariant_client if is_async else invariant_client
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:

        async def update_metadata(metadata, replace_all=False):
            if is_async:
                return await client.create_request_and_update_dataset_metadata(
                    dataset_name=dataset["name"],
                    metadata=metadata,
                    replace_all=replace_all,
                )
            return client.create_request_and_update_dataset_metadata(
                dataset_name=dataset["name"], metadata=metadata, replace_all=replace_all
            )

        async def get_metadata():
            return (
                await client.get_dataset_metadata(dataset_name=dataset["name"])
                if is_async
                else client.get_dataset_metadata(dataset_name=dataset["name"])
            )

        # First, populate metadata
        await update_metadata(
            {
                "benchmark": "random",
                "accuracy": 12.3,
                "name": "abc",
                "invariant.test_results": {"num_tests": 10, "num_passed": 5},
            },
            replace_all=False,
        )
        expected_metadata = {
            **dataset.get("extra_metadata", {}),
            "benchmark": "random",
            "accuracy": 12.3,
            "name": "abc",
            "invariant.test_results": {"num_tests": 10, "num_passed": 5},
        }
        assert await get_metadata() == expected_metadata

        # Clear metadata with replace_all=True
        await update_metadata({}, replace_all=True)
        expected_metadata = {**dataset.get("extra_metadata", {})}
        assert await get_metadata() == expected_metadata
        assert "benchmark" not in expected_metadata
        assert "name" not in expected_metadata
        assert "accuracy" not in expected_metadata
        assert "invariant.test_results" not in expected_metadata
