import { Editor } from "@monaco-editor/react";
import React, { useEffect, useState } from "react";
import { BsVinyl } from "react-icons/bs";
import "./Analyzer.scss";
import logo from "./assets/invariant.svg";

interface Analyzer {
  running: boolean;
  setRunning: (running: boolean) => void;
  status: string;
  setError: (error: any) => void;
  output: any;
  setOutput: (output: any) => void;

  reset: () => void;
}

export function useAnalyzer(): Analyzer {
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState(null);
  const [error, setError] = useState(null);

  const reset = () => {
    setOutput(null);
    setError(null);
  };

  return {
    running,
    setRunning,
    status: error || (running ? "Running..." : "Ready"),
    setError,
    output,
    setOutput,
    reset,
  };
}

export function AnalyzerOutput(props: {
  analyzerOutput: any;
  running: boolean;
  trace: any;
  storedOutput?: any;
}) {
  const { analyzerOutput, running } = props;
  const [issues, setIssues] = useState([] as any[]);

  // take analyzer output as list and sort by severity key
  useEffect(() => {
    let output = props.analyzerOutput;

    // if there is no current (just generated) analyzer output, parse the stored output instead
    if (!output) {
      output = [];
      try {
        for (let i = 0; i < props.storedOutput.length; i++) {
          if (props.storedOutput[i].source === "analyzer-model") {
            try {
              JSON.parse(props.storedOutput[i].content).forEach((item: any) => {
                output.push(item);
              });
            } catch (e) {
              console.error(
                "Failed to parse stored analyzer output:",
                props.storedOutput[i]
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
  }, [analyzerOutput, props.storedOutput]);

  if (!issues || !issues.length) {
    return null;
  }

  return (
    <div className="event analyzer-output">
      <b>
        <img src={logo} alt="Invariant logo" className="logo" />
        Invariant Analysis{" "}
        {running ? (
          <span className="secondary-flashing">Analyzing...</span>
        ) : (
          ""
        )}
      </b>
      {issues.map((output, i) =>
        output.loading ? (
          running ? (
            <Loading key="issues-loading" />
          ) : null
        ) : (
          <pre key={"issue-" + i}>{JSON.stringify(output, null, 2)}</pre>
        )
      )}
    </div>
  );
}

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

export function Analyzer(props: {
  open: boolean;
  traceId?: string;
  setAnalyzerOpen: (value: boolean) => void;
  analyzer: Analyzer;
}) {
  const [analyzerConfig, _setAnalyzerConfig] = React.useState(
    localStorage.getItem("analyzerConfig") ||
      (`{
  "model": "i01",
  "endpoint": "https://preview-explorer.invariantlabs.ai",
  "apikey": "<api key on the Explorer above>"
}` as string | undefined)
  );

  const [abortController, setAbortController] = React.useState(
    new AbortController()
  );

  const status = props.analyzer.status;

  const setAnalyzerConfig = (value: string | undefined) => {
    localStorage.setItem("analyzerConfig", value || "{}");
    _setAnalyzerConfig(value);
  };

  // on unmount, abort the analysis
  useEffect(() => {
    return () => {
      abortController.abort();
    };
  }, [abortController]);

  const onRun = () => {
    // props.setAnalyzerOpen(false);
    props.analyzer.setRunning(true);
    props.analyzer.setError(null);
    props.analyzer.setOutput([
      {
        loading: true,
      },
    ]);
    props.setAnalyzerOpen(false);

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

    // window.open(`/api/v1/trace/${trace_id}/download`, "_blank");
    fetch(`/api/v1/trace/${props.traceId}/download`)
      .then((response) => {
        response.text().then((traceData) => {
          const messages = JSON.parse(traceData).messages;
          const analysisInput = JSON.stringify(messages, null, 2);
          let ctrl = createAnalysis(
            config,
            analysisInput,
            props.analyzer.setRunning,
            props.analyzer.setError,
            props.analyzer.setOutput,
            endpoint,
            apikey
          );
          setAbortController(ctrl);
        });
      })
      .catch((error) => {
        console.error("Failed to download trace data:", error);
        props.analyzer.setRunning(false);
        props.analyzer.setError("Failed to download trace data");
      });
  };

  return (
    <div className={"analyzer" + (props.open ? " open" : "")}>
      <div className="box">
        <h2>
          Analyzer
          <button
            className="primary inline"
            onClick={onRun}
            disabled={props.analyzer.running}
          >
            {props.analyzer.running ? "Running..." : "Run"}
          </button>
        </h2>
        <Editor
          language="json"
          value={analyzerConfig}
          onChange={(value, model) => setAnalyzerConfig(value)}
          options={{
            minimap: {
              enabled: false,
            },
            lineNumbers: "off",
            wordWrap: "on",
          }}
        />
        <div className="status">{status}</div>
      </div>
    </div>
  );
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
  config: string | undefined,
  traceData: string,
  setRunning: (running: boolean) => void,
  setError: (status: string | null) => void,
  setOutput: (output: any) => void,
  baseurl: string,
  apikey: string
): AbortController {
  const abortController = new AbortController();
  const endpoint = baseurl + "/api/v1/analysis/create";

  const body = JSON.stringify({
    input: traceData,
    options: config,
  });

  async function startAnalysis() {
    try {
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
              setOutput((prev) => [...(prev || []), JSON.parse(chunk)]);
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
          }

          readStream(); // Continue streaming
        } catch (streamError: any) {
          console.error("Stream Read Error:", streamError);
          setRunning(false);
          setError(streamError.message);
          alert("Stream Read Error: " + streamError.message);
        }
      }

      readStream();
    } catch (error: any) {
      console.error("Analysis Error:", error);
      setRunning(false);
      setError(error.message);
      setOutput(null);
      if (error.message.includes("Unauthorized")) {
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
