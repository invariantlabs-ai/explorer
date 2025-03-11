import asyncio
import os
import time

# add tests folder (parent) to sys.path
import sys
from typing import Literal

import pytest
from playwright.async_api import expect

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tempfile

import util
from pytest_lazy_fixtures import lf
from util import *  # needed for pytest fixtures

pytest_plugins = ("pytest_asyncio",)


async def test_load_page(context, url, screenshot):
    page = await context.new_page()
    await page.goto(url)
    await screenshot(page)


async def test_create_delete_snippet(context, url, screenshot):
    page = await context.new_page()
    await page.goto(url)

    # create new snippet
    await screenshot(page)
    await page.click("text=New Trace")
    await screenshot(page)

    # wait for 2s

    await page.click("text=Upload")
    await screenshot(page)

    # get the trace id
    await page.wait_for_selector("css=.traceid")
    traceid = await page.locator("css=.traceid").inner_text()
    traceid = traceid[2:]  # remove the leading # and space

    # go back to the home page
    await page.goto(url)
    await screenshot(page)
    # get all displayed snippet ids
    traces = await retry_fetch(lambda: page.locator("css=span.traceid").all())
    traceids = [
        (await trace.inner_text())[1:] for trace in traces
    ]  # remove the leading #

    # there is at least the newly created snippet
    assert len(traceids) > 0

    # the id of the newly created snippet is (partially) displayed
    match = [traceid.startswith(tid) for tid in traceids]
    assert sum(match) == 1

    # delete the snippet
    trace_link = traces[match.index(True)]
    await trace_link.click()
    await screenshot(page)
    delete_button = await retry_fetch(
        lambda: page.locator("css=button.danger").all()
    )  # TODO support better locator and alt-text
    assert len(delete_button) == 1
    await delete_button[0].click()
    await screenshot(page)
    # confirm
    delete_button = await page.locator(
        "css=button.danger"
    ).all()  # TODO support better locator and alt-text
    for button in delete_button:
        if "Delete" in await button.inner_text():
            await button.click()
            break
    await screenshot(page)

    # go back to the home page
    await page.goto(url)
    await screenshot(page)

    # get all displayed snippet ids
    traces = await page.locator("css=span.traceid").all()
    traceids = [
        (await trace.inner_text())[1:] for trace in traces
    ]  # remove the leading "#"

    # check that the snippet is deleted
    match = [traceid.startswith(tid) for tid in traceids]
    assert sum(match) == 0


@pytest.mark.parametrize(
    "content", [None, lf("data_webarena_with_metadata"), lf("data_abc")]
)
async def test_create_delete_dataset(context, url, dataset_name, content, screenshot):
    """Create datasets (empty and via file upload) and delete them."""
    page = await context.new_page()
    await page.goto(url)

    # create upload dataset
    await screenshot(page)
    await page.click("text=New Dataset")
    await screenshot(page)
    dataset_name_input = await page.get_by_placeholder("Dataset Name").all()
    await dataset_name_input[0].focus()
    await page.keyboard.type(dataset_name)
    await screenshot(page)

    if content is None:
        # Select the radio button with value 'empty'
        await page.locator("input[type='radio'][value='empty']").check()
        # create empty dataset
        await page.get_by_label("create").click()
    else:
        # Select the radio button with value 'jsonl'
        await page.locator("input[type='radio'][value='jsonl']").check()
        async with page.expect_file_chooser() as fc_info:
            await page.get_by_label("file-input").click()
        file_chooser = await fc_info.value

        with tempfile.TemporaryDirectory() as tmpdirname:
            fn = os.path.join(tmpdirname, f"{dataset_name}.jsonl")
            with open(fn, "w", encoding="utf-8") as f:
                f.write(content)
            await file_chooser.set_files(fn)
            await screenshot(page)
            await page.get_by_label("create").click()
            await screenshot(page)

    # go to home page
    await page.goto(url)
    await screenshot(page)

    await page.locator(f"text={dataset_name}").click()
    await expect(page.locator("text=Failed to render")).to_have_count(0)
    await screenshot(page)

    # delete dataset
    await page.goto(url)
    await page.locator(f"text={dataset_name}").click()
    await page.get_by_role("button", name="settings").click()
    await page.get_by_label("delete").click()
    await screenshot(page)
    await page.get_by_label("confirm delete").click()
    await screenshot(page)

    # we should be back at the home page
    # check if the dataset is deleted
    await page.wait_for_selector(".home-banner")
    await screenshot(page)
    dataset_mentions = await page.locator(f"text={dataset_name}").all()
    assert len(dataset_mentions) == 0


