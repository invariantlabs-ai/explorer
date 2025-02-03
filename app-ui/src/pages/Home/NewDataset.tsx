import React, { useEffect } from "react";
import { BsFileBinaryFill, BsUpload } from "react-icons/bs";
import { useTelemetry } from "../../telemetry";
import { config } from "../../utils/Config";
import { BsLock, BsGlobe } from "react-icons/bs";
import { createDataset, uploadDataset } from "../../service/DatasetOperations";
/**
 * Modal content for uploading a new dataset.
 */
export function UploadDatasetModalContent(props) {
  const [name, setName] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  // indicates whether we are currently uploading the file
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [isDatasetNameInvalid, setIsDatasetNameInvalid] = React.useState(false);
  const DATASET_NAME_REGEX = /^[A-Za-z0-9-_]+$/;
  const [isPublic, setIsPublic] = React.useState(false);
  const [contentType, setContentType] = React.useState("empty"); // Tracks selected content type

  const handleAccessChange = (event) => {
    console.log("Access changed to: ", event.target.value);
    setIsPublic(event.target.value === "public");
  };

  const handleContentChange = (event) => {
    setContentType(event.target.value);
  };

  const telemetry = useTelemetry();

  const onSubmit = () => {
    if (!name) return;
    if (!file) {
      createDataset(name, isPublic)
        .then(() => {
          props.onSuccess();
          props.onClose();
          telemetry.capture("dataset-created", {
            name: name,
            from_file: false,
          });
        })
        .catch((err) => {
          setError(
            err.detail || "An unknown error occurred, please try again.",
          );
          telemetry.capture("dataset-create-failed", {
            name: name,
            error: err.detail,
          });
        });
      return;
    }
    setLoading(true);
    uploadDataset(name, file, isPublic)
      .then(() => {
        // on success, close the modal
        setLoading(false);
        props.onSuccess();
        props.onClose();
        telemetry.capture("dataset-created", { name: name, from_file: true });
      })
      .catch((err) => {
        setLoading(false);
        setError(err.detail || "An unknown error occurred, please try again.");
        telemetry.capture("dataset-create-failed", {
          name: name,
          error: err.detail,
        });
      });
  };

  // on file selection, derive name from file name if not already set
  React.useEffect(() => {
    if (!name && file) {
      let name = file.name;
      if (name.endsWith(".json")) {
        name = name.slice(0, -5);
      } else if (name.endsWith(".jsonl")) {
        name = name.slice(0, -6);
      }
      setName(name);
    }
  }, [file]);

  const onNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);
    setIsDatasetNameInvalid(!DATASET_NAME_REGEX.test(newName));
  };

  return (
    <div className="create-dataset-form">
      <h2>Create a new trace dataset to start using Invariant Explorer.</h2>
      <label>Name</label>
      <input
        type="text"
        value={name}
        onChange={onNameChange}
        placeholder="Dataset Name"
      />
      {isDatasetNameInvalid && name && (
        <span className="error">
          Dataset name can only contain A-Z, a-z, 0-9, - and _
        </span>
      )}
      <label>Access</label>
      {!config("sharing") && (
        <span className="option-name">
          The dataset will only be stored on your local machine.
        </span>
      )}
      {config("sharing") && (
        <>
          <div className="options-container">
            <label htmlFor="private" className="radio-label">
              <input
                type="radio"
                id="private"
                name="access"
                value="private"
                checked={!isPublic}
                onChange={handleAccessChange}
              />
              <BsLock className="icon" />
              <div>
                <span className="option-name">Private</span>
                <span className="option-description">
                  Only you can access this dataset.
                </span>
              </div>
            </label>
          </div>
          <div className="options-container">
            <label htmlFor="public" className="radio-label">
              <input
                type="radio"
                id="public"
                name="access"
                value="public"
                checked={isPublic}
                onChange={handleAccessChange}
              />
              <BsGlobe className="icon" />
              <div>
                <span className="option-name">Public</span>
                <span className="option-description">
                  Anyone on the internet can view this dataset.
                </span>
              </div>
            </label>
          </div>
        </>
      )}
      <label>Contents</label>
      <div className="options-container">
        <label htmlFor="empty" className="radio-label">
          <input
            type="radio"
            id="empty"
            name="content"
            value="empty"
            checked={contentType === "empty"}
            onChange={handleContentChange}
          />
          <div className="option-dataset-type">
            <span className="option-name">Empty Dataset</span>
            <span className="option-description">
              You can upload traces using the{" "}
            </span>
          </div>
        </label>
        <span className="option-description option-description-link">
          {" "}
          <a
            target="_blank"
            href="https://explorer.invariantlabs.ai/docs/explorer/Explorer_API/Uploading_Traces/push_api/"
          >
            Explorer Push API
          </a>
          .
        </span>
      </div>
      <div className="options-container">
        <label htmlFor="jsonl" className="radio-label">
          <input
            type="radio"
            id="jsonl"
            name="content"
            value="jsonl"
            checked={contentType === "jsonl"}
            onChange={handleContentChange}
          />
          <div className="option-dataset-type">
            <span className="option-name">Upload JSON Lines file</span>
            <span className="option-description">
              Before uploading traces make sure they are in the{" "}
            </span>
          </div>
        </label>
        <span className="option-description option-description-link">
          {" "}
          <a
            target="_blank"
            href="https://explorer.invariantlabs.ai/docs/explorer/Explorer_API/2_traces/"
          >
            correct format
          </a>
          .
        </span>
      </div>
      {contentType === "jsonl" && (
        <>
          <FileUploadMask file={file} />
          <input
            aria-label="file-input"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </>
      )}
      <button
        aria-label="create"
        className="primary"
        disabled={!name || loading || isDatasetNameInvalid}
        onClick={onSubmit}
      >
        {loading ? "Uploading..." : "Create"}
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

/**
 * Component to show a custom UI overlay for file uploads.
 *
 * Supports drag and drop, by rendering a 0.0 opacity file <input/> on top of the custom UI.
 */
export function FileUploadMask(props) {
  return (
    <div className="file-upload-mask">
      <div className="overlay">
        {props.file ? (
          <span className="selected">
            <BsFileBinaryFill /> {props.file.name} (
            {(props.file.size / 1024 / 1024).toFixed(2)} MB)
          </span>
        ) : (
          <>
            <BsUpload />
            <em>Choose a file</em> or drop it here to upload
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Content to show in the modal when deleting a dataset.
 */
export function DeleteDatasetModalContent(props) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const id = props.dataset.id;

  const onDelete = () => {
    setLoading(true);
    fetch(`/api/v1/dataset/byid/${id}`, {
      method: "DELETE",
    }).then((response) => {
      if (response.ok) {
        setLoading(false);
        props.onSuccess();
        props.onClose();
      } else {
        response
          .json()
          .then((data) => {
            setLoading(false);
            setError(
              data.detail || "An unknown error occurred, please try again.",
            );
          })
          .catch(() => {
            setLoading(false);
            setError("An unknown error occurred, please try again.");
          });
      }
    });
  };

  return (
    <div className="form">
      <h2>
        Are you sure you want to delete {props.dataset.name}?<br />
        <br />
        Note that this action is irreversible. All associated data will be lost.
      </h2>
      {error ? <span className="error">{error}</span> : <br />}
      <button
        aria-label="confirm delete"
        className="danger"
        disabled={loading}
        onClick={onDelete}
      >
        {loading ? "Deleting..." : "Delete"}
      </button>
    </div>
  );
}
