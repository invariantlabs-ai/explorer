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

// Define interface for suggested policy
interface SuggestedPolicy {
  cluster_name: string;
  policy_code: string;
  planning?: string;
  detection_results: any[];
  detection_rate: number;
}

const SUGGETSIONS_ENABLED = true;
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
 * Component for viewing a suggested guardrail and optionally activating it
 */
function SuggestedGuardrailModalContent(props: {
  dataset: any;
  dataset_id: string;
  suggestedPolicy: SuggestedPolicy;
  onClose: () => void;
  onActivate: (policy: any) => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [name, setName] = React.useState(`Guardrail for ${props.suggestedPolicy.cluster_name}`);
  const [policyCode, setPolicyCode] = React.useState(props.suggestedPolicy.policy_code);
  const [editMode, setEditMode] = React.useState(false);

  const activateGuardrail = () => {
    // Create a policy object for activation
    const policy = {
      name: name,
      content: policyCode,
      action: "log",
      enabled: true
    };

    props.onActivate(policy);
  };

  return (
    <div className="modal-content policy-editor-form">
      <header className={editMode ? "edit-mode" : ""}>
        <b>
          {!editMode && (
            <>
              <BsDatabaseLock /> Suggested Guardrail
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
            <button className="button inline" onClick={props.onClose}>
              Cancel
            </button>
            <button
              aria-label="activate guardrail"
              className="primary inline"
              onClick={activateGuardrail}
              disabled={loading || !name || !policyCode || !policyCode.trim()}
            >
              Make Active
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

            <h3>Problem</h3>
            <div className="problem-description">
              {props.suggestedPolicy.cluster_name}
            </div>

            <h3>Detection Rate</h3>
            <div className="detection-rate">
              {(props.suggestedPolicy.detection_rate * 100).toFixed(0)}% of traces matched this guardrail
            </div>
          </div>
        )}
        {!editMode && (
          <h3>
            Guardrailing Rule
            <i>The suggested rule to detect and prevent this issue.</i>
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
            </div>
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
  // tracks selected suggested guardrail
  const [selectedSuggestedGuardrail, setSelectedSuggestedGuardrail] =
    React.useState<SuggestedPolicy | null>(null);
  // tracks pre-filled policy code for new policy creation
  const [prefillPolicyCode, setPrefillPolicyCode] = React.useState("");
  // tracks pre-filled policy name for new policy creation
  const [prefillPolicyName, setPrefillPolicyName] = React.useState("");
  // tracks suggested policies
  const [suggestedPolicies, setSuggestedPolicies] = React.useState<SuggestedPolicy[]>([]);
  // tracks loading state for suggested policies
  const [loadingSuggestions, setLoadingSuggestions] = React.useState(false);
  // tracks error state for suggested policies
  const [suggestionsError, setSuggestionsError] = React.useState("");

  const dataset = props.dataset;
  const datasetLoader = props.datasetLoader;

  // get guardrails from metadata
  const guadrails = dataset.extra_metadata?.policies
    ? dataset.extra_metadata.policies
    : [];

  // check if dataset has analysis report
  const hasAnalysisReport = !!dataset.extra_metadata?.analysis_report;

  // sort them by name
  guadrails.sort((a, b) => a.name && a.name.localeCompare(b.name || ""));

  // Function to fetch suggested guardrails
  const fetchSuggestedGuardrails = React.useCallback(() => {
    if (!hasAnalysisReport) return;

    setLoadingSuggestions(true);
    setSuggestionsError("");

    fetch("/api/v1/trace/generate-policy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataset_id: dataset.id,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          return response.json().then(data => {
            throw new Error(data.detail || `Error ${response.status}: Failed to load suggestions`);
          });
        }
        return response.json();
      })
      .then((data) => {
        setLoadingSuggestions(false);
        if (data.suggested_policies) {
          setSuggestedPolicies(data.suggested_policies);
        } else {
          setSuggestionsError("No suggested policies were returned from the server.");
        }
      })
      .catch((error) => {
        setLoadingSuggestions(false);
        setSuggestionsError(`Failed to load suggested guardrails: ${error.message}`);
        console.error("Error fetching suggested guardrails:", error);
      });
  }, [dataset.id, hasAnalysisReport]);

  // Fetch suggested guardrails on component mount if dataset has analysis report
  React.useEffect(() => {
    if (hasAnalysisReport && SUGGETSIONS_ENABLED) {
      fetchSuggestedGuardrails();
    }
  }, [fetchSuggestedGuardrails, hasAnalysisReport]);

  // Handle activating a suggested guardrail
  const handleActivateGuardrail = (policy) => {
    fetch(`/api/v1/dataset/${dataset.id}/policy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: policy.name,
        policy: policy.content,
        action: policy.action,
        enabled: policy.enabled,
      }),
    })
      .then((response) => {
        if (response.ok) {
          setSelectedSuggestedGuardrail(null);
          datasetLoader.refresh();
        } else {
          throw new Error("Failed to activate guardrail");
        }
      })
      .catch((error) => {
        console.error("Error activating guardrail:", error);
      });
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
      {/* suggested guardrail modal */}
      {selectedSuggestedGuardrail && (
        <SidepaneModal
          title="Suggested Guardrail"
          onClose={() => setSelectedSuggestedGuardrail(null)}
          hasWindowControls
        >
          <SuggestedGuardrailModalContent
            dataset={props.dataset}
            dataset_id={dataset.id}
            suggestedPolicy={selectedSuggestedGuardrail}
            onClose={() => setSelectedSuggestedGuardrail(null)}
            onActivate={handleActivateGuardrail}
          ></SuggestedGuardrailModalContent>
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
                <BsStars /> Suggested Guardrails
              </span>
              {hasAnalysisReport && loadingSuggestions && (
                <span className="loading-indicator">Loading suggestions...</span>
              )}
              {hasAnalysisReport && !loadingSuggestions && suggestedPolicies.length === 0 && !suggestionsError && (
                <button
                  className="refresh-button inline"
                  onClick={fetchSuggestedGuardrails}
                >
                  Generate Suggestions
                </button>
              )}
            </h3>
            <div className="guardrail-list">
              {suggestionsError && (
                <div className="error-message">
                  {suggestionsError}
                  <button
                    className="retry-button"
                    onClick={fetchSuggestedGuardrails}
                  >
                    Retry
                  </button>
                </div>
              )}
              {!hasAnalysisReport && (
                <div className="empty instructions box semi">
                  <h2>
                    <BsFileEarmarkBreak /> Run Analysis First
                  </h2>
                  <h3>
                    To get guardrail suggestions, please run analysis on your dataset first.
                  </h3>
                </div>
              )}
              {hasAnalysisReport && !loadingSuggestions && suggestedPolicies.length === 0 && !suggestionsError && (
                <div className="empty instructions box semi">
                  <h2>
                    <BsFileEarmarkBreak /> No Suggested Guardrails
                  </h2>
                  <h3>
                    We couldn't find any guardrails to suggest based on your dataset analysis.
                  </h3>
                </div>
              )}
              {suggestedPolicies.length > 0 && (
                <>
                  {suggestedPolicies.map((policy, index) => (
                    <div key={index} className="box full setting guardrail-item suggested">
                      <h1 className="policy-label">
                        <span className="badge suggested">SUGGESTED</span>
                        Guardrail for {policy.cluster_name}
                      </h1>
                      <div className="guardrail-actions">
                        <button
                          aria-label="view suggested guardrail"
                          className="policy-action inline"
                          onClick={() => setSelectedSuggestedGuardrail(policy)}
                        >
                          <BsShieldFillCheck /> View & Activate
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
