import { Editor } from "@monaco-editor/react";
import React, { useCallback, useEffect, useState } from "react";
import {
  BsArrowRight,
  BsBan,
  BsGearFill,
  BsStars,
  BsXCircle,
} from "react-icons/bs";
import "./Analyzer.scss";
import logo from "../../assets/invariant.svg";
import { reveal } from "../../lib/permalink-navigator";
import { BroadcastEvent } from "../../lib/traceview/traceview";
import { capture } from "../../telemetry";
import { alertModelAccess } from "./ModelModal";

interface Analyzer {
  running: boolean;
  setRunning: (running: boolean) => void;
  status: string;
  setError: (error: any) => void;
  output: any;
  setOutput: (output: any) => void;

  // debugging info (if provided by the analysis model)
  debugInfo?: any;
  setDebug: (debug: any) => void;

  reset: () => void;
}

/**
 * Analyzer state hook.
 *
 * @returns Analyzer state
 */
export function useAnalyzer(): Analyzer {
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState(null);
  const [error, setError] = useState(null);
  const [debugInfo, setDebug] = useState(null);

  const reset = () => {
    setOutput(null);
    setError(null);
    setDebug(null);
  };

  return {
    running,
    setRunning,
    status: error || (running ? "Running..." : "Ready"),
    setError,
    output,
    setOutput,
    reset,
    debugInfo,
    setDebug,
  };
}

/**
 * Parses and sorts the issues from the analyzer output.
 */
function useIssues(analyzerOutput: any, storedOutput?: any) {
  const [issues, setIssues] = useState([] as any[]);

  // take analyzer output as list and sort by severity key
  useEffect(() => {
    let output = analyzerOutput;

    // if there is no current (just generated) analyzer output, parse the stored output instead
    if (!output) {
      output = [];
      try {
        for (let i = 0; i < storedOutput.length; i++) {
          if (storedOutput[i].source === "analyzer-model") {
            try {
              JSON.parse(storedOutput[i].content).forEach((item: any) => {
                output.push(item);
              });
            } catch (e) {
              console.error(
                "Failed to parse stored analyzer output:",
                storedOutput[i]
              );
            }
            break;
          }
        }
      } catch (e) {
        console.error("Failed to parse analyzer output:", output);
        output = null;
      }
    }

    if (!output) {
      setIssues([]);
    }
    let issues = output || [];

    // sort by severity
    issues.sort((a, b) => {
      if (a.severity < b.severity) {
        return 1;
      } else if (a.severity > b.severity) {
        return -1;
      }
      return 0;
    });

    // if length > 1 and loading still in there, remove it
    if (issues.length > 1 && issues[0].loading) {
      issues = issues.slice(1);
    }

    setIssues(issues);
  }, [analyzerOutput, storedOutput]);

  return issues;
}

/**
 * Displays a loading bar while the analysis is running.
 */
function Loading(props) {
  return (
    <div className="output-running">
      Analyzing...
      <div className="output-running-bar">
        <div className="output-running-bar-inner" />
      </div>
    </div>
  );
}

/**
 * Prepares the inputs for an analysis run. This is done client-side using the current user session, so the
 * analysis models do not need to pull in the data themselves (they are stateless).
 *
 * @param traceId ID of the analyzed trace
 * @param dataset_id ID of the dataset containing the trace
 * @param username Username of the current dataset.
 * @param dataset The current dataset name.
 */
