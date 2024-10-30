import os

# add tests folder (parent) to sys.path
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import util
from util import *  # needed for pytest fixtures

pytest_plugins = ("pytest_asyncio",)


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
