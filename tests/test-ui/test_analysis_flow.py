import datetime
import tempfile
import os

async def test_trace_analysis_flow(context, url, screenshot, data_trace_for_analysis):
    page = await context.new_page()
    await page.goto(url)

    # set local storage
    # invariant.explorer.disable.guide.home	true
    # invariant.explorer.disable.guide.trace_view	true
    await page.evaluate(
        """() => {
            localStorage.setItem('invariant.explorer.disable.guide.home', 'true');
            localStorage.setItem('invariant.explorer.disable.guide.trace_view', 'true');
        }"""
    )
    # reload the page to apply local storage changes
    await page.reload()

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

    # go to the 'JSON Upload' tab
    await page.get_by_text("Upload JSON").click()

    # upload traces via file upload
    async with page.expect_file_chooser() as fc_info:
        await page.get_by_label("file-input").click()
    file_chooser = await fc_info.value
    with tempfile.TemporaryDirectory() as tmpdirname:
        fn = os.path.join(tmpdirname, f"{dataset_name}.jsonl")
        with open(fn, "w", encoding="utf-8") as f:
            f.write(data_trace_for_analysis)
        await file_chooser.set_files(fn)
        await screenshot(page)
        await page.get_by_label("Create").click()

    # wait for the dataset to be created
    await page.wait_for_selector(f"text={dataset_name}")
    await screenshot(page)

    # click the dataset
    await page.click(f"text={dataset_name}")

    ### PART 1: Analyzing in the sidebar

    # click aria open-analyzer-button
    await page.click("button.analyzer-button")

    # click the 'Analyze' button
    await page.click("button.primary:has-text('Analyze')")

    # wait for "[prompt-injection]" somewhere in the page
    await page.wait_for_selector("text=[prompt-injection]")

    ### PART 2: Analyzing in the Analysis tab (runs on whole dataset)
    
    # Next, go to the 'Analysis' tab
    await page.click("text=Analysis")

    # click on Run Analysis Model
    await page.click("text=Run Analysis Model")

    # click on Start Analysis
    await page.click("text=Start Analysis")

    # wait for text 'Raw Report' tile to show up
    await page.wait_for_selector("text=Raw Report")

    # check for '"status": "completed",' in the page content
    content = await page.content()
    await screenshot(page)
    assert '"status": "completed",' in content, "Analysis did not complete successfully"

    ### PART 3: Generating guardrail suggestions based on analysis results

    # next go to the 'Guardrails' tab
    await page.click("text=Guardrails")
    await screenshot(page)

    #### PART 3.1: Generating suggestions based on tool definitions

    # click on Generate Suggestions
    await page.click("text=Generate Suggestions")

    # click on 'Based on Tool Definitions'
    await page.click("text=Based on Tool Definitions")
    await screenshot(page)

    # click on 'Generate Suggestions'
    await page.click("text=Generate Suggestions")
    await screenshot(page)

    # wait for the suggestions to be generated (indicated by presenece of <span class="badge purple"><svg>...</svg> Tool Template</span>)
    await page.wait_for_selector(
        "span.badge.purple:has-text('Tool Template')",
        timeout=20000, # wait for up to 20 seconds
    )
    await screenshot(page)

    #### PART 3.2: Generating suggestions based on analysis results

    # click on 'Generate Suggestions' again
    await page.click("text=Generate Suggestions")
    await screenshot(page)

    # click on 'Based on Analysis Results'
    await page.click("text=Based on Analysis Results")
    await screenshot(page)

    # click on 'Generate Suggestions'
    await page.click("text=Generate Suggestions")

    # check for 'Generating Suggestions...' in the page content
    await page.wait_for_selector("text=Generating Suggestions...")
    content = await page.content()
    await screenshot(page)

    # wait for 'Generating Suggestions...' to disappear
    await page.wait_for_selector("text=Generating Suggestions...", state="detached")

    # go to the 'Metadata' tab
    await page.click("text=Metadata")
    # refresh the page to ensure metadata is loaded
    await page.reload()
