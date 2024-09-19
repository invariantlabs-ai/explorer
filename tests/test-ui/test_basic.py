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

pytest_plugins = ('pytest_asyncio',)

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
    await page.click("text=Upload")
    await screenshot(page)
    
    # get the trace id
    await page.wait_for_selector("css=.traceid")
    traceid = await page.locator("css=.traceid").inner_text()
    traceid = traceid[2:] # remove the leading # and space
    
    # go back to the home page 
    await page.goto(url)
    await screenshot(page)
    # get all displayed snippet ids
    traces = await page.locator("css=span.traceid").all()
    traceids = [(await trace.inner_text())[1:] for trace in traces] # remove the leading #

    # there is at least the newly created snippet    
    assert len(traceids) > 0
    
    # the id of the newly created snippet is (partially) displayed
    match = [traceid.startswith(tid) for tid in traceids]
    assert sum(match) == 1
    
    # delete the snippet
    trace_link = traces[match.index(True)]
    await trace_link.click()
    await screenshot(page)
    delete_button = await page.locator("css=button.danger").all() # TODO support better locator and alt-text
    assert len(delete_button) == 1
    await delete_button[0].click()
    await screenshot(page)
    # confirm
    delete_button = await page.locator("css=button.danger").all() # TODO support better locator and alt-text
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
    traceids = [(await trace.inner_text())[1:] for trace in traces] # remove the leading "#"

    # check that the snippet is deleted
    match = [traceid.startswith(tid) for tid in traceids]
    assert sum(match) == 0

@pytest.mark.parametrize("content", [None,
                                     lf('data_webarena_with_metadata'),
                                     lf('data_abc')])
async def test_create_delete_dataset(context, url, dataset_name, content, screenshot):
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
        # create empty dataset
        await page.get_by_label("create").click()
    else:
        async with page.expect_file_chooser() as fc_info:
            await page.get_by_label("file-input").click()
        file_chooser = await fc_info.value
       
        with tempfile.TemporaryDirectory() as tmpdirname:
            fn = os.path.join(tmpdirname, f"{dataset_name}.jsonl")
            with open(fn, 'w') as f:
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
    await page.get_by_label("delete").click()
    await screenshot(page)
    await page.get_by_label("confirm delete").click()
    await screenshot(page)
    
    # we should be back at the home page 
    # check if the dataset is deleted
    dataset_mentions = await page.locator(f"text={dataset_name}").all()
    assert len(dataset_mentions) == 0

async def test_reupload_ui(context, url, data_webarena_with_metadata, screenshot):
    async with util.TemporaryExplorerDataset(url, context, data_webarena_with_metadata) as dataset:
        page = await context.new_page()
        
        # go to dataset page
        await page.goto(url) 
        await page.locator(f"text={dataset['name']}").click()

        # download dataset
        async with page.expect_download() as download:
            await page.get_by_label("download").click()
            download = await download.value
            with tempfile.TemporaryDirectory() as tmpdirname:
                fn = os.path.join(tmpdirname, download.suggested_filename)
                await download.save_as(fn)
                with open(fn, 'r') as f:
                    download_data = f.read()
                    
                # reupload the dataset
                async with util.TemporaryExplorerDataset(url, context, download_data) as dataset_reupload:
                    await page.goto(url) 
                    await page.locator(f"text={dataset_reupload['name']}").click()
                    await page.get_by_role("link", name="All").click()
                    await screenshot(page)

                    # TODO this currently fails, because the dataset reimport does not work well
                    await expect(page.get_by_text("Failed to render")).to_have_count(0)

async def test_share_trace(context, url, data_webarena_with_metadata, screenshot):
    async with util.TemporaryExplorerDataset(url, context, data_webarena_with_metadata) as dataset:
        page = await context.new_page()
        # go to home page
        await page.goto(url) 
        await screenshot(page)
        
        await page.locator(f"text={dataset['name']}").click()
        await screenshot(page)

        # share dataset
        await page.get_by_role("link", name="All").click()
        await screenshot(page)
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
        username = await page.locator("css=.user-info").inner_text()
        path_username = await page.get_by_label("path-user").inner_text()
        path_username = path_username[:-2] # remove the trailing /
        assert username.lower().strip() == path_username.lower().strip()
        path_dataset = await page.get_by_label("path-dataset").inner_text()
        assert path_dataset == dataset['name']
  