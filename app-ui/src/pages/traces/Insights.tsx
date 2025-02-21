import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Time } from "../../components/Time";
import {
  AnalyzerConfigEditor,
  clientAnalyzerConfig,
  prepareDatasetAnalysisInputs,
} from "./Analyzer";
import {
  BsArrowCounterclockwise,
  BsExclamationCircle,
  BsExclamationCircleFill,
  BsGearFill,
} from "react-icons/bs";

import "./Analyzer.scss";
import IssuePieChart from "./Charts";

export function useJSONParse<T>(json: string | null): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (json) {
      try {
        const parsed = JSON.parse(json);
        setData(parsed);
      } catch (e) {
        console.error("Failed to parse JSON", e);
      }
    }
  }, [json]);
  return data;
}

export interface ReportFormat {
  last_updated?: string;
  num_results?: number;
  clustering?: any;
  options?: any;
}

/**
 * Shows pushed analysis reports if available for a dataset (e.g. via dataset metadata).
 *
 * This component is rendered as a separate tab in the dataset view.
 */
export function Insights(props: {
  dataset: any;
  datasetLoadingError: any;
  username: string;
  datasetname: string;
  onRefreshReport?: () => void;
}) {
  const rawReport = props.dataset?.extra_metadata?.analysis_report;
  const report = useJSONParse(rawReport) as ReportFormat | null;

  const last_updated = report?.last_updated;

  const [showConfigEditor, setShowConfigEditor] = useState(false);

  const [jobs, setJobs] = useState(null as any[] | null);

  const refreshJobs = async () => {
    const url = `/api/v1/dataset/byid/${props.dataset.id}/jobs`;

    const response = await fetch(url)
      .then((r) => r.json())
      .then((r) => {
        setJobs(r);
        if (r.length === 0 && props.onRefreshReport) {
          props.onRefreshReport();
        }
      });
  };

  // refresh regularly (if there are jobs)
  useEffect(() => {
    const interval = setInterval(() => {
      if ((jobs || []).length > 0) {
        refreshJobs();
      }
    }, 500);
    return () => clearInterval(interval);
  }, [jobs]);

  const onStartJob = async () => {
    const { config, endpoint, apikey } = clientAnalyzerConfig("dataset");

    const url = `/api/v1/dataset/byid/${props.dataset.id}/analysis`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apikey}`,
      },
      body: JSON.stringify({
        endpoint: endpoint,
        apikey: apikey,
        options: config,
      }),
    })
      .then((r) => {
        if (!r.ok) {
          r.text().then((t) => console.error(t));
          throw new Error("Failed to start analysis job");
        }

        return r.json();
      })
      .then((r) => {
        setJobs((jobs) => [...(jobs || []), r]);
        refreshJobs();
      })
      .catch((e) => {
        alert("Failed to start analysis job");
        console.error(e);
      });
  };

  useEffect(() => {
    refreshJobs();
  }, []);

  return (
    <>
      <div className="panel">
        <header className="toolbar">
          <h1>
            <Link to="/"> /</Link>
            <Link to={`/u/${props.username}`}>{props.username}</Link>/
            {props.datasetname}
            <span> </span>
            {last_updated && (
              <span className="traceid status">
                Last Analyzed<Time>{last_updated}</Time>
              </span>
            )}
          </h1>
        </header>
        <div className="insights">
          <div className="tiles">
            {report && (
              <div className="tile wide">
                <h1>Issue Types</h1>
                <ClusterSummary clustering={report?.clustering?.clusters} />
              </div>
            )}
            {report && (
              <div className="tile">
                <h1>Top Issues</h1>
                <TopIssues clustering={report?.clustering?.clusters} />
              </div>
            )}
            {report && (
              <div className="tile scroll wide">
                <h1>Metadata</h1>
                <ReportMetadata report={report} />
              </div>
            )}
            {report && (
              <div className="tile wide">
                <h1>Raw Report</h1>
                <pre>{rawReport}</pre>
              </div>
            )}
            <div className="tile analysis-job-controls">
              <h1>
                Analysis
                <div className="spacer" />
                <button
                  className="inline icon"
                  onClick={() => setShowConfigEditor(!showConfigEditor)}
                >
                  <BsGearFill />
                </button>
                <button className="inline" onClick={refreshJobs}>
                  <BsArrowCounterclockwise />
                </button>
              </h1>
              {showConfigEditor && (
                <AnalyzerConfigEditor configType="dataset" />
              )}
              <Jobs jobs={jobs} />
              <div className="spacer" />
              {Array.isArray(jobs) && (
                <div className="actions">
                  <CancelButton
                    datasetId={props.dataset.id}
                    onCancel={refreshJobs}
                    disabled={(jobs || []).length === 0}
                  />
                  <button
                    className="inline primary"
                    onClick={onStartJob}
                    disabled={(jobs || []).length > 0}
                  >
                    Queue
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ClusterSummary({ clustering }: { clustering: any }) {
  return clustering && <IssuePieChart data={clustering} />;
}

/**
 * 
 * @param param0 {
  "last_updated": "2025-02-17T23:09:08.791085",
  "num_results": 35,
  "options": {
    "temperature": 0.2,
    "k": 5,
    "guidelines": "\n[<ERROR CODE>] <ERROR MESSAGE> (use <ERROR CODE> in your error message) \n\n[example-data] \nWhen you observe data that looks mocked and seems unrealistic, raise an error (e.g. example.com domains and odd user names). For this always include the concrete string of example data in the error message.\n\n[authorization-missing] \nAgent runs the app before asking for authorization keys. For this, point to the line of code or step that is executed before the authorization keys are asked for.\n\n[code-quality] \nErrors detected during linting (e.g. syntax errors). Do not give style feedback, only major issues and errors.\n\n[editing-placeholders] \nDetects placeholder comment instead of the actual code itself. For this, always include the placeholder comment or string in the error message. Examples include like \"YOUR CODE HERE\" or \"TODO: Implement this function\" or \"the same code as before\".\n\n[flask-missing-route] \nA flask application is missing a root/index route (404 errors). Only applicable if the input shows a Flask application.\n\n\n[long-user-interaction] \nLarge number of messages in the user interaction (many messages with \"role\": \"user\", many means 20+ such messages). This is not applicable if there are just a lot of assistant messages (which is normal). This only applies, when there is many interactions with the actual user (who starts the conversation).\n\n[looping] \nThe agent writes the same content to the same file multiple times or makes no progress in another way. For looping, always include the concrete repeated content or tool call name in the error message.\n\n\n[non-english-internal-messages] \nAgent switches to language other than English in its internal thoughts.\n\n[runtime-errors] \nRuntime errors (e.g. import errors, attribute errors, etc.) when code is executed.\n\n[hallucinated-urls] \nAgent writes hallucinated URLs in the code, e.g. \"http://example.com\" or \"http://localhost:5000\". Typically very low severity, unless it leads to major downstream issues.\n\n[non-english user messages] \nFound user messages in language other than English or source code.\n\nFor agent traces, 'assistant' messages issue tool calls and 'tool' messages represent the output of the tool.\n\nImages may be present in the messages. Images should also be analyzed for errors.   \n\nBeyond these guidelines, you are free to create new error codes and messages as you see fit. The goal is to provide feedback that is helpful and actionable for the user.\n\nIf the content type the user provides is not JSON and does not fit the domain above, create entirely new error codes and messages that are relevant to the content type you are analyzing.\n\nVERY IMPORTANT: for longer traces go over the entire trace and look for patterns. Do not just look at the first few messages and then stop. The entire trace may contain the issue you are looking for. Also scan each message individually for issues, as they may be hidden in the middle of the trace.\n\n",
    "model": "i01",
    "endpoint": "http://host.docker.internal:8000",
    "apikey": "<api key on the Explorer above>"
  },
  "guardrail-suggestions": [
    {
      "name": "Refuse moderated user queries",
      "description": "Suggested based on insights from 42 matching samples",
      "policy": "raise \"the agent uses the send_email tool after checking the inbox with a 'VERY IMPORTANT' message\" if:\n    (output: ToolOutput) -> (call: ToolCall)\n    \"VERY IMPORTANT\" in output.content\n    output is tool:get_inbox\n    call is tool:send_email\n    "
    }
  ]
}*/
/**
.metadata {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.metadata dl {
  margin: 0;
}

.metadata dt {
  font-weight: bold;
}
 */
function ReportMetadata({ report }: { report: ReportFormat }) {
  const numResults = report.num_results;
  const guardrailSuggestions = report["guardrail-suggestions"];

  return (
    <table className="metadata">
      <tbody>
        <tr>
          <th>Results</th>
          <td>
            <pre>{numResults} issues</pre>
          </td>
        </tr>
        {guardrailSuggestions && (
          <tr>
            <th>Guardrail Suggestions</th>
            <td>
              <pre>
                {guardrailSuggestions.length} suggestion
                {guardrailSuggestions.length !== 1 && "s"}
              </pre>
            </td>
          </tr>
        )}
        {report.options && report.options.model && (
          <tr>
            <th>Model</th>
            <td>
              <pre>{report.options.model}</pre>
            </td>
          </tr>
        )}

        {report.options && report.options.temperature && (
          <tr>
            <th>Temperature</th>
            <td>
              <pre>{report.options.temperature}</pre>
            </td>
          </tr>
        )}

        {report.options && report.options.k && (
          <tr>
            <th>K</th>
            <td>
              <pre>{report.options.k}</pre>
            </td>
          </tr>
        )}

        {report.options && (
          <tr>
            <th>Other Options</th>
            <td>
              <pre>{JSON.stringify(report.options, null, 2)}</pre>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function TopIssues({ clustering }: { clustering: any }) {
  // count number of issues and show list of top-5 clusters
  const numIssues = clustering.reduce(
    (acc: number, cluster: any) => acc + cluster.issues.length,
    0
  );

  const navigate = useNavigate();

  const topClusters = clustering
    .map((cluster: any) => ({
      name: cluster.name,
      issues: cluster.issues,
    }))
    .sort((a: any, b: any) => b.issues.length - a.issues.length)
    .slice(0, 5);

  return (
    <div className="top-issues">
      <ul>
        {topClusters.map((cluster: any) => (
          <li
            key={cluster.name}
            onClick={() => {
              // get cluster indices from data and navigate to /t/?query=filter:cluster_name:id1,id2,id3
              const clusterIndices = cluster.issues.map(
                (issue: any) => issue.metadata?.index
              );
              const clusterFilter = `filter:${cluster.name}:${clusterIndices.join(",")}`;
              // current address looks like: http://localhost/u/developer/abc/t/41
              // navigate to ?query=filter:cluster_name:id1,id2,id3
              navigate({
                search: `?query=${clusterFilter}`,
              });
              setTimeout(() => window.location.reload(), 10);
            }}
          >
            <BsExclamationCircle />
            <span className="name">{cluster.name}</span>
            <span className="spacer" />
            <span className="count">{cluster.issues.length}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Component to show running analysis jobs.
 *
 * This will only show one job in the normal case (only one is allowed).
 *
 * However, in the case that multiple jobs are running, this will show all of them.
 */
function Jobs({ jobs }: { jobs: any[] | null }) {
  return (
    <ul className="jobs">
      {jobs && jobs.map((job) => <Job key={job.id} job={job} />)}
      {Array.isArray(jobs) && jobs.length === 0 && (
        <li className="empty">No analysis jobs running</li>
      )}
    </ul>
  );
}

function Job({ job }: { job: any }) {
  const name = job.extra_metadata?.name || "Analysis Job";
  const created_on_timestamp = job.extra_metadata?.created_on;
  const status = job.extra_metadata?.status || "Unknown";

  const [created_on, setCreatedOn] = useState(created_on_timestamp);

  useEffect(() => {
    const interval = setInterval(() => {
      setCreatedOn(created_on_timestamp);
    }, 500);

    return () => clearInterval(interval);
  }, [created_on_timestamp]);

  return (
    <li>
      {name}
      <Progress job={job} />
      <Time timestampOnly>{created_on}</Time>{" "}
      <span className="status">{status}</span>
    </li>
  );
}

function Progress({ job }: { job: any }) {
  const num_processed = job.extra_metadata?.num_processed || 0;
  const num_total = job.extra_metadata?.num_total || 0;

  if (num_total === 0) {
    return null;
  }

  return (
    <span className="progress">
      {num_processed}/{num_total}
    </span>
  );
}

function CancelButton({
  datasetId,
  onCancel,
  disabled,
}: {
  datasetId: string;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const response = await fetch(
        `/api/v1/dataset/byid/${datasetId}/analysis`,
        {
          method: "DELETE",
        }
      );

      if (response.ok) {
        onCancel();
      } else {
        alert("Failed to cancel analysis jobs");
        console.error(response);
      }
    } catch (error) {
      alert("Failed to cancel analysis jobs");
      console.error(error);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <button
      className="inline"
      onClick={handleCancel}
      disabled={cancelling || disabled}
    >
      {cancelling ? "Cancelling..." : "Cancel"}
    </button>
  );
}
