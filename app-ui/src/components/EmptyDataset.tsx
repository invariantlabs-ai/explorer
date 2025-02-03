import React from "react";
import { FileUploadMask } from "../pages/Home/NewDataset";
import { uploadDataset } from "../service/DatasetOperations";
import { useTelemetry } from "../telemetry";

/**
 * A component to show when there are no traces in the dataset.
 *
 * It contains information on how to populate the dataset with traces.
 */
export function EmptyDatasetInstructions(props) {
  const [file, setFile] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const telemetry = useTelemetry();
  const datasetname = props.datasetname;

  const onSubmit = () => {
    if (!file) {
      return;
    }
    setLoading(true);
    uploadDataset(datasetname, file)
      .then(() => {
        setLoading(false);
        telemetry.capture("dataset-uploaded", {
          name: datasetname,
          from_file: true,
        });
        props.onSuccess();
      })
      .catch((err) => {
        console.log(err);
        setLoading(false);
        setError(err.detail || "An unknown error occurred, please try again.");
        telemetry.capture("dataset-upload-failed", {
          name: datasetname,
          error: err.detail,
        });
      });
  };

  return (
    <div className="empty instructions">
      <h3>Empty Dataset</h3>
      <p>This dataset does not contain any traces yet.</p>
      <div className="options">
        <div>
          <h2>Upload a JSON Lines file</h2>
          <p>
            Before uploading traces make sure they are in the{" "}
            <a
              target="_blank"
              href="https://explorer.invariantlabs.ai/docs/explorer/Explorer_API/2_traces/"
            >
              correct format
            </a>
            .
          </p>
          <FileUploadMask file={file} />
          <input
            aria-label="file-input"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <button
            aria-label="upload"
            className="primary"
            disabled={loading || !file}
            onClick={onSubmit}
          >
            {loading ? "Uploading..." : "Upload"}
          </button>
          {error && <span className="error">{error}</span>}
          <p className="push-api-option">
            <i>
              You can also upload traces using the{" "}
              <a
                target="_blank"
                href="https://explorer.invariantlabs.ai/docs/explorer/Explorer_API/Uploading_Traces/push_api/"
              >
                Explorer Push API
              </a>
              .
            </i>
          </p>
        </div>
      </div>
    </div>
  );
}
