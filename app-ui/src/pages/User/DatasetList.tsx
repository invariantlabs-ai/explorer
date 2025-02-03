import React, { useEffect } from "react";

import { useUserInfo } from "../../utils/UserInfo";
import { Link } from "react-router-dom";
import { EntityList } from "../../EntityList";
import { Modal } from "../../Modal";
import { useDatasetList } from "../../service/DatasetOperations";
import {
  DeleteDatasetModalContent,
  UploadDatasetModalContent,
} from "../Home/NewDataset";
import { BsUpload } from "react-icons/bs";

/**
 * Compact version of the dataset list (e.g. to use on the home page).
 */
export function DatasetLinkList(props) {
  const userInfo = useUserInfo();
  let datasets = props.datasets || [];
  datasets = datasets.map((item) => ({
    ...item,
    nice_name: item.nice_name || item.name,
  }));
  return (
    <>
      <EntityList title={null} actions={null} className={props.className}>
        {props.datasets === null ? (
          <div className="empty">Loading Datasets...</div>
        ) : (
          datasets.map((dataset, i) => (
            <Link
              className="item"
              to={`/u/${dataset.user.username}/${dataset.name}/t`}
              key={i}
            >
              <li>
                <h3>
                  {props.icon}
                  {dataset.nice_name}
                </h3>
                {dataset.description && (
                  <span className="description">{dataset.description}</span>
                )}
              </li>
            </Link>
          ))
        )}
        {props.datasets !== null && datasets.length === 0 && (
          <div className="empty">No datasets</div>
        )}
      </EntityList>
    </>
  );
}

/**
 * List of datasets for the current user.
 */
export function Datasets() {
  // currently signed-in user info
  const userInfo = useUserInfo();
  // remote call to get the list of datasets
  const [datasets, refresh] = useDatasetList("private");
  // tracks whether the Upload Dataset modal is currently shown
  const [showUploadModal, setShowUploadModal] = React.useState(false);
  // tracks whether we are currently showing a delete modal for a particular dataset (null if none)
  const [selectedDatasetForDelete, setSelectedDatasetForDelete] =
    React.useState(null);

  useEffect(() => {
    if (userInfo?.loggedIn) {
      refresh();
    }
  }, [userInfo?.loggedIn, refresh]);

  return (
    <>
      {/* upload modal */}
      {showUploadModal && (
        <Modal
          title="Create Dataset"
          onClose={() => setShowUploadModal(false)}
          hasWindowControls
        >
          <UploadDatasetModalContent
            onClose={() => setShowUploadModal(false)}
            onSuccess={refresh}
          />
        </Modal>
      )}
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
            onSuccess={refresh}
          />
        </Modal>
      )}
      <EntityList
        title="Datasets"
        actions={
          <>
            {userInfo?.loggedIn && (
              <button
                className="primary"
                onClick={() => setShowUploadModal(true)}
              >
                <BsUpload /> Upload New Dataset
              </button>
            )}
          </>
        }
      >
        <DatasetLinkList
          title="My Datasets"
          datasets={datasets}
          onDelete={setSelectedDatasetForDelete}
        />
      </EntityList>
    </>
  );
}
