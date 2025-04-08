import { Base64 } from "js-base64";
import { useEffect, useState } from "react";
import {
  BsPlayFill,
  BsGithub,
  BsShare,
  BsChevronLeft,
  BsChevronRight,
  BsArrowDown,
  BsArrowUp,
  BsCheckCircle,
  BsChevronDown,
  BsExclamationTriangle,
  BsArrowBarUp,
  BsPlus,
} from "react-icons/bs";
import { useNavigate } from "react-router-dom";
import { beautifyJson } from "./utils";
import type { AnalysisResult, PolicyError } from "./types";
import { TraceView } from "../../lib/traceview/traceview";
import Spinning from "./spinning";
import { PolicyEditor } from "./policyeditor";
import useWindowSize from "../../lib/size";
import "./playground.scss";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./resizable";
import {
  GuardrailHighlightDetail,
  GuardrailFailureHighlightDetail,
} from "../traces/HighlightDetails";
import { GuardrailsIcon } from "../../components/Icons";
import useGuardrailsChecker from "../../lib/GuardrailsChecker";

const defaultPolicy = "";
const defaultInput = "[]";

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
    # specify your conditions here
    # To learn more about Invariant policies go to https://github.com/invariantlabs-ai/invariant
    
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
  const [policyCode, setPolicyCode] = useState<string | null>(null);
  const [inputData, setInputData] = useState<string | null>(null);

  useEffect(() => {
    console.log("loading playground");
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
        setPolicyCode(policy_url || defaultPolicy);
        setInputData(input_url || defaultInput);

        localStorage.setItem("policy", policy_url || defaultPolicy);
        localStorage.setItem("input", input_url || defaultInput);

        // remove data from URL
        const url = new URL(window.location.href);
        url.searchParams.delete("policy");
        url.searchParams.delete("input");
        window.history.replaceState({}, document.title, url.toString());
      } else {
        setPolicyCode(policy_local || defaultPolicy);
        setInputData(input_local || defaultInput);
      }
    } catch (error) {
      console.error("Failed to parse URL: ", error);
      // clear URL
      const url = new URL(window.location.href);
      url.searchParams.delete("policy");
      url.searchParams.delete("input");
      window.history.replaceState({}, document.title, url.toString());

      setPolicyCode(defaultPolicy);
      setInputData(defaultInput);
    }
  }, []);

  const { width: screenWidth } = useWindowSize();
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

  const handleEvaluate = async () => {
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
          console.error("Failed to evaluate policy:", text);
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
    let input = inputData || "";
    return `${window.location.origin}${window.location.pathname.replace("/embed", "")}?policy=${Base64.encode(policy)}&input=${Base64.encode(input)}`;
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

  return (
    <>
      <ApiKeyModal />
      <div className="playground">
        <h2 className={`header-${headerStyle}`}>
          {headerStyle === "full" && (
            <div className="playground-title">Guardrail Playground</div>
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
                <PolicyEditor
                  height="100%"
                  defaultLanguage="python"
                  value={policyCode || ""}
                  fontSize={16}
                  readOnly={!editable}
                  onChange={(value?: string) => setPolicyCode(value || "")}
                  theme="vs-light"
                  onDidContentSizeChange={(size) => {
                    if (resizeEditor) setPolicyEditorHeight(size.contentHeight);
                  }}
                />
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
                        className={
                          "no-result error " + (loading ? "is-loading" : "")
                        }
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
                      <GuardrailFailureHighlightDetail
                        highlight={{
                          content:
                            analysisResult && analysisResult[analysisResultIdx]
                              ? analysisResult[analysisResultIdx].args.join(" ")
                              : "",
                          source: "Guardrail",
                          type: "guardrail",
                        }}
                      />
                    </>
                  )}
                </div>
                <TraceView
                  inputData={inputData || "[]"}
                  traceId={"<none>"}
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