@pytest.mark.parametrize("content", [lf("data_webarena_with_metadata")])
async def test_create_empty_dataset_and_then_upload_file(
    context, url, dataset_name, content, screenshot
):
    """Create an empty dataset and then upload traces for it from the empty dataset view page."""
    page = await context.new_page()
    await page.goto(url)

    # create an empty dataset
    await screenshot(page)
    await page.click("text=New Dataset")
    await screenshot(page)
    dataset_name_input = await page.get_by_placeholder("Dataset Name").all()
    await dataset_name_input[0].focus()
    await page.keyboard.type(dataset_name)
    await screenshot(page)
    await page.get_by_label("create").click()

    # go to the dataset page
    await page.goto(url)
    await page.locator(f"text={dataset_name}").click()

    # go to the 'JSON Upload' tab
    await page.get_by_text("JSON Upload").click()

    # upload traces via file upload
    async with page.expect_file_chooser() as fc_info:
        await page.get_by_label("file-input").click()
    file_chooser = await fc_info.value
    with tempfile.TemporaryDirectory() as tmpdirname:
        fn = os.path.join(tmpdirname, f"{dataset_name}.jsonl")
        with open(fn, "w", encoding="utf-8") as f:
            f.write(content)
        await file_chooser.set_files(fn)
        await screenshot(page)
        await page.get_by_label("Upload").click()

    # verify that the traces are shown
    await page.wait_for_selector("text=Run 1")
    await page.wait_for_selector("text=Run 2")
    await screenshot(page)

    # delete dataset
    await page.goto(url)
    await page.locator(f"text={dataset_name}").click()
    await page.get_by_role("button", name="settings").click()
    await page.get_by_label("delete").click()
    await page.get_by_label("confirm delete").click()
    await screenshot(page)

    # we should be back at the home page
    # check if the dataset is deleted
    await page.wait_for_selector(".home-banner")
    await screenshot(page)
    dataset_mentions = await page.locator(f"text={dataset_name}").all()
    assert len(dataset_mentions) == 0


async def test_reupload_ui(context, url, data_webarena_with_metadata, screenshot):
    async with util.TemporaryExplorerDataset(
        url, context, data_webarena_with_metadata
    ) as dataset:
        page = await context.new_page()

        # go to dataset page
        await page.goto(url)
        await page.locator(f"text={dataset['name']}").click()

        # download dataset
        async with page.expect_download() as download:
            await page.get_by_role("button", name="settings").click()
            await page.get_by_label("download").click()
            download = await download.value
            with tempfile.TemporaryDirectory() as tmpdirname:
                fn = os.path.join(tmpdirname, download.suggested_filename)
                await download.save_as(fn)
                with open(fn, "r") as f:
                    download_data = f.read()

                # reupload the dataset
                async with util.TemporaryExplorerDataset(
                    url, context, download_data
                ) as dataset_reupload:
                    await page.goto(url)
                    await page.locator(f"text={dataset_reupload['name']}").click()
                    await screenshot(page)

                    # TODO this currently fails, because the dataset reimport does not work well
                    await expect(page.get_by_text("Failed to render")).to_have_count(0)


