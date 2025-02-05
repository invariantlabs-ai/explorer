import os
import sys

# add tests folder (parent) to sys.path
import pytest

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import util
from test_basic import trace_shown_in_sidebar
from util import *  # needed for pytest fixtures

pytest_plugins = ("pytest_asyncio",)


async def test_navigate_with_search_query(context, url, data_code, screenshot):
    """Test that navigating to a dataset with a search query in the url works"""
    async with util.TemporaryExplorerDataset(url, context, data_code) as dataset:
        page = await context.new_page()
        await page.goto(f"{url}/u/developer/{dataset['name']}/t/1?query=foo")
        await page.locator("div.filter-container").wait_for(state="attached")
        await screenshot(page)

        # check that the search query is in the search box
        input_selector = "input.search-text"
        input_value = await page.locator(input_selector).input_value()
        assert input_value == "foo"

        # clear the search query
        await page.locator('button[aria-label="clear-filters"]').click()
        await screenshot(page)

        # check that the search box is empty
        input_value = await page.locator(input_selector).input_value()
        assert input_value == ""


@pytest.mark.parametrize(
    "search_query, filter_option_text",
    [("is:annotated", "Show annotated"), ("is:invariant", "Group by Analysis Result")],
)
async def test_navigate_with_search_query_which_is_a_filter(
    context, url, data_code, search_query, filter_option_text, screenshot
):
    """Test that navigation to a dataset with a search query in the url that is a filter works"""
    async with util.TemporaryExplorerDataset(url, context, data_code) as dataset:
        page = await context.new_page()
        await page.goto(f"{url}/u/developer/{dataset['name']}/t/1?query={search_query}")
        await page.locator("div.filter-container").wait_for(state="attached")
        await screenshot(page)

        # check that the search query is in the search box
        search_input_selector = "input.search-text"
        search_input_value = await page.locator(search_input_selector).input_value()
        assert search_input_value == search_query

        # check that the filter is also selected
        filter_selector = "button.selected-filter-option"
        selected_filter_text = await page.locator(filter_selector).text_content()
        assert selected_filter_text.strip() == filter_option_text

        # clear filter and search query
        await page.locator('button[aria-label="clear-filters"]').click()
        await screenshot(page)

        # check that the search box is empty
        search_input_value = await page.locator(search_input_selector).input_value()
        assert search_input_value == ""

        # check that the filter is not selected
        assert await page.locator(filter_selector).count() == 0


async def test_changing_filter_changes_search_query(context, url, data_abc, screenshot):
    """Test that changing a filter changes the search query"""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        page = await context.new_page()
        await page.goto(f"{url}/u/developer/{dataset['name']}/t/1")
        await page.locator("div.filter-container").wait_for(state="attached")
        await screenshot(page)

        # select a filter
        await page.locator('summary[aria-label="filter-dropdown"]').click()
        await page.locator('button[aria-label="show-annotated-traces-filter"]').click()
        await screenshot(page)

        # check that the search query is in the search box
        search_input_selector = "input.search-text"
        search_input_value = await page.locator(search_input_selector).input_value()
        assert search_input_value == "is:annotated"

        # select another filter
        await page.locator('summary[aria-label="filter-dropdown"]').click()
        await page.locator(
            'button[aria-label="group-by-analysis-result-filter"]'
        ).click()
        await screenshot(page)

        # check that the search query is in the search box
        search_input_value = await page.locator(search_input_selector).input_value()
        assert search_input_value == "is:invariant"


async def test_that_is_annotated_filter_works(context, url, data_abc, screenshot):
    """Test that the is:annotated filter works and shows only annotated traces"""
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        page = await context.new_page()
        await page.goto(f"{url}/u/developer/{dataset['name']}/t/1")
        await page.locator("div.filter-container").wait_for(state="attached")
        await screenshot(page)

        # both traces should be shown
        search_summary_locator = page.locator("h1.header-long")
        search_summary_text = await search_summary_locator.nth(0).text_content()
        assert search_summary_text.strip() == "2 Traces"
        assert await trace_shown_in_sidebar(page, "Run 0")
        assert await trace_shown_in_sidebar(page, "Run 1")

        # add an annotation to Run 1
        await page.locator("div.plugin.code-highlighter").nth(1).click()
        await page.locator("div.plugin.code-highlighter").nth(1).locator("textarea").fill("Annotation added here.")
        await screenshot(page)
        await page.locator('button[aria-label="save-annotation"]').click()
        await screenshot(page)

        # select a filter
        await page.locator('summary[aria-label="filter-dropdown"]').click()
        await page.locator('button[aria-label="show-annotated-traces-filter"]').click()
        await page.wait_for_selector("div.content.user")
        await screenshot(page)

        # verify that only the annotated trace is shown in the sidebar
        search_summary_text = await search_summary_locator.nth(1).text_content()
        assert search_summary_text.strip() == "1 Traces"

        # verify Run 0 is not shown
        assert await trace_shown_in_sidebar(page, "Run 0") is False

        # verify Run 1 is shown with the annotation badge
        trace_result = page.locator("li.trace.active").locator("a.active")
        trace_result_text = await trace_result.locator("span.name").text_content()
        assert trace_result_text.strip() == "Run 1"
        trace_result_badge = await trace_result.locator("span.badge").text_content()
        assert trace_result_badge.strip() == "1"