async function prepareAnalysisInputs(
  traceId: string,
  dataset_id?: string,
  username?: string,
  dataset?: string
) {
  try {
    // get trace data
    const traceRes = fetch(`/api/v1/trace/${traceId}/download`);
    // get additional context from dataset (if available)
    const contextRes = dataset_id
      ? fetch(`/api/v1/dataset/byid/${dataset_id}/download/annotated`)
      : Promise.resolve(null);

    // wait for both to load
    const [traceResponse, contextResponse] = await Promise.all([
      traceRes,
      contextRes,
    ]);

    // check that they ar eok
    if (!traceResponse.ok) {
      throw new Error(
        `Failed to fetch trace data: HTTP ${traceResponse.status}`
      );
    }

    const traceData = await traceResponse.json();
    const trace = traceData.messages;

    let context = "";
    if (contextResponse) {
      if (!contextResponse.ok) {
        throw new Error(
          `Failed to fetch dataset context: HTTP ${contextResponse.status}`
        );
      }
      context = await contextResponse.text();
    }

    return {
      trace,
      context: {
        index: traceData.index,
        explorer_tracedata: context,
        user: username,
        dataset: dataset,
      },
    };
  } catch (error) {
    console.error("prepareAnalysis error:", error);
    throw error;
  }
}

const TEMPLATE_API_KEY = "<api key on the Explorer above>";

/**
 * Creates a new analysis (streams in results) and returns an AbortController to cancel it.
 *
 * @param config Configuration for the analysis
 * @param trace Trace to analyze
 * @param setRunning Function to set the running state
 * @param setError Function to set the error state
 * @param setOutput Function to set the output state
 *
 * @returns AbortController to cancel the analysis
 */
