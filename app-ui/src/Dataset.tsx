//@ts-nocheck
import React, {useEffect} from "react";
import {
  BsCheckCircleFill,
  BsCodeSlash,
  BsCollection,
  BsDownload,
  BsGear,
  BsGlobe,
  BsPencilFill,
  BsQuestionCircleFill,
  BsTrash,
} from "react-icons/bs";
import { Link, useLoaderData, useNavigate } from "react-router-dom";
import { DeleteDatasetModalContent } from "./Datasets";
import { Modal } from "./Modal";
import { PoliciesView } from "./Policies";
import { RemoteResource, useRemoteResource } from "./RemoteResource";
import { useUserInfo } from "./UserInfo";
import { Metadata } from "./lib/metadata";
import { config } from "./Config";
import { useTelemetry } from "./telemetry";
import { DatasetNotFound, isClientError } from "./NotFound";
import { Traces } from "./Traces";

interface Query {
  id: string;
  name: string;
  count: number;
  query: string;
}

interface DatasetData {
  public: any;
  id: string;
  name: string;
  is_public: boolean;
  extra_metadata: string;
  queries: Query[];
}

class Dataset extends RemoteResource {
  constructor(username: string, datasetname: string) {
    super(
      `/api/v1/dataset/byuser/${username}/${datasetname}`,
      `/api/v1/dataset/byuser/${username}/${datasetname}`,
      `/api/v1/dataset/byuser/${username}/${datasetname}`,
      `/api/v1/dataset/byuser/${username}/${datasetname}`
    );
    //@ts-ignore
    this.username = username;
    this.datasetname = datasetname;
  }
}

function metadata(dataset) {
  if (!dataset) {
    return [];
  }
  try {
    let metadata = JSON.parse(dataset?.extra_metadata);
    return Object.keys(metadata).map((key) => {
      return {
        key: key,
        value: metadata[key],
      };
    });
  } catch (e) {
    return [];
  }
}

function Query({
  dataset,
  id,
  name,
  count,
  query,
  deletable,
  icon,
  onSelect,
  refresh,
}: {
  dataset;
  id: string;
  name: string;
  count: number;
  query: string;
  deletable: boolean;
  icon?: React.ReactNode;
  onSelect?: () => void;
  refresh: () => void;
}) {
  const iconMap: { [key: string]: React.ReactNode } = {
    all: <BsCheckCircleFill />,
    annotated: <BsPencilFill style={{ color: "green" }} />,
    unannotated: <BsQuestionCircleFill style={{ color: "gold" }} />,
  };

  const deleteQuery = (e) => {
    if (deletable) {
      fetch(`/api/v1/dataset/query/${id}`, {
        method: "DELETE",
      })
        .then(() => {
          alert("query delete");
          refresh();
        })
        .catch((error) => {
          alert("Failed to delete query: " + error);
        });
    }
    e.preventDefault();
  };

  return (
    <>
      <div className={"query"}>
        <Link
          to={
            `/u/${dataset.user.username}/${dataset.name}/t` +
            (query ? "?query=" + query : "")
          }
        >
          <div className="icon">{icon || iconMap[id] || null}</div>
          <div className="count">{count}</div>
          <div className="name">{name}</div>
        </Link>
        {deletable && (
          <button onClick={deleteQuery}>
            <BsTrash />
          </button>
        )}
      </div>
    </>
  );
}

/**
 * Component for displaying a single dataset related functionality (view, edit, delete, download, etc.)
 */
