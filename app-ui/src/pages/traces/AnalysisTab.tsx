import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Time } from "../../components/Time";
import {
  BsArrowCounterclockwise,
  BsExclamationCircle,
  BsExclamationCircleFill,
  BsFileEarmarkBreak,
  BsGearFill,
  BsGearWideConnected,
  BsInfoCircle,
} from "react-icons/bs";

import "./Analyzer.scss";
import IssuePieChart from "./Charts";
import { AnalysisConfigEditor, getAnalysisConfig } from "../../lib/AnalysisAPIAccess";
import { alertModelAccess } from "./ModelModal";

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

export interface Cluster {
  // name of the cluster
  name: string;
  // issues in the cluster (pair of trace ID the issue comes from, and the index the issue is in the trace)
  issues_indexes: [string, number][];
}

export interface ReportFormat {
  last_updated?: string;
  cost?: number;
  clustering?: Cluster[];
  status?: string;
}

/**
 * Shows pushed analysis reports if available for a dataset (e.g. via dataset metadata).
 *
 * This component is rendered as a separate tab in the dataset view.
 */
export function AnalysisReport(props: {
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
      })
      .catch((e) => {
        console.error("Failed to refresh jobs", e);
      });
  };

  // Refresh regularly (if there are jobs)
  useEffect(() => {
    const interval = setInterval(() => {
      if ((jobs || []).length > 0) {
        refreshJobs();
      }
    }, 500);
    return () => clearInterval(interval);
  }, [jobs]);

  // Get only analysis jobs for UI controls
  const analysisJobs = useMemo(() => {
    return jobs?.filter((job) => job.extra_metadata?.type === "analysis") || [];
  }, [jobs]);

  const onStartJob = async () => {
    const config = getAnalysisConfig();
    const endpoint = config.endpoint;
    const apikey = config.apikey;

    const url = `/api/v1/dataset/byid/${props.dataset.id}/analysis`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        apiurl: endpoint,
        apikey: apikey,
        options: config,
      }),
    })
      .then((r) => {
        if (!r.ok) {
          r.text().then((t) => {
            if (t.includes("403")) {
              alertModelAccess("You do not have access to this feature.");
            }
            console.error(t)
          });
          throw new Error("Failed to start analysis job");
        }
        return r.json();
      })
      .then((r) => {
        if (!r) {
          throw new Error("Failed to start analysis job");
        }
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

  const [showAnalysisControls, setShowAnalysisControls] = useState(false);

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
          <button className={"inline analysis-button" + (analysisJobs.length > 0 ? " analysis-running" : " primary")}
          onClick={() => setShowAnalysisControls(!showAnalysisControls)}>
              <span className="label">
                {analysisJobs.length > 0 ? (
                  <><BsGearWideConnected className="spin" /> Analysing your traces...</>
                ) : (
                  <><BsFileEarmarkBreak /> Run Analysis Model</>
                )}
              </span>
              {showAnalysisControls && (
              <div className="tile analysis-job-controls" onClick={(e) => e.stopPropagation()}>
                <h1>
                  Analysis Model
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
                {showConfigEditor && <AnalysisConfigEditor/>}
                {!showConfigEditor && <>
                  <Jobs jobs={jobs} />
                  <div className="spacer" />
                  {Array.isArray(jobs) && (
                    <div className="actions">
                      <CancelButton
                        datasetId={props.dataset.id}
                        onCancel={refreshJobs}
                        disabled={analysisJobs.length === 0}
                      />
                      <button
                        className="inline primary"
                        onClick={onStartJob}
                        disabled={analysisJobs.length > 0}
                      >
                        Start Analysis
                      </button>
                    </div>
                  )}
                </>}
              </div>)}
            </button>
        </header>
        <div className="insights">
          <div className="tiles">
            {report && (
              <div className="tile wide">
                <h1>Issue Types</h1>
                <ClusterSummary clustering={report?.clustering} />
              </div>
            )}
            {report && (
              <div className="tile wide">
                <h1>Raw Report</h1>
                <pre>{rawReport}</pre>
              </div>
            )}
            {!report && (
              <div className="empty" style={{ width: "100%" }}>
                  <h3>
                  No Analysis Available Yet
                  </h3>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ClusterSummary({ clustering }: { clustering: any }) {
  if (!clustering || clustering.length === 0) {
    return (
      <div
        className="empty-clustering"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "160px",
          height: "calc(100% - 40px)",
          width: "100%",
          color: "#6c757d",
          fontSize: "1rem",
          textAlign: "center",
          flexDirection: "column",
          gap: "0.75rem",
          marginTop: "-20px",
        }}
      >
        <BsInfoCircle size={28} />
        <span>No issue patterns were found.</span>
      </div>
    );
  }
  return <IssuePieChart data={clustering} />;
}

/**
 * Component to show running analysis jobs.
 *
 * This will only show one job in the normal case (only one is allowed).
 *
 * However, in the case that multiple jobs are running, this will show all of them.
 */
function Jobs({ jobs }: { jobs: any[] | null }) {
  // Filter only analysis jobs
  const analysisJobs =
    jobs?.filter((job) => job.extra_metadata?.type === "analysis") || [];

  return (
    <ul className="jobs">
      {analysisJobs.map((job) => (
        <Job key={job.id} job={job} />
      ))}
      {analysisJobs.length === 0 && (
        <li className="empty">Invariant Analysis Models help you understand how your agents<br/> operate. To start, queue a new analysis job below.</li>
      )}
    </ul>
  );
}

/**
 * Component to show a single analysis job.
 */
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
