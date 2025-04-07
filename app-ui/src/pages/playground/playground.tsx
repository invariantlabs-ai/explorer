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
import useVerify from "../../lib/verify";
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

const defaultPolicy = "";
const defaultInput = "[]";

function useLocallyStoredState<T>(key: string, defaultValue: T) {
  const [state, _setState] = useState(defaultValue);

  const store = (value: T) => {
    if (typeof value === "string") {
      localStorage.setItem(key, value);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  };

  const setState = (value: T) => {
    _setState(value);
    store(value);
  };

  store(defaultValue);
  return [state, setState] as const;
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
  const searchParams = new URLSearchParams(window.location.search);
  let policy_url = searchParams.get("policy");
  if (policy_url) {
    policy_url = Base64.decode(policy_url);
  }
  let input_url = searchParams.get("input");
  if (input_url) {
    input_url = Base64.decode(input_url);
    input_url = beautifyJson(input_url);
  }
  const policy_local = localStorage.getItem("policy");
  const input_local = localStorage.getItem("input");
  let policy: string | null = null;
  let input: string | null = null;
  if (policy_url || input_url) {
    policy = policy_url || defaultPolicy;
    input = input_url || defaultInput;
  } else {
    policy = policy_local || defaultPolicy;
    input = input_local || defaultInput;
  }

  const [policyCode, setPolicyCode] = useLocallyStoredState<string>(
    "policy",
    policy
  );
  const [inputData, setInputData] = useLocallyStoredState<string>(
    "input",
    input
  );

  const { width: screenWidth } = useWindowSize();
  const { verify, ApiKeyModal } = useVerify();
  const [policyEditorHeight, setPolicyEditorHeight] = useState<
    number | undefined
  >(undefined);

  // verification & highlight state
  const [loading, setLoading] = useState<boolean>(false);
  const [analysisResult, setAnalysisResult] = useState<PolicyError[] | null>(
    null
  );
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

    try {
      // Analyze the policy with the input data
      const analyzeResponse = await verify(JSON.parse(inputData), policyCode);
      if (analyzeResponse.status !== 200) {
        analyzeResponse.json().then((text) => {
          setLoading(false);
          console.error("Failed to evaluate policy:", text);
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
    } finally {
      setLoading(false); // End loading
    }
  };

  const getShareURL = () => {
    return `${window.location.origin}${window.location.pathname.replace("/embed", "")}?policy=${Base64.encode(policyCode)}&input=${Base64.encode(inputData)}`;
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
      encodeURIComponent(policyCode) +
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
                  value={policyCode}
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
                        className={"no-result " + (loading ? "is-loading" : "")}
                        onClick={handleEvaluate}
                      >
                        {loading ? <>Evaluating...</> : <>No matches found.</>}
                      </div>
                    )}
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
                  inputData={inputData}
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
