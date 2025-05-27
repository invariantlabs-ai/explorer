import datetime
import os

# add tests folder (parent) to sys.path
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def test_guardrails_flow(context, url, screenshot):
    """
    This test creates a new dataset, starts a simulated agent and runs it,
    creates a guardrail, and checks if the guardrail works by running
    the agent again which now should fail.
    """
    PRODUCTION_EXPLORER_KEY = os.environ.get("PRODUCTION_EXPLORER_KEY")
    OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

    if not PRODUCTION_EXPLORER_KEY:
        raise ValueError(
            "PRODUCTION_EXPLORER_KEY is not available but required for tests"
        )
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY is not set but required for tests")

    page = await context.new_page()
    await page.goto(url)

    dataset_name = "test-demo-dataset-" + datetime.datetime.now().strftime(
        "%Y-%m-%d-%H-%M-%S"
    )

    # set window size
    await page.set_viewport_size({"width": 1920, "height": 1080})

    await screenshot(page)

    # click the New Dataset button
    await page.click("text=New Dataset")

    # type into "Dataset Name" field (placeholder)
    await page.fill("input[placeholder='Dataset Name']", dataset_name)

    # click Create Dataset button (<button aria-label="create" class="primary">Create</button>)
    await page.click("button[aria-label='create']")

    # wait for test-demo-dataset to appear in the list
    await page.wait_for_selector("text=test-demo-dataset")

    await screenshot(page)

    # click it
    await page.click("text=test-demo-dataset")

    await page.click("button[aria-label='start-simulated-agent']")

    # insert hosted-explorer-api-key
    await page.fill(
        "input[aria-label='hosted-explorer-api-key']", PRODUCTION_EXPLORER_KEY
    )

    # insert openai-api-key
    await page.fill("input[aria-label='openai-api-key']", OPENAI_API_KEY)

    # click Save
    await page.click("button[aria-label='Close']")

    # click on button with 'Hello, how are you?'
    await page.click("text=Hello, how are you?")

    await screenshot(page)

    # wait for 3s
    await page.wait_for_timeout(3000)

    await screenshot(page)

    # wait for Run 0 to appear
    await page.wait_for_selector("text=Run 0")
    # click on Run 0
    await page.click("text=Run 0")

    # Go to the 'Guardrails' tab
    await page.click("text=Guardrails")

    # make sure we see 'No Guardrails Configured'
    await page.wait_for_selector("text=No Guardrails Configured")

    # click on 'Create Guardrail'
    await page.click("text=Create Guardrail")

    # in monaco editor select all text and delete
    await page.click(".monaco-editor")

    # if mac, use Meta+A, else use Control+A
    if "darwin" in sys.platform:
        await page.keyboard.press("Meta+A")
    else:
        await page.keyboard.press("Control+A")
    await page.keyboard.press("Backspace")
    await page.keyboard.type("""
raise "Do not greet with 'Hello'" if:
    (msg: Message)
    "Hello" in msg.content
""")

    # click on div with aria-label 'block-enabled'
    await page.click("div[aria-label='block-enabled']")

    # click on button with aria 'modal create'
    await page.click("button[aria-label='modal create']")

    # reset Chat via button with aria-label 'Reset chat'
    await page.click("button[aria-label='Reset chat']")

    # type into textarea with aria label chat-composer
    await page.fill(
        "textarea[aria-label='Type your message here']", "Hello, how are you?"
    )
    # click on 'Send'
    await page.click("button[aria-label='Send']")

    await screenshot(page)

    # wait for 1s
    await screenshot(page)

    # assert presence of "Guardrail Failure Do not greet with 'Hello'"
    await page.wait_for_selector("text=Guardrail Failure Do not greet with 'Hello'")
