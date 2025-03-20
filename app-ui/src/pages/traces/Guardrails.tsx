import Editor from "@monaco-editor/react";
import React from "react";
import {
  BsArrowsAngleContract,
  BsArrowsAngleExpand,
  BsArrowsCollapse,
  BsBan,
  BsCardList,
  BsCode,
  BsDatabaseAdd,
  BsDatabaseLock,
  BsFileEarmarkBreak,
  BsPauseCircle,
  BsPencilFill,
  BsPlus,
  BsPlusCircle,
  BsShieldFillCheck,
  BsStars,
  BsTerminal,
  BsTrash,
  BsX,
  BsLightningCharge,
} from "react-icons/bs";
import { Modal } from "../../components/Modal";
import { Link } from "react-router-dom";
import "./Guardrails.scss";
import { Tooltip } from "react-tooltip";
import { Traces } from "./Traces";

// Define interface for policy generation request
interface PolicyGenerationRequest {
  problem_description: string;
  traces: any[];
  dataset_id: string;
  config?: any;     // Optional additional configuration
}

const SUGGETSIONS_ENABLED = false;
const GUARDRAIL_EVALUATION_ENABLED = false;

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
              data.detail || "An unknown error occurred, please try again."
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
        Are you sure you want to delete the guardrail <i>{props.policy.name}</i>
        ?
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
  const defaultPolicyCode = `# this is a sample guardrail policy.\nraise "Something went wrong" if:\n   (msg: Message)\n   "error" in msg.content\n`;
  const action = props.action;
  const [name, setName] = React.useState(
    props.policy ? props.policy.name : "New Guardrail"
  );
  const [policyCode, setPolicyCode] = React.useState(
    action == "update" ? props.policy.content : defaultPolicyCode
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const [guardrailAction, setGuardrailAction] = React.useState(
    action == "update" ? props.policy.action : "log"
  );

  const [guardrailEnabled, setGuardrailEnabled] = React.useState(
    action == "update" ? props.policy.enabled : true
  );

  const [editMode, setEditMode] = React.useState(false);

  const guardrailActions = [
    {
      title: "Block Agent",
      description: "The agent is blocked from executing any further actions.",
      value: "block-enabled",
      actionValue: "block",
      icon: <BsBan />,
      enabled: true,
    },
    {
      title: "Log Failure",
      description: "The agent continues to execute but a failure is logged.",
      value: "log-enabled",
      actionValue: "log",
      icon: <BsCardList />,
      enabled: true,
    },
    {
      title: "Paused",
      description: "The guardrail is paused and will not be checked.",
      value: "log-paused",
      actionValue: "log",
      icon: <BsPauseCircle />,
      enabled: false,
    },
  ];

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
        body: JSON.stringify({
          name: name,
          policy: policyCode.trim(),
          action: guardrailAction,
          enabled: guardrailEnabled,
        }),
      }
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
              data.detail || "An unknown error occurred, please try again."
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
    <div className="modal-content policy-editor-form ">
      <header className={editMode ? "edit-mode" : ""}>
        <b>
          {!editMode && (
            <>
              <BsDatabaseLock /> Guardrail Details
              {error && <span className="error">Error: {error}</span>}
            </>
          )}
          {editMode && (
            <b>
              <BsCode /> Guardrailing Rule
            </b>
          )}
        </b>
        <div className="spacer" />
        {!editMode && (
          <>
            {action == "update" && (
              <button
                aria-label="delete guardrail"
                className="inline icon secondary danger"
                disabled={loading}
                onClick={props.onDelete}
              >
                <BsTrash />
              </button>
            )}
            <button className="button inline" onClick={props.onClose}>
              Cancel
            </button>
            <button
              aria-label={"modal " + action}
              className="primary inline"
              disabled={loading || !name || !policyCode || !policyCode.trim()}
              onClick={onMutate}
            >
              {action == "update"
                ? loading
                  ? "Updating..."
                  : "Save"
                : loading
                  ? "Creating..."
                  : "Create"}
            </button>
          </>
        )}
        {editMode && (
          <>
            <button
              className="inline icon secondary editmode"
              onClick={() => setEditMode(!editMode)}
              data-tooltip-id="edit-mode"
              data-tooltip-content="Smaller Rule Editor"
              data-tooltip-place="top"
            >
              <BsArrowsAngleContract />
            </button>
          </>
        )}
      </header>
      <div className="main">
        {!editMode && (
          <div className="collapsable" style={{ width: "100%" }}>
            <h3>Name</h3>
            <input
              type="text"
              value={name || ""}
              onChange={(e) => setName(e.target.value)}
              placeholder="Guardrail Name"
              className="policy-name"
            />
            <h3>
              Action
              <i>What to do when the guardrail is triggered.</i>
            </h3>
            <LabelSelect
              value={
                guardrailEnabled ? `${guardrailAction}-enabled` : "log-paused"
              }
              options={guardrailActions}
              onChange={(value) => {
                const selectedAction = guardrailActions.find(
                  (a) => a.value === value
                );
                if (selectedAction) {
                  setGuardrailAction(selectedAction.actionValue);
                  setGuardrailEnabled(selectedAction.enabled);
                }
              }}
            />
          </div>
        )}
        {!editMode && (
          <h3>
            Guardrailing Rule
            <i>The rules to check for this guardrail to be triggered.</i>
            <button
              className="icon inline editmode"
              onClick={() => setEditMode(!editMode)}
              data-tooltip-id="edit-mode"
              data-tooltip-content="Larger Rule Editor"
              data-tooltip-place="top"
            >
              <BsArrowsAngleExpand />
            </button>
          </h3>
        )}
        {!editMode && (
          <div className="editor-container">
            <Editor
              width="100%"
              className="policy-editor"
              defaultLanguage="python"
              value={policyCode}
              options={{
                fontSize: 14,
                minimap: {
                  enabled: false,
                },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                lineNumbers: "on",
                wordWrap: "on",
                wrappingIndent: "same",
              }}
              onChange={(value?: string) => setPolicyCode(value || "")}
              theme="vs-light"
            />
          </div>
        )}
        {editMode && (
          <>
            <div
              className="editor-container full"
              style={{ flex: GUARDRAIL_EVALUATION_ENABLED ? 0 : 1 }}
            >
              <Editor
                width="100%"
                className="policy-editor full"
                defaultLanguage="python"
                value={policyCode}
                options={{
                  fontSize: 14,
                  minimap: {
                    enabled: false,
                  },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  lineNumbers: "on",
                  wordWrap: "on",
                  wrappingIndent: "same",
                }}
                onChange={(value?: string) => setPolicyCode(value || "")}
                theme="vs-light"
              />
              {GUARDRAIL_EVALUATION_ENABLED && (
                <>
                  <button
                    className="inline primary evaluate"
                    onClick={() =>
                      alert("guardrail evaluation is not supported yet")
                    }
                  >
                    <BsTerminal />
                    Evaluate
                  </button>
                </>
              )}
            </div>
            {GUARDRAIL_EVALUATION_ENABLED && (
              <div className="policy-traces">
                <Traces
                  dataset={props.dataset}
                  datasetLoadingError={props.datasetLoadingError}
                  enableAnalyzer={false}
                />
              </div>
            )}
          </>
        )}
        <Tooltip
          id="edit-mode"
          place="top"
          style={{ backgroundColor: "#000", color: "#fff" }}
          className="tooltip"
        />
      </div>
    </div>
  );
}

