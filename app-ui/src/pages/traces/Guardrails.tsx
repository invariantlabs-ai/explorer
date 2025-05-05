import Editor from "@monaco-editor/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BsArrowsAngleContract,
  BsArrowsAngleExpand,
  BsBan,
  BsCardList,
  BsCode,
  BsFillSignTurnSlightRightFill,
  BsGearWideConnected,
  BsInfoCircleFill,
  BsMask,
  BsPauseCircle,
  BsPencilFill,
  BsShieldCheck,
  BsTerminal,
  BsTransparency,
  BsTrash,
  BsX,
  BsXCircle,
} from "react-icons/bs";
import { Link } from "react-router-dom";
import { Tooltip } from "react-tooltip";
import { DatasetSelector } from "../../components/DatasetSelector";
import { Modal } from "../../components/Modal";
import { useGuardrailSuggestionFromURL } from "../../lib/guardrail_from_url";
import "./Guardrails.scss";
import {
  GuardrailSuggestion,
  GuardrailSuggestions,
} from "./GuardrailSuggestions";
import { Traces } from "./Traces";
import { GuardrailsIcon } from "../../components/Icons";
import { PolicyCheckResult, useDatasetGuardrailsChecker } from "../../lib/GuardrailsChecker";
import { PolicyEditor } from "../playground/policyeditor";

const GUARDRAIL_EVALUATION_ENABLED = true;

function suggestion_to_guardrail(completedPolicy: GuardrailSuggestion) {
  return {
    id: null,
    name: completedPolicy.policy_name || completedPolicy.cluster_name, // fallback to cluster name
    content: completedPolicy.policy_code,
    action: "block",
    enabled: true,
    source: !completedPolicy.extra_metadata?.from_url ? "suggestions" : "url",
    extra_metadata: {
      suggestion_job_id: completedPolicy.id,
      from_url: completedPolicy.extra_metadata?.from_url,
      // detection rate in synthesis
      detection_rate: completedPolicy.detection_rate,
      // from rule library
      from_rule_library: completedPolicy.extra_metadata?.from_rule_library,
    },
  };
}

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
 * Transforms a list of results into a mapping of index to result.
 */
export function useResultsByIndex(results: PolicyCheckResult[]): Record<number, PolicyCheckResult> {
  const [resultsByIndex, setResultsByIndex] = useState<Record<number, PolicyCheckResult>>({})

  useEffect(() => {
    const mapping = results.reduce((acc, result) => {
      acc[result.index] = result
      return acc
    }, {} as Record<number, PolicyCheckResult>);
    setResultsByIndex(mapping)
  }, [results])

  return resultsByIndex
}

/**
 * Content to show in the modal when updating or creating a policy (from scratch or from a suggestion).
 */
