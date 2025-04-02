import Editor from "@monaco-editor/react";
import React from "react";
import {
  BsArrowsAngleContract,
  BsArrowsAngleExpand,
  BsBan,
  BsCardList,
  BsCode,
  BsDatabaseLock,
  BsInfoCircleFill,
  BsPauseCircle,
  BsPencilFill,
  BsShieldCheck,
  BsTerminal,
  BsTrash,
} from "react-icons/bs";
import { Link } from "react-router-dom";
import { Tooltip } from "react-tooltip";
import ClockLoader from "react-spinners/ClockLoader";
import { DatasetSelector } from "../../components/DatasetSelector";
import { Modal } from "../../components/Modal";
import { useGuardrailSuggestionFromURL } from "../../lib/guardrail_from_url";
import "./Guardrails.scss";
import {
  GuardrailSuggestion,
  GuardrailSuggestions,
} from "./GuardrailSuggestions";
import { Traces } from "./Traces";
import { Time } from "../../components/Time";

function suggestion_to_guardrail(completedPolicy: GuardrailSuggestion) {
  return {
    id: null,
    name: completedPolicy.cluster_name,
    content: completedPolicy.policy_code,
    action: "block",
    enabled: true,
    source: !completedPolicy.extra_metadata?.from_url ? "suggestions" : "url",
    extra_metadata: {
      suggestion_job_id: completedPolicy.id,
      from_url: completedPolicy.extra_metadata?.from_url,
      // detection rate in synthesis
      detection_rate: completedPolicy.detection_rate,
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
 * Wrapper component that doesn't display the "Private" label
 */
function TracesWithoutPrivate(props) {
  const wrapperRef = React.useRef(null);

  // Use a DOM mutation observer to physically remove "Private" elements after they're rendered
  React.useEffect(() => {
    if (!wrapperRef.current) return;

    // Function to recursively find and remove any elements with "Private" text
    const removePrivateElements = (parentNode: Element) => {
      // Handle text nodes directly
      const walker = document.createTreeWalker(
        parentNode,
        NodeFilter.SHOW_TEXT,
        null
      );

      const nodesToRemove: Node[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        // If the text contains "Private" and is not within a script or style
        if (
          node.textContent?.includes("Private") &&
          node.parentElement &&
          !["SCRIPT", "STYLE"].includes(node.parentElement.tagName)
        ) {
          // Find the closest meaningful container to remove
          let target: Node = node;
          let current: Node | null = node;

          // Walk up to find a suitable container (span, div, etc.)
          while (
            current &&
            current.parentElement &&
            current.parentElement !== parentNode &&
            !/span|div|p|h\d|li|a/i.test(current.parentElement.tagName)
          ) {
            current = current.parentElement;
          }

          // If found a suitable container, that's our target to remove
          if (current) {
            target = current;
          }

          nodesToRemove.push(target);
        }
      }

      // Remove nodes in reverse order to avoid index shifting
      for (let i = nodesToRemove.length - 1; i >= 0; i--) {
        const nodeToRemove = nodesToRemove[i];
        if (nodeToRemove.parentElement) {
          nodeToRemove.parentElement.removeChild(nodeToRemove);
        }
      }

      // Also handle elements with 'private' class
      const privateElements = parentNode.querySelectorAll('.private, [class*="private"]');
      privateElements.forEach((el: Element) => {
        if (el.parentElement) {
          el.parentElement.removeChild(el);
        }
      });
    };

    // Initial removal
    removePrivateElements(wrapperRef.current);

    // Set up mutation observer to handle dynamically added content
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) { // Element node
              removePrivateElements(node as Element);
            }
          });
        }
      });
    });

    // Start observing
    observer.observe(wrapperRef.current, {
      childList: true,
      subtree: true
    });

    // Cleanup
    return () => {
      observer.disconnect();
    };
  }, []);

  // Pass all props to the Traces component with additional flags to disable as much UI as possible
  return (
    <div className="traces-clean-wrapper" ref={wrapperRef}>
      <Traces
        {...props}
        withoutHeader={true}
        hidePrivate={true}
        hideAnnotations={true}
      />
    </div>
  );
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
  username: string;
  datasetname: string;
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
    (props.policy?.enabled || true) as boolean
  );

  const [editMode, setEditMode] = React.useState(false);

  // Generate a stable storage key based on policy details
  const storageKey = React.useMemo(() => {
    const policyId = props.policy?.id || "new-policy";
    const datasetId = props.dataset_id;
    return `guardrail-run-results-${datasetId}-${policyId}`;
  }, [props.policy?.id, props.dataset_id]);

  // New state for guardrail run
  const [runningGuardrail, setRunningGuardrail] = React.useState(false);
  const [guardrailRunComplete, setGuardrailRunComplete] = React.useState(false);
  const [triggeredTraces, setTriggeredTraces] = React.useState<any[]>([]);
  const [totalTracesChecked, setTotalTracesChecked] = React.useState(0);
  const [lastSaved, setLastSaved] = React.useState<string | null>(null);
  const [loadedFromStorage, setLoadedFromStorage] = React.useState(false);

  // State to control display of traces in a modal
  const [showTracesModal, setShowTracesModal] = React.useState(false);

  // Track if the policy has been modified since loading
  const [policyModified, setPolicyModified] = React.useState(false);

  // Check if policy needs to be saved before running
  const needsSave = props.action === "create" || policyModified;

  // Load saved results from localStorage on component mount
  React.useEffect(() => {
    try {
      const savedResults = localStorage.getItem(storageKey);
      if (savedResults) {
        const parsedResults = JSON.parse(savedResults);
        setTriggeredTraces(parsedResults.triggeredTraces || []);
        setTotalTracesChecked(parsedResults.totalTracesChecked || 0);
        setLastSaved(parsedResults.timestamp || null);
        setGuardrailRunComplete(true);
        setLoadedFromStorage(true);
      }
    } catch (e) {
      console.error("Error loading saved guardrail results:", e);
    }
  }, [storageKey]);

  // Update policyModified when policyCode changes
  React.useEffect(() => {
    if (props.policy?.content !== policyCode) {
      setPolicyModified(true);
    }
  }, [policyCode, props.policy]);

  // Save results to localStorage when they change
  React.useEffect(() => {
    if (guardrailRunComplete) {
      const timestamp = new Date().toISOString();
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            triggeredTraces,
            totalTracesChecked,
            timestamp,
          })
        );
        setLastSaved(timestamp);
      } catch (e) {
        console.error("Error saving guardrail results:", e);
      }
    }
  }, [triggeredTraces, totalTracesChecked, guardrailRunComplete, storageKey]);

  // Add effect for handling modal keyboard events and body scroll
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showTracesModal) {
        setShowTracesModal(false);
      }
    };

    // Add event listener for escape key
    document.addEventListener('keydown', handleKeyDown);

    // Lock body scroll when modal is open
    if (showTracesModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [showTracesModal]);

  const clearSavedResults = () => {
    localStorage.removeItem(storageKey);
    setTriggeredTraces([]);
    setTotalTracesChecked(0);
    setGuardrailRunComplete(false);
    setLastSaved(null);
  };

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
        setPolicyModified(false);
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

  // New function to run guardrail against dataset
  const runGuardrail = () => {
    // If the policy needs to be saved first, show a message
    if (needsSave) {
      setError("Please save the guardrail before running it.");
      return;
    }

    setRunningGuardrail(true);
    setTriggeredTraces([]);
    setGuardrailRunComplete(false);
    setTotalTracesChecked(0);
    setLoadedFromStorage(false);
    setError("");

    // Prepare the request to check the policy against the dataset
    fetch(`/api/v1/dataset/byid/${props.dataset_id}/check-policy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        policy: policyCode,
        parameters: {}, // Optional parameters for policy
        policy_check_url: `${window.location.origin}/api/v1/policy/check`,
        cookie: document.cookie, // Send the current cookie for authentication
      }),
    })
      .then(response => {
        if (!response.ok) {
          return response.json().then(data => {
            // Extract and format detailed error message if available
            let errorMsg = "Failed to run guardrail";
            if (data.detail) {
              // If the detail message is very long, truncate it for display
              errorMsg = data.detail.length > 200
                ? data.detail.substring(0, 200) + "..."
                : data.detail;

              // Log the full error to console for debugging
              console.error("Full error details:", data.detail);
            }
            throw new Error(errorMsg);
          }).catch(err => {
            // Handle case where response isn't valid JSON
            if (err.name === "SyntaxError") {
              throw new Error("Failed to run guardrail: Invalid response format");
            }
            throw err;
          });
        }
        return response.json();
      })
      .then(data => {
        // Store the total number of traces checked
        setTotalTracesChecked(data.total_traces || 0);

        if (data.triggered_traces && data.triggered_traces.length > 0) {
          // Fetch detailed information for each triggered trace
          const fetchPromises = data.triggered_traces.map(traceId =>
            fetch(`/api/v1/trace/${traceId}`)
              .then(response => {
                if (!response.ok) {
                  console.warn(`Failed to fetch trace ${traceId}`);
                  // Return a minimal trace object with the ID to preserve it
                  return { id: traceId, index: null };
                }
                return response.json();
              })
              .catch(error => {
                console.warn(`Error fetching trace ${traceId}:`, error);
                // Return a minimal trace object with the ID to preserve it
                return { id: traceId, index: null };
              })
          );

          Promise.all(fetchPromises)
            .then(traces => {
              // Format traces for display, preserving all trace IDs even if fetch failed
              const formattedTraces = traces
                .filter(Boolean)
                .map(trace => ({
                  id: trace.id,
                  index: trace.index,
                  name: trace.name || `Trace ${trace.index || 'Unknown'}`,
                  messages: trace.messages || [],
                  time_created: trace.time_created || new Date().toISOString(),
                }))
                // Filter out traces without index if needed for Traces component
                .filter(trace => trace.index !== null);

              setTriggeredTraces(formattedTraces);
              setRunningGuardrail(false);
              setGuardrailRunComplete(true);
            })
            .catch(error => {
              console.error("Error fetching trace details:", error);
              setError(`Error fetching trace details: ${error.message}`);
              setRunningGuardrail(false);
              setGuardrailRunComplete(true);
            });
        } else {
          // No traces triggered the guardrail
          setTriggeredTraces([]);
          setRunningGuardrail(false);
          setGuardrailRunComplete(true);
        }
      })
      .catch(error => {
        console.error("Error running guardrail:", error);
        setError(`Error running guardrail: ${error.message}`);
        setRunningGuardrail(false);
        setGuardrailRunComplete(true);
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
                onClick={props.onDelete || (() => {})}
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
            {props.policy?.source == "suggestions" &&
              props.policy?.extra_metadata?.detection_rate && (
                <div className="banner-note info">
                  <BsInfoCircleFill />
                  <span>
                    Automatically generated rule (detection rate of{" "}
                    <code>
                      {props.policy.extra_metadata.detection_rate * 100}%
                    </code>
                    ) . Please review before deployment.
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
            <div className="editor-container full">
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

        {/* New section for running guardrail */}
        {!editMode && (
          <div className="guardrail-run-section">
            <h3>
              Run Guardrail
              <i>Test this guardrail against your dataset.</i>
            </h3>
            <div className="guardrail-run-actions">
              <button
                aria-label="run guardrail"
                className="button primary inline"
                disabled={runningGuardrail || !policyCode || !policyCode.trim()}
                onClick={runGuardrail}
              >
                <BsTerminal />
                {runningGuardrail ? (
                  <>
                    <ClockLoader size={12} color="#fff" />
                    <span style={{ marginLeft: "8px" }}>Running...</span>
                  </>
                ) : needsSave ? "Save Guardrail First" : "Run Against Dataset"}
              </button>
            </div>

            {needsSave && (
              <div className="banner-note">
                <BsInfoCircleFill />
                <span>Save the guardrail before running it against your dataset.</span>
              </div>
            )}

            {guardrailRunComplete && triggeredTraces.length > 0 && (
              <div className="guardrail-results">
                <h4>
                  <span className="title">Guardrail Triggered Traces</span>
                  <span className="count-badge">{triggeredTraces.length}/{totalTracesChecked}</span>
                  <button
                    className="clear-results-btn"
                    onClick={clearSavedResults}
                    aria-label="Clear saved results"
                    title="Clear saved results"
                  >
                    <BsTrash />
                  </button>
                </h4>
                <div className="saved-results-info">
                  {loadedFromStorage ? (
                    <span className="storage-badge">
                      <BsInfoCircleFill /> Showing saved results
                    </span>
                  ) : (
                    <span>Results are saved automatically and will persist across tabs.</span>
                  )}
                  {lastSaved && (
                    <span className="last-saved">
                      Last run: <Time>{lastSaved}</Time>
                    </span>
                  )}
                </div>
                <div className="trace-list-summary">
                  <div className="summary-info">
                    <span>{triggeredTraces.length} traces triggered this guardrail</span>
                  </div>
                  <button
                    className="button primary inline view-traces-btn"
                    onClick={() => setShowTracesModal(true)}
                    disabled={triggeredTraces.length === 0 || runningGuardrail}
                  >
                    <BsTerminal /> {runningGuardrail ? "Loading..." : "View Traces"}
                  </button>
                </div>
              </div>
            )}

            {guardrailRunComplete && triggeredTraces.length === 0 && (
              <div className="guardrail-results">
                <div className="banner-note info">
                  <BsInfoCircleFill />
                  <span>
                    {loadedFromStorage && <span className="storage-badge-inline">Saved results: </span>}
                    No traces triggered this guardrail out of {totalTracesChecked} total traces checked.
                    <button
                      className="clear-results-btn text"
                      onClick={clearSavedResults}
                      aria-label="Clear saved results"
                    >
                      Clear saved results
                    </button>
                  </span>
                </div>
                {lastSaved && (
                  <div className="saved-timestamp">
                    Last run: <Time>{lastSaved}</Time>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="banner-note error" style={{ marginTop: "15px", padding: "15px", borderRadius: "4px", backgroundColor: "#ffeded" }}>
                <BsInfoCircleFill style={{ color: "#d32f2f" }} />
                <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{error}</span>
              </div>
            )}
          </div>
        )}
        <Tooltip
          id="trace-id-tooltip"
          place="top"
          style={{ backgroundColor: "#000", color: "#fff" }}
          className="tooltip"
        />

        {/* Modal for viewing triggered traces */}
        {showTracesModal && triggeredTraces.length > 0 && triggeredTraces.filter(trace => trace.id).length > 0 && (
          <div
            className="traces-modal-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowTracesModal(false);
              }
            }}
          >
            <div className="traces-modal-container">
              <div className="traces-modal-header">
                <h2>
                  <BsShieldCheck />
                  {triggeredTraces.length} Traces Triggered by "{name}" Guardrail
                </h2>
                <button
                  className="close-button"
                  onClick={() => setShowTracesModal(false)}
                  aria-label="Close modal"
                >
                  ×
                </button>
              </div>
              <div className="traces-modal-body">
                <TracesWithoutPrivate
                  dataset={props.dataset}
                  datasetLoadingError={props.datasetLoadingError}
                  enableAnalyzer={false}
                  username={props.username}
                  datasetname={props.datasetname}
                  traceIndex={null}
                  query={`idfilter:${name}-guardrail:${triggeredTraces.filter(trace => trace.id).map(trace => trace.id).join(',')}`}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
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
            username={props.username}
            datasetname={props.datasetname}
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
            username={props.username}
            datasetname={props.datasetname}
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
            username={props.username}
            datasetname={props.datasetname}
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
