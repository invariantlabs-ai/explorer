import { Base64 } from "js-base64";
import { useEffect, useState } from "react";
import {
  BsArrowBarUp,
  BsArrowsCollapse,
  BsArrowsExpand,
  BsBook,
  BsChevronDown,
  BsChevronLeft,
  BsChevronRight,
  BsPlayFill,
  BsShare,
} from "react-icons/bs";
import { GuardrailsIcon } from "../../components/Icons";
import useGuardrailsChecker from "../../lib/GuardrailsChecker";
import useWindowSize from "../../lib/size";
import { TraceView } from "../../lib/traceview/traceview";
import { GuardrailFailureHighlightDetail } from "../traces/HighlightDetails";
import "./playground.scss";
import { PolicyEditor } from "./policyeditor";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./resizable";
import Spinning from "./spinning";
import type { AnalysisResult, PolicyError } from "./types";
import { beautifyJson } from "./utils";
import CodeHighlightedView from "../../lib/traceview/plugins/code-highlighter";
import ImageViewer from "../../lib/traceview/plugins/image-viewer";
import { useTelemetry } from "../../utils/Telemetry";

/**
 * Tries to find the name of a tool call in the given messages.
 */
function findSomeToolCallName(messages) {
  let tool_call_msg = messages.find((msg) => msg.tool_calls);
  if (!tool_call_msg) return null;

  let tool_call = tool_call_msg.tool_calls.find((tc) => tc.function.name);
  if (!tool_call) return null;

  return tool_call.function.name;
}

/**
 * Tries to create a policy that is compatible with the Invariant Playground
 * from the given messages (i.e. that matches some specific pattern in the
 * list of messages).
 *
 * Returns null if no compatible policy could be created.
 */
function makeCompatibleInvariantPolicy(messages) {
  let tool_call = findSomeToolCallName(messages);
  if (tool_call) {
    return "(call: ToolCall)\n    call is tool:" + tool_call;
  } else {
    // find some random message with text content and create policy to match some word
    let message = messages.find((msg) => msg.content);
    if (!message) return null;
    let content = message.content;
    let word = content.split(" ")[0];
    let msg_type =
      message.role == "tool" ? ["out", "ToolOutput"] : ["msg", "Message"];
    return `(${msg_type[0]}: ${msg_type[1]})\n    "${word}" in ${msg_type[0]}.content`;
  }
}

/**
 * Open the given messages in the Invariant Playground.
 *
 * @param messages The list of trace events to open in the playground.
 * Messages must be serializable to JSON and then Base64. Messages must
 * not exceed size of what a browser can handle in a URL.
 *
 * This function will try to automatically synthesize a policy that matches
 * some pattern in the given messages to showcase the Invariant Playground.
 */
export function openInPlayground(
  messages: any[],
  navigate: ((url: string) => void) | null = null
) {
  if (!messages) {
    alert("Failed to send to Invariant: No messages");
    return;
  }

  try {
    // translate tool_call_ids and ids to strings if needed (analyzer expects strings)
    messages = messages.map((message) => {
      message = JSON.parse(JSON.stringify(message));
      if (typeof message.tool_call_id !== "undefined") {
        message.tool_call_id = message.tool_call_id.toString();
      }
      (message.tool_calls || []).forEach((tool_call) => {
        if (typeof tool_call.id !== "undefined") {
          tool_call.id = tool_call.id.toString();
        }
      });
      return message;
    });

    const policyCode = `raise "Detected issue" if:
    # specify your guardrailing rule here
    
    # example query
    ${makeCompatibleInvariantPolicy(messages) || "True"}`;

    const json_object = JSON.stringify(messages || []);
    const bytes = new TextEncoder().encode(json_object);
    const encoded_string = Array.from(bytes, (byte) =>
      String.fromCodePoint(byte)
    ).join("");
    const b64_object = Base64.encode(encoded_string);

    const url = `/playground?policy=${Base64.encode(policyCode)}&input=${encodeURIComponent(b64_object)}`;

    if (navigate) {
      navigate(url);
    } else {
      // open the URL
      window.open(url, "_blank");
    }
  } catch (e) {
    alert("Failed to send to Invariant: " + e);
  }
}

