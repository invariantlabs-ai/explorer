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


@pytest.mark.parametrize("analysis_host", ["modal", "local"])
async def test_analysis(url, context, data_abc, analysis_host):
    policy_str = """
    raise PolicyViolation("found ABC") if:
        (msg: Message)
        "ABC" in msg.content
    """

    # TODO: Skip modal tests for now since not everyone may have the API keys set up
    if analysis_host == "modal":
        return

    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        # run analysis
        response = await context.request.post(url + '/api/v1/dataset/analyze/' + dataset['id'],
                                              data={"policy_str": policy_str, "analysis_host": analysis_host})
        await expect(response).to_be_ok()
        result = await response.json()
        assert result['total_errors'] == 3