function DatasetView() {
  // get dataset id from loader data (populated by site router)
  const props: any = useLoaderData();

  // loads details about the dataset from the API
  const [dataset, datasetStatus, datasetError, datasetLoader] =
    useRemoteResource(Dataset, props.username, props.datasetname);
  // tracks whether the Delete Dataset modal is open
  const [selectedDatasetForDelete, setSelectedDatasetForDelete] =
    React.useState(null);
  // used to navigate to a new page
  const navigate = useNavigate();
  // obtains the active user's information (if signed in)
  const userInfo = useUserInfo();
  // telemetry
  const telemetry = useTelemetry();
  // state to track the selected tab
  const [selectedTab, _setSelectedTab] = React.useState("traces");
  const setSelectedTab = telemetry.wrap(_setSelectedTab, "dataset.select-tab");

  // callback for when a user toggles the public/private status of a dataset
  const onPublicChange = (e) => {
    // log event
    telemetry.capture("dataset.public-change", { public: e.target.checked });
    // update the dataset's public status
    datasetLoader
      .update(null, { content: e.target.checked })
      .then(() => {
        datasetLoader.refresh();
      })
      .catch((error) => {
        alert("Failed to save annotation: " + error);
      });
  };

  // callback for when a user downloads a dataset
  const onDownloadDataset = (event) => {
    // trigger the download (endpoint is /api/v1/dataset/byid/:id/download)
    window.open(`/api/v1/dataset/byid/${dataset.id}/download`);
    event.preventDefault();
  };

  // if the dataset is not found, display a message
  if (datasetError) {
    if (isClientError(datasetError.status)) {
      return <DatasetNotFound />;
    }
    return (
      <div className="empty">
        <h3>Failed to Load Dataset</h3>
      </div>
    );
  } else if (!dataset) {
    return (
      <div className="empty">
        <h3>Loading...</h3>
      </div>
    );
  }

  const filterMetadata = (metadata) => {
    if (!metadata) {
      return undefined;
    }

    // 1. we don't want to show the policies as part of the Metadata component.
    // 2. we don't show the featureset as part of the Metadata component.
    const { policies, featureset, ...filteredMetadata } = metadata;

    return filteredMetadata;
  };

  // if the dataset is not found, display a message
  return (
    <div className="dataset-view">
      <div className="tabs">
        <button
          key="traces"
          className={`tab ${"traces" === selectedTab ? "active" : ""}`}
          onClick={() => setSelectedTab("traces")}
        >
          <div className="inner">
          <BsCollection />Traces
          </div>
        </button>
        <button
          key="metadata"
          className={`tab ${"metadata" === selectedTab ? "active" : ""}`}
          onClick={() => setSelectedTab("metadata")}
        >
          <div className="inner">
          <BsCodeSlash />Metadata
          </div>
        </button>
        <button
          key="settings"
          className={`tab ${"settings" === selectedTab ? "active" : ""}`}
          onClick={() => setSelectedTab("settings")}
        >
          <div className="inner">
          <BsGear />Settings
          </div>
        </button>
      </div>

      {selectedTab === "traces" && <Traces />}

      {selectedTab === "metadata" && (
        <>
          <div className="panel">
            <header className='toolbar'>
              <h1>
                <Link to={`/u/${props.username}`}>{props.username}</Link>/{props.datasetname}
              </h1>
            </header>
            <div className="metadata-summary">
              <Metadata extra_metadata={filterMetadata({ ...dataset?.extra_metadata, id: dataset.id })} />
            </div>
          </div>
          <div className="metadata-policies">
            <PoliciesView dataset={dataset} datasetLoader={datasetLoader} />
          </div>
        </>
      )}

      {selectedTab === "settings" && (
        <>
          {/* delete modal */}
          {selectedDatasetForDelete && (
            <Modal
              title="Delete Dataset"
              onClose={() => setSelectedDatasetForDelete(null)}
              hasWindowControls
            >
              <DeleteDatasetModalContent
                dataset={selectedDatasetForDelete}
                onClose={() => setSelectedDatasetForDelete(null)}
                onSuccess={() => navigate("/")}
              ></DeleteDatasetModalContent>
            </Modal>
          )}
          <div className="panel entity-list">
            <header className='toolbar'>
              <h1>
                <Link to={`/u/${props.username}`}>{props.username}</Link>/{props.datasetname}
              </h1>
            </header>
            <div className="settings-actions">
              {dataset?.user?.id == userInfo?.id && (
                <div className="box full setting">
                  <div>
                    <h3>Delete Entire Dataset</h3>
                    Delete this dataset and all associated data. This action
                    cannot be undone.
                  </div>
                  <button
                    aria-label="delete"
                    className="danger"
                    onClick={() => setSelectedDatasetForDelete(dataset)}
                  >
                    <BsTrash /> Delete
                  </button>
                </div>
              )}
              {config("sharing") && (
                <PublicControls
                  dataset={dataset}
                  datasetLoader={datasetLoader}
                  onPublicChange={onPublicChange}
                  userInfo={userInfo}
                />
              )}
              <div className="box full setting">
                <div>
                  <h3>Export Dataset</h3>
                  Download a copy of the dataset.
                </div>
                <button
                  aria-label="download"
                  className="primary"
                  onClick={() => onDownloadDataset()}
                >
                  <>
                    <BsDownload /> Download
                  </>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      <br />
    </div>
  );
}

/**
 * Controls for making a dataset public or private.
 */
export function PublicControls({
  dataset,
  datasetLoader,
  onPublicChange,
  userInfo,
}) {
  const isPrivateInstance = config("private");

  const description = isPrivateInstance
    ? `Share this dataset with all other users of this explorer instance (logged-in users only).`
    : `Share this dataset to the public web and allow other users to view and annotate the data.`;
  const positiveLabel = isPrivateInstance ? "Share with Instance" : "Publish";
  const negativeLabel = "Make Private";

  return (
    dataset?.user?.id == userInfo?.id && (
      <div className="box full setting">
        <div>
          <h3>Access</h3>
          {description}{" "}
          {dataset.is_public ? "Currently shared" : "Currently private"}.
        </div>
        <button
          className={!dataset.is_public ? "primary" : ""}
          onClick={() =>
            onPublicChange({ target: { checked: !dataset.is_public } })
          }
        >
          <BsGlobe /> {dataset.is_public ? "Make Private" : positiveLabel}
        </button>
      </div>
    )
  );
}

export default DatasetView;
