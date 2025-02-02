import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Time } from "./components/Time";

function useJSONParse<T>(json: string | null): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (json) {
      try {
        setData(JSON.parse(json));
      } catch (e) {
        console.error("Failed to parse JSON", e);
      }
    }
  }, [json]);
  return data;
}

interface ReportFormat {
  last_updated?: string;
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
}) {
  const rawReport = props.dataset?.extra_metadata?.analysis_report;
  const report = useJSONParse(rawReport) as ReportFormat | null;

  const last_updated = report?.last_updated;

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
                Last Analyzed <Time>{last_updated}</Time>
              </span>
            )}
          </h1>
        </header>
        {report && (
          <div className="insights">
            <div className="tiles">
              <div className="tile">
                <h1>Raw Report</h1>
                <pre>{rawReport}</pre>
              </div>
            </div>
          </div>
        )}
        {!report && (
          <div className="insights">
            <div className="empty">Analysis Not Available</div>
          </div>
        )}
      </div>
    </>
  );
}