export function decodePlaygroundInput(encoded_input: string) {
  const decoded = Base64.decode(encoded_input);
  const bytes = new Uint8Array(
    Array.from(decoded, (c) => c.codePointAt(0) || 0)
  );
  return new TextDecoder().decode(bytes);
}
interface PlaygroundProps {
  editable?: boolean;
  runnable?: boolean;
  deployable?: boolean;
  shareable?: boolean;
  showPolicy?: boolean;
  showTrace?: boolean;
  playgroundable?: boolean;
  headerStyle?: "minimal" | "full";
  resizeEditor?: boolean;
}

export function usePlaygroundExamples() {
  const [policyLibrary, setPolicyLibrary] = useState<any[]>([]);
  const [defaultExample, setDefaultExample] = useState<{
    policy: string;
    input: string;
  }>({
    policy: "",
    input: "[]",
  });

  useEffect(() => {
    async function fetchExamples() {
      try {
        const response = await fetch("/playground-examples.json", {
          headers: {
            "Content-Type": "application/json",
          },
        });
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        const data = await response.json();
        setPolicyLibrary(data);

        // Find first non-header example to use as default
        const firstExample = data.find(
          (example: any) => example.policy && example.input
        );
        if (firstExample) {
          setDefaultExample({
            policy: firstExample.policy,
            input: firstExample.input,
          });
        }
      } catch (error) {
        console.error("Error fetching examples:", error);
      }
    }

    fetchExamples();
  }, []);

  return { policyLibrary, defaultExample };
}

/**
 * Button to show the examples popover.
 *
 * This button will show a list of example policies and input data
 * when clicked. The user can select an example to load it into the
 * policy editor and input data field.
 */