function createAnalysis(
  config: string | undefined,
  traceData: string,
  setRunning: (running: boolean) => void,
  setError: (status: string | null) => void,
  setOutput: (output: any) => void,
  baseurl: string,
  apikey: string,
  context: any,
  setDebug?: (debug: any) => void
): AbortController {
  const abortController = new AbortController();
  const endpoint = baseurl + "/api/v1/analysis/create";

  const body = JSON.stringify({
    input: traceData,
    options: config,
    context: context,
  });

  async function startAnalysis() {
    try {
      if (apikey == TEMPLATE_API_KEY) {
        throw new Error("Unauthorized: Please provide a valid API key.");
      }

      setRunning(true);
      const response = await fetch(endpoint, {
        method: "POST",
        body,
        headers: {
          Authorization: "Bearer " + apikey,
        },
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      if (!response.body) throw new Error("Response body is null");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let receivedError = false;

      async function readStream() {
        try {
          const { value, done } = await reader.read();
          if (done) {
            setRunning(false);
            if (!receivedError) setError(null);
            return;
          }

          let chunk = decoder.decode(value, { stream: true });

          if (chunk.startsWith("data: ")) {
            chunk = chunk.slice(6); // Remove "data: "
            try {
              const chunk_data = JSON.parse(chunk);
              // handle debug messages separately
              if (chunk_data.debug) {
                if (setDebug) {
                  setDebug(chunk_data.debug);
                }
              } else {
                setOutput((prev) => [...(prev || []), chunk_data]);
              }
            } catch {
              setOutput((prev) => [
                ...(prev || []),
                { type: "error", content: "ERROR: " + chunk },
              ]);
            }
          } else if (chunk.startsWith("error: ")) {
            setRunning(false);
            setError(chunk.slice(7)); // Remove "error: "
            receivedError = true;
            alert("Analysis Error: " + chunk.slice(7));
          }

          readStream(); // Continue streaming
        } catch (streamError: any) {
          if ("was aborted" in streamError.toString()) {
            setRunning(false);
            setError("Analysis was aborted");
            return;
          }
          console.error("Stream Read Error:", streamError);
          setRunning(false);
          setError(streamError.message);
          setOutput(null);
          alert("Stream Read Error: " + streamError.message);
        }
      }

      readStream();
    } catch (error: any) {
      console.error("Analysis Error:", error);
      setRunning(false);
      setError(error.message);
      setOutput(null);

      if (
        // in case the server says the user is not whitelisted
        error.message.includes("do not have access to this resource") ||
        // in case a user just clicks 'Analyze' with an empty config
        apikey == TEMPLATE_API_KEY
      ) {
        capture("tried-analysis", { error: error.message });
        // alert("Unauthorized: You do not have access to this resource.");
        alertModelAccess("You do not have access to this resource.");
        return;
      } else if (error.message.includes("Unauthorized")) {
        alert(
          "Unauthorized: Please provide a valid API key to use an analysis model."
        );
        return;
      }

      alert("Analysis Error: " + error.message);
    }
  }

  startAnalysis();
  return abortController;
}

export function AnalyzerPreview(props: {
  open: boolean;
  setAnalyzerOpen: (open: boolean) => void;
  output: any;
  storedOutput;
  analyzer: Analyzer;
  running: boolean;
  onRunAnalyzer?: BroadcastEvent;
}) {
  const issues = useIssues(props.output, props.storedOutput);

  const numIssues = issues.filter((i) => !i.loading).length;

  const storedIsEmpty = !props.storedOutput?.filter((o) => o.length > 0).length;
  const outputIsEmpty =
    !props.output ||
    (props.output.filter((o) => !o.loading).length === 0 && !props.running);

  const notYetRun =
    storedIsEmpty && outputIsEmpty && !props.running && numIssues === 0;

  let content: React.ReactNode = null;

  const onAnalyze = (e) => {
    e.stopPropagation();
    props.setAnalyzerOpen(true);
    props.onRunAnalyzer?.fire(null);
  };

  if (notYetRun) {
    content = (
      <div className="secondary">
        <BsStars className="icon" />
        Analyze this trace to identify issues
        {props.onRunAnalyzer && (
          <button className="inline primary" onClick={onAnalyze}>
            Analyze
            <span className="shortcut">
              <kbd>Ctrl</kbd>+<kbd>R</kbd>
            </span>
          </button>
        )}
      </div>
    );
  } else if (props.running) {
    content = (
      <div className="secondary">
        <div className="analyzer-loader big" /> Analyzing...
        {numIssues > 0 && (
          <span className="num-issues">
            {"(" + numIssues + " issue" + (numIssues > 1 ? "s" : "") + ")"}
          </span>
        )}
      </div>
    );
  } else if (numIssues === 0) {
    content = (
      <div className="output-empty">
        <BsXCircle />
        <br />
        No issues found
        <a className="action" onClick={onAnalyze}>
          Rerun
        </a>
      </div>
    );
  } else {
    content = (
      <>
        <div className="secondary">
          <img src={logo} alt="Invariant logo" className="logo" />
          Analysis has identified {issues.length} issue
          {issues.length > 1 ? "s" : ""}
          {!props.open && <BsArrowRight className="arrow" />}
          <a className="action" onClick={onAnalyze}>
            Rerun
          </a>
        </div>
      </>
    );
  }

  // ctrl+r shortcut
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "r" && e.ctrlKey) {
        if (!props.open) {
          props.setAnalyzerOpen(true);
        }
        props.onRunAnalyzer?.fire(null);
      }
    };
    document.addEventListener("keydown", onKeydown);
    return () => {
      document.removeEventListener("keydown", onKeydown);
    };
  }, [props.open, props.onRunAnalyzer]);

  return (
    <div
      className="event analyzer-hint"
      onClick={() => props.setAnalyzerOpen(!props.open)}
    >
      {content}
    </div>
  );
}

/**
 * Sidebar for the analysis of a trace.
 */
