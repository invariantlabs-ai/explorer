import Editor from "@monaco-editor/react";
import React from "react";
import { BsPencilFill, BsPlusCircle, BsTrash } from "react-icons/bs";
import { Modal } from "../../lib/Modal";

/**
 * Content to show in the modal when deleting a policy.
 */
function DeletePolicyModalContent(props) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const onDelete = () => {
    setLoading(true);
    fetch(`/api/v1/dataset/${props.dataset_id}/policy/${props.policy.id}`, {
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
        Are you sure you want to delete Policy: <b>{props.policy.name}</b>?
        <br />
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

/**
 * Content to show in the modal when updating or creating a policy.
 */
function MutatePolicyModalContent(props) {
  const defaultPolicyCode = `\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n`;
  const action = props.action;
  const [name, setName] = React.useState(
    props.policy ? props.policy.name : null,
  );
  const [policyCode, setPolicyCode] = React.useState(
    action == "update" ? props.policy.content : defaultPolicyCode,
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const onMutate = () => {
    setLoading(true);
    fetch(
      action == "update"
        ? `/api/v1/dataset/${props.dataset_id}/policy/${props.policy.id}`
        : `/api/v1/dataset/${props.dataset_id}/policy`,
      {
        method: action == "update" ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: name, policy: policyCode.trim() }),
      },
    ).then((response) => {
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
    <div className="policy-editor-form">
      <label>Name</label>
      <input
        type="text"
        value={name || ""}
        onChange={(e) => setName(e.target.value)}
        placeholder="Policy Name"
      />
      <label>Policy Code</label>
      <Editor
        height="60%"
        width="100%"
        className="policy-editor"
        defaultLanguage="python"
        value={policyCode}
        onChange={(value?: string) => setPolicyCode(value || "")}
        theme="vs-light"
      />
      <button
        aria-label={action}
        className="primary"
        disabled={loading || !name || !policyCode || !policyCode.trim()}
        onClick={onMutate}
      >
        {action == "update"
          ? loading
            ? "Updating..."
            : "Update"
          : loading
            ? "Creating..."
            : "Create"}
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

/**
 * Component for viewing, updating and deleting policies.
 */
export function PoliciesView(props) {
  // tracks whether the create policy modal is open.
  const [showCreatePolicyModal, setShowCreatePolicyModal] =
    React.useState(false);
  // tracks the policy to be deleted.
  const [selectedPolicyForDeletion, setSelectedPolicyForDeletion] =
    React.useState(null);
  // tracks the policy to be updated.
  const [selectedPolicyForUpdation, setSelectedPolicyForUpdation] =
    React.useState(null);
  const dataset = props.dataset;
  const datasetLoader = props.datasetLoader;

  return (
    <div>
      {/* create modal */}
      {showCreatePolicyModal && (
        <Modal
          title="Create Policy"
          onClose={() => setShowCreatePolicyModal(false)}
          hasWindowControls
        >
          <MutatePolicyModalContent
            dataset_id={dataset.id}
            policy={null}
            action="create"
            onClose={() => setShowCreatePolicyModal(false)}
            onSuccess={() => datasetLoader.refresh()}
          ></MutatePolicyModalContent>
        </Modal>
      )}
      {/* delete modal */}
      {selectedPolicyForDeletion && (
        <Modal
          title="Delete Policy"
          onClose={() => setSelectedPolicyForDeletion(null)}
          hasWindowControls
        >
          <DeletePolicyModalContent
            dataset_id={dataset.id}
            policy={selectedPolicyForDeletion}
            onClose={() => setSelectedPolicyForDeletion(null)}
            onSuccess={() => datasetLoader.refresh()}
          ></DeletePolicyModalContent>
        </Modal>
      )}
      {/* update modal */}
      {selectedPolicyForUpdation && (
        <Modal
          title="Update Policy"
          onClose={() => setSelectedPolicyForUpdation(null)}
          hasWindowControls
        >
          <MutatePolicyModalContent
            dataset_id={dataset.id}
            policy={selectedPolicyForUpdation}
            action="update"
            onClose={() => setSelectedPolicyForUpdation(null)}
            onSuccess={() => datasetLoader.refresh()}
          ></MutatePolicyModalContent>
        </Modal>
      )}
      <h2 className="policies-header">
        Policies
        <button
          className="primary new-policy-button"
          onClick={() => setShowCreatePolicyModal(true)}
        >
          {" "}
          <BsPlusCircle /> New Policy
        </button>
      </h2>
      <div className="policies-list">
        {(!dataset.extra_metadata?.policies ||
          dataset.extra_metadata.policies.length === 0) && (
          <div className="no-policies">
            No policies found for the dataset. Click on the 'New Policy' button
            to create a new policy.
          </div>
        )}
        {dataset.extra_metadata?.policies &&
          dataset.extra_metadata.policies.length > 0 &&
          dataset.extra_metadata.policies.map((policy) => {
            return (
              <div key={policy.id}>
                <div className="box full setting">
                  <div>
                    <h3 className="policy-label">{policy.name}</h3>
                  </div>
                  <button
                    aria-label="delete"
                    className="danger policy-delete"
                    onClick={() => setSelectedPolicyForDeletion(policy)}
                  >
                    <BsTrash /> Delete
                  </button>
                  <button
                    aria-label="edit"
                    className="primary"
                    onClick={() => setSelectedPolicyForUpdation(policy)}
                  >
                    <BsPencilFill /> Edit
                  </button>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
