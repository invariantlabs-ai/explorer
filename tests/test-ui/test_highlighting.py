from playwright.async_api import expect
import asyncio # even if not used, required for pytest-asyncio
import pytest
import os
# add tests folder (parent) to sys.path
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from util import * # needed for pytest fixtures
import util
import tempfile 
from pytest_lazy_fixtures import lf

from PIL import Image

pytest_plugins = ('pytest_asyncio',)

async def test_highlighted_tool_arg(context, url, data_code, screenshot):
    async with util.TemporaryExplorerDataset(url, context, data_code) as dataset:
        page = await context.new_page()
        # go to home page
        await page.goto(url) 
        await screenshot(page)
        
        await page.locator(f"text={dataset['name']}").click()
        await screenshot(page)

        # share dataset
        await page.get_by_role("link", name="All").click()
        await screenshot(page)

        # wait for load ('Tool' message)
        await page.wait_for_selector("text=Tool")

        # # first construct a frame for the second .event on screen (0th .event is the metadata)
        second_message = page.locator("css=.event").nth(2)
        
        # take screenshot of the table
        table_screenshot = await screenshot(second_message.locator("table"))
        assert is_highlighted(table_screenshot), "Code shown in table should be highlighted"

        # # get 'Formatted' button in second message
        await second_message.get_by_role("row", name="plan Formatted // First, get").get_by_role("button").click()
        await screenshot(page)
        table_screenshot = await screenshot(second_message.locator("table"))
        assert not is_highlighted(table_screenshot), "Code shown in table should not be highlighted"

async def test_highlighted_user_msg(context, url, data_code, screenshot):
    async with util.TemporaryExplorerDataset(url, context, data_code) as dataset:
        page = await context.new_page()
        # go to home page
        await page.goto(url) 
        await screenshot(page)
        
        await page.locator(f"text={dataset['name']}").click()
        await screenshot(page)

        # share dataset
        await page.get_by_role("link", name="All").click()
        await screenshot(page)

        # wait for load ('Tool' message)
        await page.wait_for_selector("text=Tool")

        # # first construct a frame for the first .event on screen (0th .event is the metadata)
        user_msg = page.locator("css=.event").nth(1)
        
        # take screenshot of message
        msg_screenshot = await screenshot(user_msg)
        assert is_highlighted(msg_screenshot), "Code shown in table should be highlighted"

        # hover user_msg
        await user_msg.locator("css=.content").hover()
        await screenshot(page)

        # # get 'Formatted' button in user_msg message
        await user_msg.locator("css=.plugin-toggle").click()
        await screenshot(page)

        # take another screenshot of message
        msg_screenshot = await screenshot(user_msg)
        assert not is_highlighted(msg_screenshot), "Code shown in table should not be highlighted"

def is_highlighted(screenshot):
    # checks that the screenshot contains any non-greyish pixels
    # load PNG data from table_screenshot
    img = Image.open(screenshot)
    # get the pixel data
    pixels = img.load()
    # collect all unique pixel colors
    colors = set()
    for x in range(img.width):
        for y in range(img.height):
            # only add colors where RGB are sufficiently different
            grey_distance = abs(pixels[x, y][0] - pixels[x, y][1]) + abs(pixels[x, y][1] - pixels[x, y][2]) + abs(pixels[x, y][2] - pixels[x, y][0])
            if grey_distance > 10:
                return True
    return False