function MutatePolicyModalContent(props: {
  dataset_id: string;
  dataset: any;
  datasetLoadingError: any;
  onClose: () => void;
  onSuccess: () => void;
  onDelete?: () => void;
  action: "create" | "update";
  policy?: {
    id: string | null;
    name: string;
    content: string;
    action: string;
    enabled: boolean;
    extra_metadata?: any;
    // where this policy came from (e.g. suggestions, url, or not set if user created)
    source?: string;
  };
}) {
  const defaultPolicyCode = `# this is a sample guardrail policy.\nraise "Something went wrong" if:\n   (msg: Message)\n   "error" in msg.content\n`;
  const action = props.action;
  const [name, setName] = React.useState(
    props.policy ? props.policy.name : "New Guardrail"
  );
  const [policyCode, setPolicyCode] = React.useState(
    props.policy?.content || defaultPolicyCode
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const [guardrailAction, setGuardrailAction] = React.useState(
    props.policy?.action || "log"
  );

  const [guardrailEnabled, setGuardrailEnabled] = React.useState(
    (props.policy?.enabled || false) as boolean
  );

  const [editMode, _setEditMode] = React.useState(false);

  const setEditMode = (value: boolean) => {
    _setEditMode(value);
    if (editMode && evaluator.isEvaluating) {
      evaluator.stopCheck();
    }
  }

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
    // {
    //   title: "Mask",
    //   description: "The guardrail will lead to a masked response.",
    //   value: "mask",
    //   actionValue: "mask",
    //   icon: <BsTransparency />,
    //   enabled: false,
    //   disabled: true,
    // },
    // {
    //   title: "Steer",
    //   description: "The guardrail will attempt to steer the agent to take a different action.",
    //   value: "steer",
    //   actionValue: "steer",
    //   icon: <BsFillSignTurnSlightRightFill />,
    //   enabled: false,
    //   disabled: true,
    // },
  ];
  const evaluator = useDatasetGuardrailsChecker(props.dataset_id);
  const ApiKeyModal = evaluator.ApiKeyModal;

  const onEvaluate = () => {
    evaluator.startCheck(policyCode);
  };

  useEffect(() => {
    if (evaluator.error) {
      if (evaluator.error.includes("aborted")) {
        // when aborted by the user, do not show an error
        return;
      }
      alert("Error during guardrail evaluation: " + evaluator.error);
    }
  }, [evaluator.error]);

  const triggered_traces = evaluator.results.filter(r => r.triggered)

  const onMutate = () => {
    if ((!props.policy || !props.policy.id) && action == "update") {
      throw new Error("A policy with ID is required to update a policy.");
    }

    setLoading(true);
    fetch(
      action == "update"
        ? `/api/v1/dataset/${props.dataset_id}/policy/${props.policy!.id}`
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
          extra_metadata: props.policy?.extra_metadata || {},
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

  const modalRef = useRef<HTMLDivElement>(null);

  // on hiding of modal, stop evaluator
  useEffect(() => {
    if (!modalRef.current && evaluator.isEvaluating) {
      evaluator.stopCheck();
    }
  }, [modalRef, evaluator]);

  const resultsByIndex = useResultsByIndex(evaluator.results)

  const annotationsProvider = (trace: { index: number } | null) => {
    if (!trace) {
      return null
    }
    const result = resultsByIndex[trace.index]

    if (result) {
      let annotations = {} as any[]
      for (const error of result.errors || []) {
        let annotationRages = [] as any[]

        for (const range of error.ranges || []) {
          annotationRages.push({
            "content": error.args.join(" ") + Object.entries(error.kwargs).map(([k, v]) => `${k}=${v}`).join(" "),
            "address": range,
            "index": annotationRages.length,
            "extra_metadata": {
              "source": "guardrails-error"
            }
          })
        }

        // add all the annotation ranges to the annotations
        for (const annotation of annotationRages) {
          if (!annotations[annotation.address]) {
            annotations[annotation.address] = []
          }
          annotations[annotation.address].push(annotation)
        }
      }

      return annotations
    }
    return null
  }

  return (<><ApiKeyModal />
    <div className="modal-content policy-editor-form " ref={modalRef}>
      <header className={editMode ? "edit-mode" : ""}>
        <b>
          {!editMode && (
            <>
              <GuardrailsIcon /> Guardrail Details
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
                onClick={props.onDelete || (() => { })}
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
            {action == "update" && (
              <button
                aria-label="delete guardrail"
                className="inline icon secondary danger"
                disabled={loading}
                onClick={props.onDelete || (() => { })}
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
      </header>
      <div className="guardrails-main">
        {!editMode && (
          <div className="collapsable" style={{ width: "100%" }}>
            {props.policy?.source == "suggestions" &&
              props.policy?.extra_metadata?.detection_rate !== undefined &&
              !props.policy?.extra_metadata?.from_rule_library && (
                <div className="banner-note info">
                  <BsInfoCircleFill />
                  <span>
                    Automatically generated rule. Please review before
                    deployment.
                  </span>
                </div>
              )}
            {/* warn about template */}
            {props.policy?.source == "url" && (
              <div className="banner-note">
                <BsInfoCircleFill />
                <span>
                  This guardrailing rule is a template. Please review before
                  deployment.
                </span>
              </div>
            )}
            {props.policy?.extra_metadata?.from_url && (
              <>
                <h3>Dataset</h3>
                <DatasetSelector
                  initialDatasetName={props.dataset.name}
                  onSelect={(datasetName: string) => {
                    // set 'last-picked-dataset' in localStorage. This is used in DeployGuardrail.tsx
                    // to redirect to the selected dataset, next time the /deploy-guardrail page is loaded
                    // with a pre-filled guardrail code
                    localStorage.setItem("last-picked-dataset", datasetName);

                    // replace /u/<user>/<dataset> dataset name in the url
                    // with the selected dataset name
                    const url = new URL(window.location.href);
                    const pathParts = url.pathname.split("/");
                    const userIndex = pathParts.indexOf("u");
                    const datasetIndex = userIndex + 2;
                    if (datasetIndex < pathParts.length) {
                      pathParts[datasetIndex] = datasetName;
                      url.pathname = pathParts.join("/");
                      window.history.pushState({}, "", url.toString());
                    }
                    // reload the page to load the new dataset
                    window.location.reload();
                  }}
                />
              </>
            )}
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
            {/* evaluate button that also opens edit mode */}
            <button
              className="inline editmode primary"
              onClick={() => {
                setEditMode(true);
                onEvaluate();
              }}
            >
              <BsTerminal /> Evaluate
            </button>
          </h3>
        )}
        {!editMode && (
          <div className="editor-container">
            <PolicyEditor
              width="100%"
              className="policy-editor"
              defaultLanguage="python"
              value={policyCode}
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
              <PolicyEditor
                width="100%"
                defaultLanguage="python"
                value={policyCode}
                fontSize={14}
                onChange={(value?: string) => setPolicyCode(value || "")}
                theme="vs-light"
                className="policy-editor full"
              />
              {GUARDRAIL_EVALUATION_ENABLED && (
                <>
                  <div className="evaluator-controls">
                    {evaluator.progress > 0 && (
                      <span className="secondary">
                        {evaluator.numMatches} matches
                      </span>
                    )}
                    <button
                      className="inline primary evaluate"
                      onClick={!evaluator.isEvaluating ? onEvaluate : evaluator.stopCheck}>
                      {evaluator.isEvaluating ?
                        <><BsX /> Cancel</> :
                        <><BsTerminal /> Evaluate</>}
                      {evaluator.isEvaluating && (
                        <span className="progress">
                          {evaluator.progress} / {evaluator.numTraces}
                        </span>
                      )}
                    </button>
                    <button
                      className="icon inline editmode"
                      onClick={() => setEditMode(!editMode)}
                      data-tooltip-id="edit-mode"
                      data-tooltip-content="Larger Rule Editor"
                      data-tooltip-place="top"
                    >
                      <BsArrowsAngleContract />
                    </button>
                  </div>
                </>
              )}
            </div>
            {GUARDRAIL_EVALUATION_ENABLED && (
              <div className="policy-traces">
                {triggered_traces.length > 0 && (
                  <Traces
                    dataset={props.dataset}
                    datasetLoadingError={props.datasetLoadingError}
                    enableAnalyzer={false}
                    toolbarItems={{
                      expandCollapse: true
                    }}
                    annotationsProvider={annotationsProvider}
                    indices={{ "all": { "traces": triggered_traces.map(r => r.index) } }}
                  />
                )}
                {triggered_traces.length == 0 && !evaluator.isEvaluating && (
                  <div className="empty instructions box no-policies">
                    <h2>
                      <BsXCircle /> No Matches
                    </h2>
                    <h3>
                      Your guardrailing rule does not match any traces.
                    </h3>
                  </div>
                )}
                {evaluator.isEvaluating && triggered_traces.length == 0 && (
                  <div className="empty instructions box no-policies">
                    <h2>
                      <BsGearWideConnected className="spin" /> Evaluating Guardrailing Rule <span className="progress"> {evaluator.progress} / {evaluator.numTraces}</span>
                    </h2>
                    <h3>
                      Invariant is evaluating your guardrailing rule on your traces.
                    </h3>
                    {/* cancel button */}
                    <button
                      aria-label="cancel"
                      className="policy-action inline secondary cancel"
                      onClick={() => evaluator.stopCheck()}
                    >
                      Cancel
                    </button>
                  </div>
                )}
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
    </div >
  </>);
}

/**
 * Radio button-like component to select a guardrail action.
 *
 * Example:
 *
 * [Block | The agent is blocked from executing any further actions.]
 * |[Log | The agent continues to execute but a failure is logged.]|
 * [Paused | The guardrail is paused and will not be checked.]
 */
export function LabelSelect(props: {
  value: string;
  options: {
    icon?: React.ReactNode;
    title: string;
    description: string;
    value: any;
    disabled?: boolean;
  }[];
  onChange: (value: any) => void;
}) {
  return (
    <div className="guardrail-action-select">
      {props.options.map((option) => (
        <div
          key={option.value}
          className={`guardrail-action-select-option ${option.value === props.value ? "selected" : ""
            } ${option.disabled ? "disabled" : ""}`}
          onClick={() => props.onChange(option.value)}
          aria-label={option.value}
        >
          {option.icon ? <span className="icon">{option.icon}</span> : null}
          <b>{option.title}</b>
          <span>{option.description}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Layout for the editor modal (to create and edit guardrails).
 */
export function EditorModal(props: {
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
  // tracks the selected policy suggestion.
  const [selectedPolicySuggestion, setSelectedPolicySuggestion] =
    React.useState<GuardrailSuggestion | null>(null);
  // track guardrail suggestion passed via URL
  const [urlGuardrailSuggestion, clearGuardrailURL] =
    useGuardrailSuggestionFromURL();

  const dataset = props.dataset;
  const datasetLoader = props.datasetLoader;

  // get guardrails from dataset metadata
  const guardrails = dataset.extra_metadata?.policies
    ? dataset.extra_metadata.policies
    : [];

  // sort them by name
  guardrails.sort((a, b) => a.name && a.name.localeCompare(b.name || ""));

  // collect all guardrail suggestion_job_ids (guardrails that were applied that come from
  // some suggestion job)
  const suggestionJobIds = new Set(
    guardrails
      .filter((policy) => policy.extra_metadata?.suggestion_job_id)
      .map((policy) => policy.extra_metadata.suggestion_job_id)
  ) as Set<string>;

  return (
    <div className="panel">
      {/* create modal */}
      {showCreatePolicyModal && (
        <EditorModal
          title="Create Guardrail"
          onClose={() => setShowCreatePolicyModal(false)}
          hasWindowControls
        >
          <MutatePolicyModalContent
            dataset={props.dataset}
            datasetLoadingError={props.datasetLoadingError}
            dataset_id={dataset.id}
            action="create"
            onClose={() => setShowCreatePolicyModal(false)}
            onSuccess={() => datasetLoader.refresh()}
          ></MutatePolicyModalContent>
        </EditorModal>
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
        <EditorModal
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
        </EditorModal>
      )}
      {/* create from suggestion modal */}
      {(urlGuardrailSuggestion || selectedPolicySuggestion) && (
        <EditorModal
          title="Create Guardrail from Suggestion"
          onClose={() => setSelectedPolicySuggestion(null)}
          hasWindowControls
        >
          <MutatePolicyModalContent
            dataset={props.dataset}
            datasetLoadingError={props.datasetLoadingError}
            dataset_id={dataset.id}
            policy={suggestion_to_guardrail(
              urlGuardrailSuggestion || selectedPolicySuggestion!
            )}
            action="create"
            onClose={() => {
              setSelectedPolicySuggestion(null);
              if (urlGuardrailSuggestion) {
                clearGuardrailURL();
              }
            }}
            onSuccess={() => datasetLoader.refresh()}
          ></MutatePolicyModalContent>
        </EditorModal>
      )}
      <header className="toolbar">
        <h1>
          <Link to="/"> /</Link>
          <Link to={`/ u / ${props.username}`}>{props.username}</Link>/
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
          <GuardrailsIcon />
          Create Guardrail
        </button>
      </header>
      <div className="tab-content guardrails">
        <h3>
          <span>
            <GuardrailsIcon />
            Active Guardrails
          </span>
        </h3>
        <div className="guardrail-list">
          {(!dataset.extra_metadata?.policies ||
            dataset.extra_metadata.policies.length === 0) && (
              <div className="empty instructions box no-policies">
                <h2>
                  <GuardrailsIcon /> No Guardrails Configured
                </h2>
                <h3>
                  Guardrails are rules to secure and steer the actions of your
                  agent, and to avoid unintended behavior during operation.
                </h3>
              </div>
            )}
          {guardrails.length > 0 &&
            guardrails.map((policy) => {
              return (
                <div key={policy.id}>
                  <div className="box full setting guardrail-item">
                    <h1 className="policy-label">
                      {policy.enabled ? (
                        <>
                          <span className="badge live">LIVE</span>
                          <BsShieldCheck />
                        </>
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
        <GuardrailSuggestions
          dataset={dataset}
          setSelectedPolicySuggestion={setSelectedPolicySuggestion}
          suggestionJobIds={suggestionJobIds}
        />
      </div>
    </div>
  );
}