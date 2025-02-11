"""Tests for the GetDatasetMetadata API via SDK."""

import os
import sys

import pytest

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from util import *  # needed for pytest fixtures

pytest_plugins = ("pytest_asyncio",)


@pytest.mark.parametrize("is_async", [True, False])
async def test_get_dataset_metadata(
    is_async, context, url, async_invariant_client, invariant_client, data_abc
):
    """Test get_dataset_metadata."""
    async with TemporaryExplorerDataset(url, context, data_abc) as dataset:
        metadata = invariant_client.get_dataset_metadata(dataset["name"])
        assert metadata == dataset["extra_metadata"]

        # Add some more metadata to the dataset.
        if is_async:
            _ = await async_invariant_client.create_request_and_update_dataset_metadata(
                dataset_name=dataset["name"],
                metadata={"benchmark": "test", "accuracy": 0.9, "name": "some_name"},
            )
        else:
            _ = invariant_client.create_request_and_update_dataset_metadata(
                dataset_name=dataset["name"],
                metadata={"benchmark": "test", "accuracy": 0.9, "name": "some_name"},
            )

        # Get the metadata again and check if it is updated.
        if is_async:
            metadata = await async_invariant_client.get_dataset_metadata(
                dataset["name"]
            )
        else:
            metadata = invariant_client.get_dataset_metadata(dataset["name"])
        assert metadata == {
            **dataset.get("extra_metadata", {}),
            "benchmark": "test",
            "accuracy": 0.9,
            "name": "some_name",
        }
