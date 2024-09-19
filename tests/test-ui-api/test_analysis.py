from playwright.async_api import expect
import asyncio # even if not used, required for pytest-asyncio
import pytest
import os
# add tests folder (parent) to sys.path
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import util
from util import * # needed for pytest fixtures

pytest_plugins = ('pytest_asyncio',)

async def test_analysis(url, context, data_abc):
    policy_str = """
    raise PolicyViolation("found ABC") if:
        (msg: Message)
        "ABC" in msg.content
    """

    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # run analysis
        response = await context.request.post(url + '/api/v1/dataset/analyze/' + dataset['id'],
                                              data={"policy_str": policy_str})
        await expect(response).to_be_ok()
        result = await response.json()
        assert result['total_errors'] == 3