async def trace_shown_in_sidebar(page, trace_name):
    traces_shown = await page.locator("css=li.trace").all()
    return any([(await ts.inner_text()) == trace_name for ts in traces_shown])


async def test_search(context, url, data_abc_with_trace_metadata, screenshot):
    async with util.TemporaryExplorerDataset(
        url, context, data_abc_with_trace_metadata
    ) as dataset:
        page = await context.new_page()
        # go to home page
        await page.goto(url)
        await screenshot(page)

        await page.locator(f"text={dataset['name']}").click()
        await screenshot(page)

        # both traces should be shown
        await trace_shown_in_sidebar(page, "Run 0")
        await trace_shown_in_sidebar(page, "Run 1")

        # try different searches
        # each search is a tuple with query and the expected result (e.g. which traces are shown)
        searches = [
            ("ABC", [True, True]),
            ("name", [False, True]),
            ("meta:a%101", [True, False]),
            ("meta:a%10", [True, True]),
            ("meta:b=asdf", [False, True]),
            ("meta:b%asdf", [False, True]),
        ]

        search_input = await retry_fetch(
            lambda: page.get_by_placeholder("Search").all()
        )
        for query, expected in searches:
            await search_input[0].fill(query)
            await search_input[0].press("Enter")
            await page.wait_for_timeout(1000)  # wait for the search to be processed
            await screenshot(page)
            for trace, exp in zip(["Run 0", "Run 1"], expected):
                assert await trace_shown_in_sidebar(page, trace) == exp


async def test_share_trace(context, url, data_webarena_with_metadata, screenshot):
    async with util.TemporaryExplorerDataset(
        url, context, data_webarena_with_metadata
    ) as dataset:
        page = await context.new_page()
        # go to home page
        await page.goto(url)
        await screenshot(page)

        await page.locator(f"text={dataset['name']}").click()
        await screenshot(page)

        # share dataset
        await page.get_by_role("button", name="Share").click()
        await screenshot(page)
        await page.locator("text=Enable Sharing").click()
        await screenshot(page)
        link = await page.get_by_role("textbox").first.input_value()

        # test navigation as guest
        await page.goto(link + "?noauth=1")
        await expect(page.get_by_label("path-user")).to_have_count(0)
        await expect(page.get_by_label("path-trace")).to_have_count(0)

        # test navigation as owner
        await page.goto(link)
        await screenshot(page)
        username = await page.locator("css=.user-info p").inner_text()
        path_username = await page.get_by_label("path-user").inner_text()
        path_username = path_username[:-2]  # remove the trailing /
        assert username.lower().strip() == path_username.lower().strip()
        path_dataset = await page.get_by_label("path-dataset").inner_text()
        assert path_dataset == dataset["name"]


async def test_policy(context, url, data_webarena_with_metadata, screenshot):
    async with util.TemporaryExplorerDataset(
        url, context, data_webarena_with_metadata
    ) as dataset:
        page = await context.new_page()
        # Go to home page.
        await page.goto(url)

        # Go to dataset page.
        await page.locator(f"text={dataset['name']}").click()

        # View policies.
        await page.locator("text=Guardrails").click()
        await page.wait_for_selector("div.no-policies")
        no_policies_found_text = await page.locator("div.no-policies").inner_text()
        assert "No Guardrails Configured" in no_policies_found_text
        await screenshot(page)

        # Create policy.
        await page.get_by_role("button", name="create guardrail").click()
        # Wait for the monaco editor to load.
        policy_name_input = await page.get_by_placeholder("Guardrail Name").all()
        await policy_name_input[0].fill("Test Policy")
        policy_code_input = await retry_fetch(
            lambda: page.locator("div.view-lines").all()
        )
        await policy_code_input[0].click()
        await page.keyboard.type("""
            from invariant.detectors import secrets

            raise PolicyViolation("found secrets", msg) if:
                (msg: Message)
                any(secrets(msg))
            """)
        await screenshot(page)
        # click button with aria label 'create'
        await page.get_by_label("modal create").click()
        await screenshot(page)

        # Edit policy.
        await page.get_by_label("edit").click()
        # Wait for the monaco editor to load.
        await screenshot(page)
        policy_name_input = await page.locator('input[value="Test Policy"]').all()
        await policy_name_input[0].fill("Updated Test Policy")
        policy_code_input = await page.locator("div.view-lines").all()
        await policy_code_input[0].click()
        await page.keyboard.type("""
            # Updated policy code.
            """)
        await screenshot(page)
        await page.get_by_label("modal update").click()
        await screenshot(page)

        # re-open policy (only then we have the delete button)
        await page.get_by_label("edit").click()

        # delete policy.
        await page.get_by_label("delete guardrail").click()
        await screenshot(page)
        await page.get_by_label("confirm delete").click()

        # No policies on the page now.
        await page.wait_for_selector("div.no-policies")
        await screenshot(page)
        no_policies_found_text = await page.locator("div.no-policies").inner_text()
        assert "No Guardrails Configured" in no_policies_found_text


