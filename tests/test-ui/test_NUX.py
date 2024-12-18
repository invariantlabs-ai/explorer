import os
# add tests folder (parent) to sys.path
import sys

import pytest
import time
from playwright.async_api import expect
from typing import Literal

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import tempfile

import util
from pytest_lazy_fixtures import lf
from util import *  # needed for pytest fixtures



pytest_plugins = ('pytest_asyncio',)

HAS_SEEN_NUX_HOME = "invariant.explorer.disable.guide.home"
HAS_SEEN_NUX_TRACE_VIEW = "invariant.explorer.disable.guide.trace_view"

async def test_load_page(context, url, screenshot):
    page = await context.new_page()
    await page.goto(url)
    # Set localStorage key-value pair
    # await page.evaluate(f"const HAS_SEEN_NUX_HOME = {HAS_SEEN_NUX_HOME};")
    # await page.evaluate(f"localStorage.removeItem({HAS_SEEN_NUX_HOME});")
    # await page.reload()
    # # Verify the localStorage value
    # stored_value = await page.evaluate(f"localStorage.getItem({HAS_SEEN_NUX_HOME});")
    # print("Here is the stored value: ", stored_value)

    await screenshot(page)