/**
 * Component for generating policies from problem clusters
 */
function PolicyGenerationModalContent(props) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [selectedCluster, setSelectedCluster] = React.useState("");
  const [generatedPolicy, setGeneratedPolicy] = React.useState("");
  const [planning, setPlanning] = React.useState("");
  const [detectionResults, setDetectionResults] = React.useState([]);

  // Get clusters from the dataset's analysis report, if available
  const analysisReport = props.dataset.extra_metadata?.analysis_report
    ? JSON.parse(props.dataset.extra_metadata.analysis_report)
    : null;

  const clusters = analysisReport?.clustering || [];

  const generatePolicy = async () => {
    if (!selectedCluster) {
      setError("Please select a problem cluster");
      return;
    }

    setLoading(true);
    setError("");

    // Find the selected cluster
    const cluster = clusters.find(c => c.name === selectedCluster);
    if (!cluster) {
      setError("Selected cluster not found");
      setLoading(false);
      return;
    }

    try {
      // Gather sample traces for this cluster
      const traceIds = cluster.issues_indexes.map(idx => idx[0]);
      // Limit to 5 unique trace IDs
      const uniqueTraceIds = [...new Set(traceIds)].slice(0, 5);

      // Fetch the traces
      const tracePromises = uniqueTraceIds.map(id =>
        fetch(`/api/v1/trace/${id}`).then(res => res.json())
      );
      const traces = await Promise.all(tracePromises);

      // Build a properly typed request payload
      const requestPayload: PolicyGenerationRequest = {
        problem_description: selectedCluster,
        traces: traces,
        dataset_id: props.dataset.id,
      };

      // Make the policy generation request
      const response = await fetch("/api/v1/trace/generate-policy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.detail || "Failed to generate policy");
        setLoading(false);
        return;
      }

      // Update state with the generated policy
      setGeneratedPolicy(data.policy_code);
      setPlanning(data.planning || "");
      setDetectionResults(data.detection_results || []);

      setLoading(false);
    } catch (err) {
      console.error("Error generating policy:", err);
      setError("An error occurred while generating the policy");
      setLoading(false);
    }
  };

  const createGuardrailFromPolicy = () => {
    // Pre-fill the policy creation modal with the generated policy
    props.onCreateWithPolicy(generatedPolicy, selectedCluster);
  };

  return (
    <div className="modal-content policy-generator-form">
      <header>
        <b>
          <BsLightningCharge /> Generate Guardrail from Problem Cluster
          {error && <span className="error">Error: {error}</span>}
        </b>
        <div className="spacer" />
        <button className="button inline" onClick={props.onClose}>
          Cancel
        </button>
      </header>
      <div className="main">
        <div className="collapsable" style={{ width: "100%" }}>
          <h3>Select Problem Cluster</h3>
          <select
            value={selectedCluster}
            onChange={(e) => setSelectedCluster(e.target.value)}
            className="cluster-select"
            disabled={loading || clusters.length === 0}
          >
            <option value="">Select a cluster...</option>
            {clusters.map((cluster) => (
              <option key={cluster.name} value={cluster.name}>
                {cluster.name}
              </option>
            ))}
          </select>

          {clusters.length === 0 && (
            <div className="info-message">
              No problem clusters found. Run analysis on your dataset first.
            </div>
          )}

          <div className="action-buttons">
            <button
              className="primary"
              onClick={generatePolicy}
              disabled={loading || !selectedCluster}
            >
              {loading ? "Generating..." : "Generate Policy"}
            </button>
          </div>

          {generatedPolicy && (
            <>
              <h3>Generated Policy</h3>
              <div className="editor-container">
                <Editor
                  width="100%"
                  className="policy-editor"
                  defaultLanguage="python"
                  value={generatedPolicy}
                  options={{
                    fontSize: 14,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    lineNumbers: "on",
                    wordWrap: "on",
                    wrappingIndent: "same",
                    readOnly: true,
                  }}
                  theme="vs-light"
                />
              </div>

              {planning && (
                <>
                  <h3>Planning Information</h3>
                  <div className="planning-info">
                    <pre>{planning}</pre>
                  </div>
                </>
              )}

              <div className="action-buttons">
                <button
                  className="primary"
                  onClick={createGuardrailFromPolicy}
                >
                  Create Guardrail from Policy
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function LabelSelect(props: {
  value: string;
  options: {
    icon?: React.ReactNode;
    title: string;
    description: string;
    value: any;
  }[];
  onChange: (value: any) => void;
}) {
  return (
    <div className="guardrail-action-select">
      {props.options.map((option) => (
        <div
          key={option.value}
          className={`guardrail-action-select-option ${
            option.value === props.value ? "selected" : ""
          }`}
          onClick={() => props.onChange(option.value)}
        >
          {option.icon ? <span className="icon">{option.icon}</span> : null}
          <b>{option.title}</b>
          <span>{option.description}</span>
        </div>
      ))}
    </div>
  );
}

export function SidepaneModal(props: {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
  hasWindowControls?: boolean;
}) {
  return <div className="editor-modal">{props.children}</div>;
}

/**
 * Component for viewing, updating and deleting policies.
 */
export function Guardrails(props: {
  dataset: any;
  datasetLoader: any;
  datasetLoadingError: any;
  username: string;
  datasetname: string;
}) {
  // tracks whether the create policy modal is open.
  const [showCreatePolicyModal, setShowCreatePolicyModal] =
    React.useState(false);
  // tracks the policy to be deleted.
  const [selectedPolicyForDeletion, setSelectedPolicyForDeletion] =
    React.useState(null);
  // tracks the policy to be updated.
  const [selectedPolicyForUpdation, setSelectedPolicyForUpdation] =
    React.useState(null);
  // tracks whether the policy generation modal is open
  const [showPolicyGenerationModal, setShowPolicyGenerationModal] =
    React.useState(false);
  // tracks pre-filled policy code for new policy creation
  const [prefillPolicyCode, setPrefillPolicyCode] = React.useState("");
  // tracks pre-filled policy name for new policy creation
  const [prefillPolicyName, setPrefillPolicyName] = React.useState("");

  const dataset = props.dataset;
  const datasetLoader = props.datasetLoader;

  // get guardrails from metadta
  const guadrails = dataset.extra_metadata?.policies
    ? dataset.extra_metadata.policies
    : [];

  // check if dataset has analysis report
  const hasAnalysisReport = !!dataset.extra_metadata?.analysis_report;

  // sort them by name
  guadrails.sort((a, b) => a.name && a.name.localeCompare(b.name || ""));

  const handleCreateWithPolicy = (policyCode, clusterName) => {
    setPrefillPolicyCode(policyCode);
    setPrefillPolicyName(`Guardrail for ${clusterName}`);
    setShowPolicyGenerationModal(false);
    setShowCreatePolicyModal(true);
  };

  return (
    <div className="panel">
      {/* create modal */}
      {showCreatePolicyModal && (
        <SidepaneModal
          title="Create Policy"
          onClose={() => {
            setShowCreatePolicyModal(false);
            setPrefillPolicyCode("");
            setPrefillPolicyName("");
          }}
          hasWindowControls
        >
          <MutatePolicyModalContent
            dataset={props.dataset}
            datasetLoadingError={props.datasetLoadingError}
            dataset_id={dataset.id}
            policy={prefillPolicyCode ? {
              name: prefillPolicyName,
              content: prefillPolicyCode,
              action: "log",
              enabled: true
            } : null}
            action="create"
            onClose={() => {
              setShowCreatePolicyModal(false);
              setPrefillPolicyCode("");
              setPrefillPolicyName("");
            }}
            onSuccess={() => datasetLoader.refresh()}
          ></MutatePolicyModalContent>
        </SidepaneModal>
      )}
      {/* policy generation modal */}
      {showPolicyGenerationModal && (
        <SidepaneModal
          title="Generate Policy"
          onClose={() => setShowPolicyGenerationModal(false)}
          hasWindowControls
        >
          <PolicyGenerationModalContent
            dataset={props.dataset}
            onClose={() => setShowPolicyGenerationModal(false)}
            onCreateWithPolicy={handleCreateWithPolicy}
          ></PolicyGenerationModalContent>
        </SidepaneModal>
      )}
      {/* delete modal */}
      {selectedPolicyForDeletion && (
        <Modal
          title="Delete Guardrail"
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
        <SidepaneModal
          title="Update Policy"
          onClose={() => setSelectedPolicyForUpdation(null)}
          hasWindowControls
        >
          <MutatePolicyModalContent
            dataset={props.dataset}
            datasetLoadingError={props.datasetLoadingError}
            dataset_id={dataset.id}
            policy={selectedPolicyForUpdation}
            action="update"
            onClose={() => setSelectedPolicyForUpdation(null)}
            onSuccess={() => datasetLoader.refresh()}
            onDelete={() => {
              setSelectedPolicyForDeletion(selectedPolicyForUpdation);
              setSelectedPolicyForUpdation(null);
            }}
          ></MutatePolicyModalContent>
        </SidepaneModal>
      )}
      <header className="toolbar">
        <h1>
          <Link to="/"> /</Link>
          <Link to={`/u/${props.username}`}>{props.username}</Link>/
          {props.datasetname}
          <span> </span>
        </h1>
        <div className="spacer" />
        {hasAnalysisReport && (
          <button
            aria-label="generate guardrail from problem"
            className="button inline generate-guardrail-from-problem"
            onClick={() => setShowPolicyGenerationModal(true)}
          >
            <BsLightningCharge />
            Generate from Problem
          </button>
        )}
        <button
          aria-label="create guardrail"
          className="button primary inline create-guardrail"
          onClick={() => setShowCreatePolicyModal(true)}
        >
          {" "}
          <BsDatabaseLock />
          Create Guardrail
        </button>
      </header>
      <div className="tab-content guardrails">
        <h3>
          <span>
            <BsDatabaseLock />
            Active Guardrails
          </span>
        </h3>
        <div className="guardrail-list">
          {(!dataset.extra_metadata?.policies ||
            dataset.extra_metadata.policies.length === 0) && (
            <div className="empty instructions box no-policies">
              <h2>
                <BsDatabaseLock /> No Guardrails Configured
              </h2>
              <h3>
                Guardrails are rules to secure and steer the actions of your
                agent, and to avoid unintended behavior during operation.
              </h3>
            </div>
          )}
          {guadrails.length > 0 &&
            guadrails.map((policy) => {
              return (
                <div key={policy.id}>
                  <div className="box full setting guardrail-item">
                    <h1 className="policy-label">
                      {policy.enabled ? (
                        <span className="badge live">LIVE</span>
                      ) : (
                        <BsPauseCircle />
                      )}
                      {policy.name}
                    </h1>
                    <div className="guardrail-actions">
                      <button
                        aria-label="edit"
                        className="policy-action inline"
                        onClick={() => setSelectedPolicyForUpdation(policy)}
                      >
                        <BsPencilFill /> Edit
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
        {SUGGETSIONS_ENABLED && (
          <div className="suggestions">
            <h3>
              <span>
                <BsStars /> Guardrail Suggestions
              </span>
            </h3>
            <div className="guardrail-list">
              <div className="empty instructions box semi">
                <h2>
                  <BsFileEarmarkBreak /> Guardrail Suggestions{" "}
                  <span className="badge">Beta</span>
                </h2>
                <h3>
                  As you keep using Invariant, new suggestions for guardrailing
                  rules customized to your agent's behavior will appear here.
                </h3>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
