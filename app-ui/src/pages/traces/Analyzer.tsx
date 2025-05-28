import React, { useCallback, useEffect, useState } from "react";
import {
  BsArrowRight,
  BsBan,
  BsCheck,
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
import { AnalysisConfigEditor, getAnalysisConfig, useAnalysisConfig } from "../../lib/AnalysisAPIAccess";

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
    let issues = annotations || ([] as AnalyzerAnnotation[]);

    if (!issues) {
      setIssues([]);
      return;
    }

    // Define the sort order for status
    const statusOrder = (status: string | undefined, reasoning: boolean) => {
      // for 'reasoning' we show at the start
      if (reasoning) return 0;
      if (status === "accepted") return 1;
      if (status === "rejected") return 3;
      return 2; // Proposed (no status or other statuses)
    };

    // sort by status, then by severity
    issues.sort((a, b) => {
      const statusA = statusOrder(a.status, a.content.includes("[reasoning]"));
      const statusB = statusOrder(b.status, b.content.includes("[reasoning]"));

      if (statusA !== statusB) {
        return statusA - statusB;
      }

      // If status is the same, sort by severity
      if ((a.severity || 0) < (b.severity || 0)) {
        return 1;
      } else if ((a.severity || 0) > (b.severity || 0)) {
        return -1;
      }
      return 0;
    });

    setIssues(issues);
  }, [annotations]);

  return issues;
}

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
  apikey: string | undefined,
  setRunning: (running: boolean) => void,
  setError: (status: string | null) => void,
  setOutput: (output: any) => void,
  setDebug?: (debug: any) => void,
  onAnnotationChange?: () => void
): AbortController {
  const abortController = new AbortController();

  const body = JSON.stringify({
    apiurl: apiurl,
    apikey: apikey,
    options: options,
  });

  async function startAnalysis() {
    try {
      const url = `/api/v1/trace/${trace_id}/analysis`;
      setRunning(true);
      setOutput((prev) => []);
      if (onAnnotationChange) onAnnotationChange();
      const response = await fetch(url, {
        method: "POST",
        body,
        headers: {
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
        // reload annotations from backend on 'update'
        if (event.data === "update" && onAnnotationChange) {
          onAnnotationChange();
        }
        // check for error events
        if (event.data) {
          try {
            const chunk_data = JSON.parse(event.data);
            if (chunk_data.content) {
              if (onAnnotationChange) onAnnotationChange();
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
      // refresh once in the end (e.g. the loop above might not have called, if there are no issues)
      if (onAnnotationChange) {
        onAnnotationChange();
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
        error.message.includes("do not have access to this resource")
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

  const numIssues = issues.filter((issue) => !issue.content.includes("[reasoning]")).length;

  const storedIsEmpty = numIssues === 0;

  const notYetRun = storedIsEmpty && !props.running && numIssues === 0;

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
        <div className="analyzer-loader big" /> <span className="effect-shine">Analyzing...</span>
      </div>
    );
  } else if (numIssues === 0) {
    content = (
      <div className="output-empty">
        <BsXCircle />
        <br />
        No Issues Detected
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
  // expects callback function to discard the analysis result
  onDiscardAnalysisResult?: (output: any) => void;
  // passes onRun to parent component in callback
  onAnalyzeEvent?: BroadcastEvent;
  onAnnotationChange?: () => void;
  // callbacks to accept/reject issues
  onAcceptAnalysisResult?: (output: any) => void;
  onRejectAnalysisResult?: (output: any) => void;
}) {
  const [abortController, setAbortController] = React.useState(
    new AbortController()
  );

  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const issues = useIssues(props.annotations);
  const numIssues = issues.filter((issue) => !issue.content.includes("[reasoning]")).length;

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

    if (!props.traceId) {
      console.error("analyzer: no trace ID provided");
      return;
    }

    const analysisConfig = getAnalysisConfig();

    try {
      let ctrl = createAnalysis(
        props.traceId,
        analysisConfig as any,
        analysisConfig.endpoint,
        analysisConfig.apikey,
        props.analyzer.setRunning,
        props.analyzer.setError,
        props.analyzer.setOutput,
        props.analyzer.setDebug,
        props.onAnnotationChange
      );
      setAbortController(ctrl);
    } catch (error) {
      props.analyzer.setRunning(false);
      props.analyzer.setError(error + "");
      props.analyzer.setOutput(null);
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

  let currentGroup = "";

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
          aria-label="Toggle Settings"
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
          <AnalysisConfigEditor/>
        </>
      )}
      <div className="status">{props.analyzer.status}</div>
      <div className="issues">
        {!props.running &&
          issues.map((output, i) => {
            let header = null as React.ReactNode | null;
            if (output.status === "accepted" && currentGroup !== "accepted") {
              currentGroup = "accepted";
            } else if (
              output.status === "rejected" &&
              currentGroup !== "rejected"
            ) {
              header = <h3 className="issues-group-header">
                <BsXCircle className="icon" />  
                Rejected
              </h3>;
              currentGroup = "rejected";
            } else if (
              (!output.status || output.status === "proposed") &&
              currentGroup !== "proposed"
            ) {
              currentGroup = "proposed";
            }

            return (
              <React.Fragment key={props.traceId + "-" + "issue-" + i + "-" + output.content}>
                {header}
                <Issues
                  issue={output}
                  onAcceptAnalysisResult={props.onAcceptAnalysisResult}
                  onRejectAnalysisResult={props.onRejectAnalysisResult}
                />
              </React.Fragment>
            );
          })}
      </div>
      {notYetRun && (
        <div className="output-empty">
          <br />
          Analyze the trace to identify issues
        </div>
      )}
      {!notYetRun && !props.running && numIssues === 0 && (
        <div className="output-empty">
          No Issues Detected
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

export function Issues(props: { 
  issue: AnalyzerAnnotation, 
  onAcceptAnalysisResult?: (output: any) => void, 
  onRejectAnalysisResult?: (output: any) => void 
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

  const onClickIssue = (e: React.MouseEvent) => {
    e.stopPropagation();
    reveal(clickLocation);
    onNextLocation();
  }
  
  // loading states for accept/reject buttons
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const onClickAccept = async (e: React.MouseEvent) => {
    setConfirming(true);
    e.stopPropagation();
    if (props.onAcceptAnalysisResult) {
      try {
        await props.onAcceptAnalysisResult(props.issue);
      } finally {
        setConfirming(false);
      }
    } 
  }

  const onClickReject = async (e: React.MouseEvent) => {
    setRejecting(true);
    e.stopPropagation();
    if (props.onRejectAnalysisResult) {
      try {
        await props.onRejectAnalysisResult(props.issue);
      } finally {
        setRejecting(false);
      }
    }
  }

  // whether the issue should be shown in collapsed mode (less info)
  const collapsed = props.issue.status === "rejected";

  // reasoning expanded
  const [expanded, setExpanded] = useState(false);

  // check for the case of errorContent == "reasoning"
  // if so, show a special issue
  if (errorContent === "reasoning" && content.split("|", 2).length > 1) {
    // check if there is an | in the content (if so, split it)
    const splitContent = content.split("|", 2);
    const reasoning = splitContent[1].trim();
    const reasoningTime = splitContent[0].trim();

    return (
      <div className={"issue reasoning " + (expanded ? "expanded" : "")} onClick={() => setExpanded(!expanded)}>
        <div className="issue-content">
          {expanded ? <><b>{reasoningTime}</b>{reasoning}</> : <><b>{reasoningTime + " 〉"}</b></>}
        </div>
      </div>
    );
  }

  return (
    <div
      className={"issue " + props.issue.status}
      onClick={onClickIssue}
    >
      <div className="issue-content">
        {!collapsed ? (
          <><b>[{errorContent}]</b> {content}</>
        ) : (
          <><b>[{errorContent}]</b> <s>{truncate(content, 50)}</s></>
        )}
      </div>
      <div className="issue-header">
        {!collapsed && <Location location={props.issue.address} />}
        <br />
        {typeof props.issue.severity === "number" && (
          <span className="severity">
            Severity: {(props.issue.severity || 0.0).toString()}
          </span>
        )}
        <div className={"issue-status " + props.issue.status}>
          {props.issue.status === "accepted" && (
            <>
              <BsCheck className="icon" />
              Confirmed
            </>
          )}
          {props.issue.status === "rejected" && (
            <>
              <BsXCircle className="icon" />
              Rejected
            </>
          )}
        </div>
        <div className="actions">
        <button
          className={"inline reject " + (props.issue.status === "rejected" ? " primary" : "")}
          onClick={onClickReject}
          disabled={rejecting}
        >
          <BsXCircle /> Reject
        </button>
        <button className={"inline" + (props.issue.status === "accepted" ? " primary" : "")} onClick={onClickAccept} disabled={confirming}>
          <BsCheck /> Confirm
        </button>
        </div>
      </div>
    </div>
  );
}

function truncate(str: string, maxLength: number) {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength) + "...";
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
            reveal(location, "annotations");
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
