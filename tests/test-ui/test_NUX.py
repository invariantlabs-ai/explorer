import os
# add tests folder (parent) to sys.path
import sys

import pytest
from playwright.async_api import expect

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# for local testing
# os.chdir(os.path.dirname(os.getcwd()))


import util
from pytest_lazy_fixtures import lf
from util import *  # needed for pytest fixtures


pytest_plugins = ('pytest_asyncio',)

HAS_SEEN_NUX_HOME = "invariant.explorer.disable.guide.home"
HAS_SEEN_NUX_TRACE_VIEW = "invariant.explorer.disable.guide.trace_view"

@pytest.mark.skip(reason="Requires nux to be enabled")
async def test_home_page(context, url, screenshot):
    page = await context.new_page()
    await page.goto(url)

    # Verify the localStorage value
    stored_value = await page.evaluate(f"localStorage.getItem({HAS_SEEN_NUX_HOME});")
    print("Here is the stored value: ", stored_value)

    await screenshot(page)
    await page.click("text=Last")
    await screenshot(page)

@pytest.mark.skip(reason="Requires nux to be enabled")
async def test_trace_view(context, url, data_abc, screenshot):
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        page = await context.new_page()
        # go to home page
        await page.goto(url)
        await screenshot(page)

        await page.click("text=Last")
        await screenshot(page)

        # go to dataset page
        await page.locator(f"text={dataset['name']}").click()
        await screenshot(page)

        # go to All tab
        await page.get_by_role("link", name="All").click()
        await page.wait_for_timeout(600)

        await screenshot(page)

        await page.click("text=next")
        await screenshot(page)
        
        await page.click("text=next")
        await screenshot(page)

        await page.click("text=last")
        await screenshot(page)