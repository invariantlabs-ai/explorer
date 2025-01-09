import asyncio # even if not used, required for pytest-asyncio
import os
import re
# add tests folder (parent) to sys.path
import sys
import time
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from util import * # needed for pytest fixtures
import util

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

        # wait for load ('Tool' message)
        await page.wait_for_selector("text=Tool")
        # TODO(https://trello.com/c/OHzUP0t4): Investigate and fix this
        await util.expand_messages(page)

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

async def test_remove_line_numbers(context, url, data_line_numbers, screenshot):
    async with util.TemporaryExplorerDataset(url, context, data_line_numbers) as dataset:
        page = await context.new_page()
        # go to home page
        await page.goto(url)
        await screenshot(page)

        await page.locator(f"text={dataset['name']}").click()
        
        # wait for load
        await page.wait_for_selector("text=Tool")
        # TODO(https://trello.com/c/OHzUP0t4): Investigate and fix this
        await util.expand_messages(page)
        await screenshot(page)

        snippet_1 = page.locator("css=.event").nth(1)
        snippet_2 = page.locator("css=.event").nth(2)

        # take screenshot of message
        snippet_1_screenshot = await screenshot(snippet_1)
        snippet_2_screenshot = await screenshot(snippet_2)

        assert is_highlighted(snippet_1_screenshot), "Code shown in table should be highlighted"
        assert is_highlighted(snippet_2_screenshot), "Code shown in table should be highlighted"

        # Check that there is not a line number column
        #assert not await snippet_1.locator("text=113").is_visible()
        code_snippet_1 = await snippet_1.locator("css=.content").inner_text()
        code_snippet_2 = await snippet_2.locator("css=.content").inner_text()

        # Check that there are no line numbers in the code text
        assert len(extract_line_numbers_from_text(code_snippet_1)) == 0
        assert len(extract_line_numbers_from_text(code_snippet_2)) == 0


async def test_line_numbers_are_not_removed_from_non_code(context, url, data_line_numbers, screenshot):
    async with util.TemporaryExplorerDataset(url, context, data_line_numbers) as dataset:
        page = await context.new_page()
        # go to home page
        await page.goto(url)
        await screenshot(page)

        await page.locator(f"text={dataset['name']}").click()
        await screenshot(page)

        # Find table with list data (looks like line numbers)
        table = page.locator("table").nth(0)
        table_screenshot = await screenshot(table)

        assert not is_highlighted(table_screenshot), "Code shown in table should not be highlighted"

        assert await table.locator("text=113").is_visible()
        assert await table.locator("text=144").is_visible()


async def test_highlights_python_correctly(context, url, data_line_numbers, screenshot):
    async with util.TemporaryExplorerDataset(url, context, data_line_numbers) as dataset:
        page = await context.new_page()
        # go to home page
        await page.goto(url)
        await screenshot(page)

        await page.locator(f"text={dataset['name']}").click()
        await screenshot(page)

        # Find table with list data (looks like line numbers)
        table = page.locator("table").nth(1)
        table_screenshot = await screenshot(table)

        assert is_highlighted(table_screenshot), "Code shown in table should be highlighted"


def extract_line_numbers_from_text(text):
    # Regex to match line numbers at the beginning of a line
    line_number_pattern = r"^\s*(\d+):?\s"
    return [int(match.group(1)) for match in re.finditer(line_number_pattern, text, re.MULTILINE)]



def is_highlighted(screenshot):
    # ignore thumbs up/down colors
    IGNORE_COLORS = [
        (0, 128, 0), # THUMBS UP
        (255, 0, 0), # THUMBS DOWN
    ]

    # checks that the screenshot contains any non-greyish pixels
    # load PNG data from table_screenshot
    img = Image.open(screenshot)
    # get the pixel data
    pixels = img.load()

    for x in range(img.width):
        for y in range(img.height):
            # only add colors where RGB are sufficiently different
            grey_distance = abs(pixels[x, y][0] - pixels[x, y][1]) + abs(pixels[x, y][1] - pixels[x, y][2]) + abs(pixels[x, y][2] - pixels[x, y][0])
            if grey_distance > 10:
                # check if there is a color in IGNORE_COLORS in -5/+5 neighborhood of the pixel
                should_ignore = False
                for dx in range(-5, 5):
                    for dy in range(-5, 5):
                        if x + dx < 0 or x + dx >= img.width or y + dy < 0 or y + dy >= img.height:
                            continue
                        if pixels[x + dx, y + dy][:3] in IGNORE_COLORS:
                            should_ignore = True
                if not should_ignore:
                    return True
    return False