export function ExamplesButton({
  setPolicyCode,
  setInputData,
}: {
  setPolicyCode: (policy: string) => void;
  setInputData: (input: string) => void;
}) {
  const telemetry = useTelemetry();
  const [showExamples, setShowExamples] = useState(false);
  const { policyLibrary } = usePlaygroundExamples();

  return (
    <>
      <button
        className={"inline " + (showExamples ? "triggered" : "")}
        onClick={() => setShowExamples(!showExamples)}
      >
        Examples
        <BsChevronDown />
      </button>
      {showExamples && (
        <div className={"popover " + (showExamples ? "is-open" : "")}>
          <button onClick={() => setShowExamples(false)} className="close">
            Close
          </button>
          <header>
            <h1>Invariant Guardrailing Rules</h1>
            <p>
              Browse a library of example guardrailing rules to get started.
            </p>
          </header>
          <ul>
            {policyLibrary.length === 0 && (
              <li>
                <p className="empty">No examples found.</p>
              </li>
            )}
            {policyLibrary.map((example, index) => (
              <li key={index} className={!example.policy ? "header" : ""}>
                <div
                  className="example"
                  onClick={() => {
                    const policy = example.policy || "";
                    const input = example.input || "";
                    if (!policy || !input) {
                      return;
                    }
                    telemetry.capture("playground.select-example", {
                      example: example.name,
                    });
                    setPolicyCode(policy);
                    setInputData(input);
                    setShowExamples(false);
                  }}
                >
                  <b>{example.name}</b>
                  <p>{example.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function WelcomeModal({ onClose, setPolicyCode, setInputData }: any) {
  const telemetry = useTelemetry();

  const { policyLibrary } = usePlaygroundExamples();

  const onDocs = () => {
    telemetry.capture("playground.welcome-dialog.open-docs");
    window.open("https://explorer.invariantlabs.ai/docs", "_blank");
  };

  // Group examples by header
  const groupedExamples = policyLibrary.reduce(
    (acc: Record<string, any[]>, ex) => {
      if (!ex.policy) {
        acc[ex.name] = [];
      } else {
        const lastHeader = Object.keys(acc).at(-1);
        if (lastHeader) acc[lastHeader].push(ex);
      }
      return acc;
    },
    {}
  );

  const onSelectExample = (example: any) => {
    telemetry.capture("playground.select-example", {
      example: example.name,
    });
    setPolicyCode(example.policy);
    setInputData(example.input);
    onClose();
  };

  return (
    <div className="modal welcome">
      <div className="modal-content view-options welcome">
        <button className="close" onClick={onClose}>
          Close
        </button>
        <div className="feature">
          <div className="left">
            <h1>Welcome to Invariant</h1>
            <h2>
              Invariant Guardrails offers contextual guardrailing for your
              agentic AI systems, based on fuzzy and deterministic guardrailing
              rules.
              <br />
              <br />
              You can use this playground to experiment with guardrails and see
              how they work in practice.
            </h2>
            <div className="buttons">
              <button className="inline" onClick={onClose}>
                Open Playground
              </button>
              <button className="inline primary" onClick={onDocs}>
                Read Documentation
              </button>
            </div>
          </div>
          <div className="right">
            <pre>
              <code>
                <span className="keyword" style={{ fontWeight: "bold" }}>
                  raise
                </span>{" "}
                <span className="string">"Detected issue"</span>
                <span className="keyword" style={{ fontWeight: "bold" }}>
                  {" if"}
                </span>
                :<br />
                {"  "}(<span className="var">msg</span>:{" "}
                <span className="var">Message</span>)<br />
                <span className="var">{"  "}msg</span>.
                <span className="var">role</span> ==
                <span className="string">"user"</span>
                <br />
                <span className="func">{"  "}prompt_injection</span>(
                <span className="var">msg</span>.
                <span className="var">content</span>)
              </code>
            </pre>
          </div>
        </div>
        <hr />
        <div className="examples-header">
          <h3>Example Guardrailing Rules</h3>
          <p>Browse a library of example guardrailing rules to get started.</p>
        </div>
        <div className="examples-scroll">
          {policyLibrary.length === 0 && (
            <p className="empty">No examples found.</p>
          )}
          {Object.entries(groupedExamples).map(([header, examples], i) => (
            <div key={i} className="examples-section">
              <h4>{header}</h4>
              <div className="examples">
                {examples.map((example, j) => (
                  <div
                    key={j}
                    className="example"
                    onClick={() => onSelectExample(example)}
                  >
                    <b>{example.name}</b>
                    <p>
                      {example.description.length > 100
                        ? example.description.slice(0, 100) + "..."
                        : example.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function useWelcomeDialogState() {
  // checks in local storage, if welcome dialog was dismissed previously
  const [_showWelcomeDialog, setShowWelcomeDialog] = useState(
    localStorage.getItem("welcome-dialog") !== "false"
  );
  const dismissWelcomeDialog = () => {
    setShowWelcomeDialog(false);
    localStorage.setItem("welcome-dialog", "false");
  };

  const showWelcomeDialog = () => {
    // hows it locally, but does not reset the local storage
    setShowWelcomeDialog(true);
  };

  return {
    welcomeDialogShown: _showWelcomeDialog,
    dismissWelcomeDialog,
    showWelcomeDialog,
  };
}

const Playground = ({
  editable = true,
  runnable = true,
  deployable = true,
  playgroundable = true,
  shareable = true,
  showPolicy = true,
  showTrace = true,
  headerStyle = "full",
  resizeEditor = false,
}: PlaygroundProps) => {
  // get search params from URL
  const [policyCode, _setPolicyCode] = useState<string | null>(null);
  const [inputData, _setInputData] = useState<string | null>(null);
  const { defaultExample } = usePlaygroundExamples();
  const telemetry = useTelemetry();

  const { welcomeDialogShown, dismissWelcomeDialog, showWelcomeDialog } =
    useWelcomeDialogState();

  const setPolicyCode = (policy: string | null) => {
    _setPolicyCode(policy);
    if (headerStyle === "full") {
      localStorage.setItem("policy", policy || "");
    }
  };

  const setInputData = (input: string | null) => {
    _setInputData(input);
    setAnalysisResult(null);
    if (headerStyle === "full") {
      localStorage.setItem("input", input || "");
    }
  };

  useEffect(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      let policy_url = searchParams.get("policy");
      if (policy_url) {
        policy_url = Base64.decode(policy_url);
      }
      let input_url = searchParams.get("input");
      if (input_url) {
        input_url = decodePlaygroundInput(input_url);
        input_url = beautifyJson(input_url);
      }
      const policy_local = localStorage.getItem("policy");
      const input_local = localStorage.getItem("input");

      if (policy_url || input_url) {
        setPolicyCode(policy_url || defaultExample.policy);
        setInputData(input_url || defaultExample.input);

        if (headerStyle === "full") {
          localStorage.setItem("policy", policy_url || defaultExample.policy);
          localStorage.setItem("input", input_url || defaultExample.input);
        }

        // remove data from URL
        const url = new URL(window.location.href);
        url.searchParams.delete("policy");
        url.searchParams.delete("input");
        window.history.replaceState({}, document.title, url.toString());
      } else {
        setPolicyCode(policy_local || defaultExample.policy);
        setInputData(
          input_local && input_local != "[]"
            ? input_local
            : defaultExample.input
        );
      }
    } catch (error) {
      console.error("Failed to parse URL: ", error);
      // clear URL
      const url = new URL(window.location.href);
      url.searchParams.delete("policy");
      url.searchParams.delete("input");
      window.history.replaceState({}, document.title, url.toString());

      setPolicyCode(defaultExample.policy);
      setInputData(defaultExample.input);
    }
  }, [defaultExample]);

  const { check, ApiKeyModal } = useGuardrailsChecker();
  const [policyEditorHeight, setPolicyEditorHeight] = useState<
    number | undefined
  >(undefined);

  // verification & highlight state
  const [loading, setLoading] = useState<boolean>(false);
  const [analysisResult, setAnalysisResult] = useState<PolicyError[] | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [analysisResultIdx, setAnalysisResultIdx] = useState<number>(0);
  const highlights =
    analysisResult && analysisResult[analysisResultIdx]
      ? Object.fromEntries(
          analysisResult[analysisResultIdx].ranges.map((r) => [r, r])
        )
      : {};

  const [events, setEvents] = useState<any>([]);

  const [collapsed, setCollapsed] = useState(false);

  const onCollapseAll = () => {
    events.collapseAll?.fire();
    setCollapsed(true);
  };

  const onExpandAll = () => {
    events.expandAll?.fire();
    setCollapsed(false);
  };

  const handleEvaluate = async () => {
    telemetry.capture("playground.evaluate", {
      policy: policyCode,
      input: inputData,
    });

    setLoading(true); // Start loading
    setAnalysisResult(null);
    setError(null);

    if (!policyCode) {
      setLoading(false);
      return;
    }

    try {
      // Analyze the policy with the input data
      const analyzeResponse = await check(
        JSON.parse(inputData || "[]"),
        policyCode || ""
      );
      if (analyzeResponse.status !== 200) {
        analyzeResponse.json().then((text) => {
          setLoading(false);

          telemetry.capture("playground.evaluate-failed", {
            policy: policyCode,
            input: inputData,
            error: text,
          });

          setError(
            "Failed to evaluate policy: " +
              (text?.detail || JSON.stringify(text))
          );
        });
        throw new Error(
          analyzeResponse.status + " " + analyzeResponse.statusText
        );
      }

      const analysisResult: string | AnalysisResult =
        await analyzeResponse.json();

      // check for error messages
      if (typeof analysisResult === "string") {
        setLoading(false);
        return;
      }

      setAnalysisResult(analysisResult.errors);
      setAnalysisResultIdx(0);
    } catch (error) {
      console.error("Failed to evaluate policy:", error);
      setError("Failed to evaluate policy: " + (error as Error).message);
    } finally {
      setLoading(false); // End loading
    }
  };

  const getShareURL = () => {
    let policy = policyCode || "";
    policy = Base64.encode(policy);
    policy = encodeURIComponent(policy);
    let input = inputData || "";
    input = Base64.encode(input);
    input = encodeURIComponent(input);

    return `${window.location.origin}${window.location.pathname.replace("/embed", "")}?policy=${policy}&input=${input}`;
  };

  const handleInputChange = (value: string | undefined) => {
    if (value !== undefined) {
      const beautified = beautifyJson(value);
      setInputData(beautified);
      localStorage.setItem("input", beautified);
    }
  };

  const handleShare = () => {
    navigator.clipboard
      .writeText(getShareURL())
      .then(() => {
        alert("URL copied to clipboard!");
      })
      .catch((error) => {
        alert("Uh oh! Something went wrong.");
      });
  };

  const handleOpenInPlayground = () => {
    window.open(getShareURL(), "_blank");
  };

  const handleDeploy = () => {
    const location =
      "/deploy-guardrail#policy-code=" +
      encodeURIComponent(policyCode || "") +
      "&name=" +
      "New Rule";
    window.open(location, "_blank");
  };

  const handleWelcome = () => {
    telemetry.capture("playground.welcome-dialog", {
      action: "show",
    });
    showWelcomeDialog();
  };

  return (
    <>
      {welcomeDialogShown && (
        <WelcomeModal
          onClose={() => dismissWelcomeDialog()}
          setPolicyCode={setPolicyCode}
          setInputData={setInputData}
        />
      )}
      <ApiKeyModal />
      <div className="playground">
        <h2 className={`header-${headerStyle}`}>
          {headerStyle === "full" && (
            <>
              <div className="playground-title">
                <span>Guardrails Playground</span>
                <ExamplesButton
                  setPolicyCode={setPolicyCode}
                  setInputData={setInputData}
                />
                <a onClick={handleWelcome} className="docs-link">
                  <BsBook />
                  Learn More about Guardrails
                </a>
              </div>
            </>
          )}

          {deployable && (
            <button className="inline" onClick={handleDeploy}>
              <BsArrowBarUp />
              Add as Guardrail
            </button>
          )}

          {shareable && (
            <button onClick={handleShare} className="inline">
              <BsShare />
              Share
            </button>
          )}

          {playgroundable && (
            <button onClick={handleOpenInPlayground} className="inline">
              <BsPlayFill />
              Open in Playground
            </button>
          )}

          {runnable && (
            <button
              onClick={handleEvaluate}
              disabled={loading}
              className="inline primary"
            >
              <span style={{ whiteSpace: "nowrap" }}>
                {" "}
                {loading ? <Spinning /> : <BsPlayFill className="icon-play" />}
                Evaluate
              </span>
            </button>
          )}
        </h2>

        <ResizablePanelGroup
          direction="horizontal"
          className="playground-container"
        >
          {showPolicy && (
            <>
              <ResizablePanel
                defaultSize={50}
                minSize={25}
                className="panel"
                style={
                  resizeEditor && policyEditorHeight
                    ? { height: `${policyEditorHeight}px` }
                    : undefined
                }
              >
                <ResizablePanelGroup
                  direction="vertical"
                  className="playground-editor"
                >
                  <ResizablePanel defaultSize={50} minSize={25}>
                    <PolicyEditor
                      height="100%"
                      defaultLanguage="python"
                      value={policyCode || ""}
                      fontSize={16}
                      readOnly={!editable}
                      onChange={(value?: string) => setPolicyCode(value || "")}
                      theme="vs-light"
                      onDidContentSizeChange={(size) => {
                        if (resizeEditor)
                          setPolicyEditorHeight(size.contentHeight);
                      }}
                    />
                  </ResizablePanel>

                  {headerStyle === "full" && (
                    <>
                      <ResizableHandle />
                    </>
                  )}
                </ResizablePanelGroup>
              </ResizablePanel>

              {showTrace && <ResizableHandle />}
            </>
          )}

          {showTrace && (
            <>
              <ResizablePanel
                defaultSize={50}
                minSize={25}
                className="panel-horizontal"
              >
                <div className="analysis-result">
                  <h3>
                    <GuardrailsIcon /> Guardrailing Results
                    {analysisResult && (
                      <a
                        className="link"
                        onClick={() => {
                          setAnalysisResult(null);
                          setAnalysisResultIdx(0);
                        }}
                      >
                        Clear
                      </a>
                    )}
                  </h3>
                  {!analysisResult && (
                    <div
                      className={"no-result " + (loading ? "is-loading" : "")}
                      onClick={handleEvaluate}
                    >
                      {loading ? (
                        <>Evaluating...</>
                      ) : (
                        <>
                          Run <i>Evaluate</i> to see results
                        </>
                      )}
                    </div>
                  )}
                  {analysisResult &&
                    Object.keys(analysisResult).length == 0 && (
                      <div
                        className={"no-result " + (loading ? "is-loading" : "")}
                        onClick={handleEvaluate}
                      >
                        {loading ? <>Evaluating...</> : <>No matches found.</>}
                      </div>
                    )}
                  {error && <div className="error">{error}</div>}
                  {analysisResult && Object.keys(analysisResult).length > 0 && (
                    <>
                      <div className="control-indicator">
                        {Object.keys(analysisResult).length > 0 && (
                          <>
                            <span>
                              {analysisResultIdx + 1} / {analysisResult.length}
                            </span>
                            <div className="controls">
                              <button
                                disabled={analysisResultIdx === 0}
                                onClick={() => {
                                  setAnalysisResultIdx(
                                    (analysisResultIdx - 1) %
                                      analysisResult.length
                                  );
                                }}
                              >
                                <BsChevronLeft />
                              </button>
                              <button
                                disabled={
                                  analysisResultIdx ===
                                  analysisResult.length - 1
                                }
                                onClick={() => {
                                  setAnalysisResultIdx(
                                    (analysisResultIdx + 1) %
                                      analysisResult.length
                                  );
                                }}
                              >
                                <BsChevronRight />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                      {analysisResult.map((result, index) => {
                        return (
                          <GuardrailFailureHighlightDetail
                            key={index}
                            onHover={() => {
                              setAnalysisResultIdx(index);
                            }}
                            highlight={{
                              content: result.args.join(" "),
                              source: "Guardrail",
                              type: "guardrail",
                            }}
                          />
                        );
                      })}
                    </>
                  )}
                </div>
                <TraceView
                  header={
                    <>
                      <div className="spacer" />
                      {collapsed ? (
                        <button
                          className="inline icon"
                          onClick={onExpandAll}
                          data-tooltip-id="highlight-tooltip"
                          data-tooltip-content="Expand All"
                        >
                          <BsArrowsExpand />
                        </button>
                      ) : (
                        <button
                          className="inline icon"
                          onClick={onCollapseAll}
                          data-tooltip-id="highlight-tooltip"
                          data-tooltip-content="Collapse All"
                        >
                          <BsArrowsCollapse />
                        </button>
                      )}
                    </>
                  }
                  inputData={inputData || "[]"}
                  traceId={"<none>"}
                  onMount={(events) => setEvents(events)}
                  handleInputChange={handleInputChange}
                  highlights={highlights}
                  sideBySide={false}
                  editor={true}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    </>
  );
};

export default Playground;
