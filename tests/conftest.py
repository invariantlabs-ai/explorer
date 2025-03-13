"""This module contains fixtures for the tests."""

import inspect
import os
import sys
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import pytest
from invariant_sdk.async_client import AsyncClient
from invariant_sdk.client import Client
from playwright.async_api import async_playwright
from util import generate_dataset_name


@pytest.fixture
def url():
    if "URL" in os.environ:
        return os.environ["URL"]
    else:
        return "http://127.0.0.0:80"


@pytest.fixture
def api_server_http_endpoint():
    if "API_SERVER_HTTP_ENDPOINT" in os.environ:
        return os.environ["API_SERVER_HTTP_ENDPOINT"]
    sys.exit("API_SERVER_HTTP_ENDPOINT is not set, exiting.")


@pytest.fixture
def name():
    return f"test-{str(uuid4())}"


@pytest.fixture
async def playwright(scope="session"):
    async with async_playwright() as playwright_instance:
        yield playwright_instance


@pytest.fixture
async def browser(playwright, scope="session"):
    browser = await playwright.firefox.launch(headless=True)
    yield browser
    await browser.close()


@pytest.fixture
async def context(browser):
    context = await browser.new_context(ignore_https_errors=True)
    yield context
    await context.close()


@pytest.fixture(scope="function")
async def screenshot(request):
    # setup
    test_name = request.node.name
    folder = Path(
        f"screenshots/{test_name}_{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}"
    )
    # create folder, if it does not exist
    folder.mkdir(parents=True, exist_ok=True)

    # provide the screenshot function
    async def _screenshot(page):
        try:
            previous_frame = inspect.currentframe().f_back
            lineno = inspect.getframeinfo(previous_frame).lineno
        except:
            lineno = 0
        screenshot_path = str(
            folder / f"line_{lineno}_{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.png"
        )
        await page.screenshot(path=screenshot_path)
        return screenshot_path

    yield _screenshot

    # teardown after test
    # if test failed, keep the screenshots, else we delete
    if not request.node.rep_call.failed:
        for file in folder.iterdir():
            file.unlink()
        folder.rmdir()


@pytest.fixture(scope="function")
def dataset_name(request):
    test_name = request.node.name
    return generate_dataset_name(test_name)


@pytest.fixture(name="invariant_client")
def fixture_invariant_client(api_server_http_endpoint):
    """Fixture to create Client instance."""
    return Client(
        api_url=api_server_http_endpoint,
        api_key="<test-api-key>",  # When DEV_MODE is true, this is not used.
    )


@pytest.fixture(name="async_invariant_client")
def fixture_async_invariant_client(api_server_http_endpoint):
    """Fixture to create AsyncClient instance."""
    return AsyncClient(
        api_url=api_server_http_endpoint,
        api_key="<test-api-key>",  # When DEV_MODE is true, this is not used.
    )


####################
# data fixtures    #
####################


@pytest.fixture
def data_webarena_with_metadata():
    with open("./data/webarena.jsonl", "r") as f:
        return f.read()


@pytest.fixture
def data_abc_with_trace_metadata():
    with open("./data/abc_with_trace_metadata.jsonl", "r") as f:
        return f.read()


@pytest.fixture
def data_abc():
    with open("./data/abc.jsonl", "r") as f:
        return f.read()


@pytest.fixture
def data_with_annotations():
    with open("./data/with_annotations.jsonl", "r") as f:
        return f.read()


@pytest.fixture
def data_code():
    with open("./data/code.jsonl", "r") as f:
        return f.read()


@pytest.fixture
def data_line_numbers():
    with open("./data/line_numbers.jsonl", "r") as f:
        return f.read()


@pytest.fixture
def data_with_json_parseable_tool_call_arguments():
    with open("./data/trace_with_json_parseable_tool_call_arguments.jsonl", "r") as f:
        return f.read()


@pytest.fixture
def data_with_non_json_parseable_tool_call_arguments():
    with open(
        "./data/trace_with_non_json_parseable_tool_call_arguments.jsonl", "r"
    ) as f:
        return f.read()