async def test_thumbs_up_down(context, url, data_abc, screenshot):
    async with util.TemporaryExplorerDataset(url, context, data_abc) as dataset:
        page = await context.new_page()
        # go to home page
        await page.goto(url)
        await screenshot(page)

        await page.locator(f"text={dataset['name']}").click()
        # wait for load
        await page.wait_for_selector("text=User")
        await screenshot(page)

        # hover over a line to show thumbs up/down
        # role is unexpanded
        line = page.locator(".unexpanded").first
        await line.hover()
        await screenshot(page)

        # Fold Sidebar (data-tooltip-content="Fold Sidebar")
        await page.locator("css=[data-tooltip-content='Fold Sidebar']").click()

        # click thumbs up
        await page.locator(".thumbs-up-icon").first.click()
        await screenshot(page)

        # verify thumbs up styling applied
        assert await has_thumbs_visible(
            line
        ), "Thumbs on the first line are not visible"
        assert await has_thumb_toggled(
            line, thumb="up"
        ), "Thumbs up on the first line are not toggled"

        # click thumbs down on another line
        second_line = page.locator(".unexpanded").nth(1)
        await second_line.hover()
        # wait for 200ms
        await second_line.locator(".thumbs-down-icon").first.click()
        await screenshot(page)

        # verify thumbs down styling applied
        assert await has_thumbs_visible(
            second_line
        ), "Thumbs on the second line are not visible, but got: {}".format(
            await classes_of_element(second_line)
        )
        assert await has_thumb_toggled(
            second_line, thumb="down"
        ), "Thumbs down on the second line are not toggle, but got: {}".format(
            await classes_of_element(second_line)
        )


def retry(max_time: float = 3.0, time_interval: float = 0.01):
    def decorator(func):
        async def wrapper(*args, **kwargs):
            for _ in range(int(max_time / time_interval)):
                if await func(*args, **kwargs):
                    return True
                await asyncio.sleep(time_interval)
            return False

        return wrapper

    return decorator


@retry()
async def has_thumb_toggled(line, thumb: Literal["up", "down"]) -> bool:
    return "toggled" in await line.locator(
        ".thumbs-{}-icon".format(thumb)
    ).get_attribute("class")


@retry()
async def has_thumbs_visible(line) -> bool:
    return "visible" in await line.locator(".thumbs").get_attribute("class")


async def classes_of_element(element):
    return await element.get_attribute("class")


async def retry_fetch(fetch_fn, max_time: float = 3.0, time_interval: float = 0.01):
    """
    The fetch_fn is an Async func that returns a list. We will retry until it is not empty
    """
    for _ in range(int(max_time / time_interval)):
        out = await fetch_fn()
        if out:
            return out
        await asyncio.sleep(time_interval)
    return []