export function AnalyzerSidebar(props: {
  open: boolean;
  output: any;
  running: boolean;
  analyzer: Analyzer;
  storedOutput;
  traceId: string;
  datasetId: string;
  username: string;
  dataset: string;
  debugInfo: any;
  onDiscardAnalysisResult?: (output: any) => void;
  // passes onRun to parent component in callback
  onAnalyzeEvent?: BroadcastEvent;
}) {
  const [analyzerConfig, _setAnalyzerConfig] = React.useState(
    localStorage.getItem("analyzerConfig") ||
      (`{
  "model": "i01",
  "endpoint": "https://preview-explorer.invariantlabs.ai",
  "apikey": "${TEMPLATE_API_KEY}"
}` as string | undefined)
  );

  const setAnalyzerConfig = (value: string | undefined) => {
    localStorage.setItem("analyzerConfig", value || "{}");
    _setAnalyzerConfig(value);
  };

  const [abortController, setAbortController] = React.useState(
    new AbortController()
  );

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [status, setStatus] = useState("Ready");

  const issues = useIssues(props.output, props.storedOutput);
  const numIssues = issues.filter((i) => !i.loading).length;

  const storedIsEmpty = !props.storedOutput?.filter((o) => o.length > 0).length;
  const outputIsEmpty =
    !props.output ||
    (props.output.filter((o) => !o.loading).length === 0 && !props.running);

  const notYetRun =
    storedIsEmpty && outputIsEmpty && !props.running && numIssues === 0;

  // on unmount, abort the analysis
  useEffect(() => {
    return () => {
      abortController.abort();
    };
  }, [abortController]);

  // on change of trace abort
  // on unmount, abort the analysis
  useEffect(() => {
    props.analyzer.setRunning(false);
    abortController.abort();
  }, [props.traceId]);

  const onRun = useCallback(async () => {
    // props.setAnalyzerOpen(false);
    props.analyzer.setRunning(true);
    props.analyzer.setError(null);
    props.analyzer.setDebug(null);
    props.analyzer.setOutput([
      {
        loading: true,
      },
    ]);

    let config = "{}" as any;
    try {
      config = JSON.parse(analyzerConfig || "{}");
    } catch (e) {
      alert("Analyzer: invalid configuration " + e);
      return;
    }

    let endpoint =
      config.endpoint ||
      "https://preview-explorer.invariantlabs.ai/api/v1/analysis/create";
    let apikey = config.apikey || "";
    if (!apikey) {
      delete config.apikey;
    }

    if (!props.traceId) {
      console.error("analyzer: no trace ID provided");
      return;
    }

    try {
      const { trace, context } = await prepareAnalysisInputs(
        props.traceId,
        props.datasetId,
        props.username,
        props.dataset
      );

      let ctrl = createAnalysis(
        config,
        JSON.stringify(trace, null, 2),
        props.analyzer.setRunning,
        props.analyzer.setError,
        props.analyzer.setOutput,
        endpoint,
        apikey,
        context,
        props.analyzer.setDebug
      );
      setAbortController(ctrl);
    } catch (error) {
      props.analyzer.setRunning(false);
      props.analyzer.setError(error + "");
      props.analyzer.setOutput(null);
      setStatus(error + "");
    }
  }, [
    props.analyzer,
    props.traceId,
    props.datasetId,
    props.username,
    props.dataset,
    analyzerConfig,
  ]);

  if (props.onAnalyzeEvent) {
    props.onAnalyzeEvent.listeners = [onRun];
  }

  return (
    <div
      className={"box analyzer-sidebar sidebar " + (props.open ? "open" : "")}
    >
      <h2>
        {props.running ? (
          <div className="analyzer-loader" />
        ) : (
          <img src={logo} alt="Invariant logo" className="logo" />
        )}
        Analysis
        <div className="spacer" />
        {!notYetRun && !props.running && props.onDiscardAnalysisResult && (
          <button
            className="inline icon"
            onClick={() => props.onDiscardAnalysisResult?.(props.storedOutput)}
            data-tooltip-id="highlight-tooltip"
            data-tooltip-content="Discard Results"
          >
            <BsBan />
          </button>
        )}
        <button
          className="inline icon"
          onClick={() => setSettingsOpen(!settingsOpen)}
          data-tooltip-id="highlight-tooltip"
          data-tooltip-content={
            settingsOpen ? "Hide Settings" : "Show Settings"
          }
        >
          <BsGearFill />
        </button>
        {props.running && abortController && (
          <button
            className="inline"
            onClick={() => {
              abortController.abort();
              props.analyzer.setRunning(false);
            }}
            data-tooltip-id="highlight-tooltip"
            data-tooltip-content="Stop Analysis"
          >
            Cancel
          </button>
        )}
        <button
          className="primary inline"
          onClick={onRun}
          disabled={props.running}
        >
          {props.running ? "Running..." : "Analyze"}
        </button>
      </h2>
      {settingsOpen && (
        <>
          <Editor
            language="json"
            theme="vs-dark"
            className="analyzer-config"
            value={analyzerConfig}
            onMount={onMountConfigEditor}
            onChange={(value, model) => setAnalyzerConfig(value)}
            height="200pt"
            options={{
              minimap: {
                enabled: false,
              },
              lineNumbers: "off",
              wordWrap: "on",
            }}
          />
        </>
      )}
      <div className="status">{status}</div>
      <div className="issues">
        {issues.map((output, i) =>
          output.loading ? (
            props.running ? (
              <Loading key="issues-loading" />
            ) : null
          ) : (
            <Issues key={props.traceId + "-" + "issue-" + i} issue={output} />
          )
        )}
      </div>
      {notYetRun && (
        <div className="output-empty">
          <br />
          Analyze the trace to identify issues
        </div>
      )}
      <span className="debug-info">
        {props.debugInfo?.stats &&
          props.debugInfo?.stats.length > 0 &&
          props.debugInfo.stats.map((stat: any, i: number) => (
            <span key={"stat-" + i} className="stat">
              {stat}
            </span>
          ))}
        {props.debugInfo?.traces?.map((trace: string, i: number) => (
          <a
            key={"trace-url-" + i}
            href={trace}
            target="_blank"
            rel="noreferrer"
          >
            View Trace
          </a>
        ))}
      </span>
    </div>
  );
}

