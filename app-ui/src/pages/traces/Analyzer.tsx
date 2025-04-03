import { Editor } from "@monaco-editor/react";
import React, { useCallback, useEffect, useState } from "react";
import {
  BsArrowRight,
  BsBan,
  BsGearFill,
  BsStars,
  BsXCircle,
} from "react-icons/bs";
import { AnalyzerAnnotation } from ".././../lib/traceview/highlights";

import "./Analyzer.scss";
import logo from "../../assets/invariant.svg";
import { reveal } from "../../lib/permalink-navigator";
import { BroadcastEvent } from "../../lib/traceview/traceview";
import { capture } from "../../utils/Telemetry";
import { alertModelAccess } from "./ModelModal";

import { events } from "fetch-event-stream";
import { useUserInfo } from "../../utils/UserInfo";

// Job status values
export const JOB_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

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
function useIssues(annotations?: AnalyzerAnnotation[]): AnalyzerAnnotation[] {
  const [issues, setIssues] = useState([] as any[]);

  // take analyzer output as list and sort by severity key
  useEffect(() => {
    let issues = annotations || [] as AnalyzerAnnotation[];

    if (!issues) {
      setIssues([]);
    }
    // sort by severity
    issues.sort((a, b) => {
      if (a.severity || 0 < (b.severity || 0)) {
        return 1;
      } else if (a.severity || 0 > (b.severity || 0)) {
        return -1;
      }
      return 0;
    });
  
    // if length > 1 and loading still in there, remove i

    setIssues(issues);
  }, [annotations]);

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

export const TEMPLATE_API_KEY = "<api key on the Explorer above>";

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
  trace_id: string,
  options: string,
  apiurl: string,
  apikey: string,
  setRunning: (running: boolean) => void,
  setError: (status: string | null) => void,
  setOutput: (output: any) => void,
  setDebug?: (debug: any) => void,
  onAnnotationChange?: () => void,
): AbortController {
  const abortController = new AbortController();

  const body = JSON.stringify({
    apiurl: apiurl,
    apikey: apikey,
    options: options,
  });

  async function startAnalysis() {
    try {
      if (apikey == TEMPLATE_API_KEY) {
        throw new Error("Unauthorized: Please provide a valid API key.");
      }
      const url = `/api/v1/trace/${trace_id}/analysis`;
      setRunning(true);
      setOutput((prev) => []);
      if (onAnnotationChange)
        onAnnotationChange()
      const response = await fetch(url, {
        method: "POST",
        body,
        headers: {
          Authorization: "Bearer " + apikey,
          "Content-Type": "application/json",
        },
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      if (!response.body) throw new Error("Response body is null");

      let receivedError = false;

      let stream = events(response, abortController.signal);
      let event: any = null;

      for await (event of stream) {
        if (event.data === "update" && onAnnotationChange){
          onAnnotationChange()
        }
        if (event.data) {
          try {
            const chunk_data = JSON.parse(event.data);
            if (chunk_data.content) {
              if (onAnnotationChange)
                onAnnotationChange()
            }
            if (chunk_data.debug) {
              if (setDebug) {
                setDebug(chunk_data.debug);
              }
            }
            if (chunk_data.error) {
              receivedError = true;
              if (setError) {
                setError(chunk_data.error);
                alert("Analysis Error: " + chunk_data.error);
              }
            }

          } catch {
            setOutput((prev) => [
              ...(prev || []),
              { type: "error", content: "ERROR: " + event.data },
            ]);
          }
        }
      }
      setRunning(false);
      if (!receivedError) setError(null);
    } catch (error: any) {
      setRunning(false);
      setError(error.message);
      setOutput(null);

      if (
        // in case the user aborts the fetch
        error.toString().includes("Fetch is aborted")
      ) {
        setRunning(false);
        setError("Analysis was aborted");
        return;
      } else if (
        // in case the server says the user is not whitelisted
        error.message.includes("do not have access to this resource") ||
        // in case a user just clicks 'Analyze' with an empty config
        apikey == TEMPLATE_API_KEY
      ) {
        capture("tried-analysis", { error: error.message });
        alertModelAccess("Please provide a valid API key (see settings)");
        return;
      } else if (error.message.includes("Unauthorized")) {
        alert(
          "Unauthorized: Please provide a valid API key to use an analysis model."
        );
        return;
      } else {
        alert("Analysis Error: " + error.message);
      }
    }
  }

  startAnalysis();
  return abortController;
}

export function AnalyzerPreview(props: {
  open: boolean;
  setAnalyzerOpen: (open: boolean) => void;
  output: any;
  annotations: AnalyzerAnnotation[];
  analyzer: Analyzer;
  running: boolean;
  onRunAnalyzer?: BroadcastEvent;
}) {
  const issues = useIssues(props.annotations);

  const numIssues = issues.length;

  const storedIsEmpty = numIssues === 0;

  const notYetRun =
    storedIsEmpty && !props.running && numIssues === 0;

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
        <span className="empty-msg">Analyze this trace to identify issues</span>
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
          Offline Analysis has identified {issues.length} issue
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

function parseConfig(analyzerConfig: string | undefined): {
  config: any;
  endpoint: string;
  apikey: string;
} {
  let config = "{}" as any;
  try {
    config = JSON.parse(analyzerConfig || "{}");
  } catch (e) {
    alert("Analyzer: invalid configuration " + e);
    throw e;
  }

  let endpoint =
    config.endpoint || "https://preview-explorer.invariantlabs.ai/";
  let apikey = config.apikey || "";
  delete config.apikey;
  delete config.endpoint;
  return { config, endpoint, apikey };
}

export function AnalyzerConfigEditor(props: { configType: string }) {
  const [analyzerConfig, _setAnalyzerConfig] = React.useState(
    localStorage.getItem("analyzerConfig-" + props.configType) ||
      (`{
  "endpoint": "https://preview-explorer.invariantlabs.ai",
  "apikey": "${TEMPLATE_API_KEY}",
  "model_params": {
    "model": "litellm",
    "options":{
      "lite_llm_model": "openai/gpt-4o",
      "retriever": {"k" : 1}
    }
  }
}` as string | undefined)
  );

  const setAnalyzerConfig = (value: string | undefined) => {
    localStorage.setItem("analyzerConfig-" + props.configType, value || "{}");
    _setAnalyzerConfig(value);
  };

  return (
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
  );
}

export function clientAnalyzerConfig(configType: string) {
  return parseConfig(
    localStorage.getItem("analyzerConfig-" + configType) || "{}"
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
  annotations: AnalyzerAnnotation[];
  traceId: string;
  datasetId: string;
  username: string;
  dataset: string;
  debugInfo: any;
  onDiscardAnalysisResult?: (output: any) => void;
  // passes onRun to parent component in callback
  onAnalyzeEvent?: BroadcastEvent;
  onAnnotationChange?: () => void;
}) {
  const [abortController, setAbortController] = React.useState(
    new AbortController()
  );

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [status, setStatus] = useState("Ready");

  const issues = useIssues(props.annotations);
  const numIssues = issues.length;

  const userInfo = useUserInfo();

  const storedIsEmpty = props.annotations.length === 0;
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
    if (!userInfo?.loggedIn) {
      alertModelAccess("Please log in and try again");
      return;
    }

    props.analyzer.setRunning(true);
    props.analyzer.setError(null);
    props.analyzer.setDebug(null);
    props.analyzer.setOutput([
      {
        loading: true,
      },
    ]);

    const { config, endpoint, apikey } = clientAnalyzerConfig("single");
    if (!props.traceId) {
      console.error("analyzer: no trace ID provided");
      return;
    }

    try {
      let ctrl = createAnalysis(
        props.traceId,
        config,
        endpoint,
        apikey,
        props.analyzer.setRunning,
        props.analyzer.setError,
        props.analyzer.setOutput,
        props.analyzer.setDebug,
        props.onAnnotationChange,
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
            onClick={() => props.onDiscardAnalysisResult?.(props.annotations)}
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
          <AnalyzerConfigEditor configType="single" />
        </>
      )}
      <div className="status">{status}</div>
      <div className="issues">
        {issues.map((output, i) =>(
            <Issues
              key={props.traceId + "-" + "issue-" + i + "-" + output.content}
              issue={output}
            />
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
  "endpoint": "http://host.docker.internal:8010",
  "apikey": "<api key on the Eplorer above>",
  "model_params": {
    "model": "litellm",
    "options":{
      "lite_llm_model": "openai/gpt-4o",
      "retriever": {"k" : 1}
    }
  }
}`,
          },
          {
            label: "preview",
            kind: monaco.languages.CompletionItemKind.Text,
            insertText: `{
  "endpoint": "https://preview-explorer.invariantlabs.ai",
  "apikey": "${TEMPLATE_API_KEY}",
  "model_params": {
    "model": "litellm",
    "options":{
      "lite_llm_model": "openai/gpt-4o",
      "retriever": {"k" : 1}
    }
  }
}`,
          },
        ],
      };
    },
  });
}

export function Issues(props: {
  issue: AnalyzerAnnotation;
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
    locations(props.issue.address).length > 0
      ? locations(props.issue.address)[0]
      : "";

  const [clickLocation, setClickLocation] = useState(first_location);

  const onNextLocation = () => {
    const locs = locations(props.issue.address);
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
        <Location location={props.issue.address} />
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