function onMountConfigEditor(editor, monaco) {
  // register completion item provider
  monaco.languages.registerCompletionItemProvider("json", {
    provideCompletionItems: function (model, position) {
      return {
        suggestions: [
          {
            label: "local",
            kind: monaco.languages.CompletionItemKind.Text,
            insertText: `{
"model": "i01",
"endpoint": "http://localhost:8000",
"apikey": "<not needed>"
}`,
          },
          {
            label: "preview",
            kind: monaco.languages.CompletionItemKind.Text,
            insertText: `{
"model": "i01",
"endpoint": "https://preview-explorer.invariantlabs.ai",
"apikey": "${TEMPLATE_API_KEY}"
}`,
          },
        ],
      };
    },
  });
}

export function Issues(props: {
  issue: object & { severity: number; content: string; location: string };
}) {
  // content: [abc] content
  let errorContent = "";
  let content = props.issue.content;
  if (content && content.match(/\[.*\]/)) {
    let start = content.indexOf("[");
    let end = content.indexOf("]");
    errorContent = content.substring(start + 1, end);
    content = content.substring(0, start) + content.substring(end + 1);
  }

  const first_location =
    locations(props.issue.location).length > 0
      ? locations(props.issue.location)[0]
      : "";

  const [clickLocation, setClickLocation] = useState(first_location);

  const onNextLocation = () => {
    const locs = locations(props.issue.location);
    let idx = locs.indexOf(clickLocation);
    idx = (idx + 1) % locs.length;
    setClickLocation(locs[idx]);
  };

  // reset click location when issue changes
  useEffect(() => {
    setClickLocation(first_location);
  }, [props.issue]);

  return (
    <div
      className="issue"
      onClick={() => {
        reveal(clickLocation);
        onNextLocation();
      }}
    >
      <div className="issue-content">
        <b>[{errorContent}]</b> {content}
      </div>
      <div className="issue-header">
        <Location location={props.issue.location} />
        <br />
        {typeof props.issue.severity === "number" && (
          <span className="severity">
            Severity: {(props.issue.severity || 0.0).toString()}
          </span>
        )}
      </div>
    </div>
  );
}

export function Location(props: { location: string }) {
  // location is either a single location, or a comma+space separated list of locations
  let locations = props.location?.split(", ") || [];
  return (
    <div className="locations">
      {locations.map((location, i) => (
        <div
          key={"loc-" + i}
          className="location"
          onClick={(e) => {
            e.stopPropagation();
            reveal(location);
          }}
        >
          {location}
        </div>
      ))}
    </div>
  );
}

function locations(locs: string) {
  if (!locs) return [];
  return locs.split(", ");
}
