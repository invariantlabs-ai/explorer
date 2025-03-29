import Editor from "@monaco-editor/react";
import React from "react";
import {
  BsArrowsAngleContract,
  BsArrowsAngleExpand,
  BsBan,
  BsCardList,
  BsCheck2,
  BsCheckCircleFill,
  BsCode,
  BsDatabaseLock,
  BsExclamationTriangle,
  BsGearWideConnected,
  BsInfoCircle,
  BsPauseCircle,
  BsPencilFill,
  BsShieldCheck,
  BsShieldExclamation,
  BsStars,
  BsTerminal,
  BsTrash,
  BsX,
  BsXCircle,
} from "react-icons/bs";
import { Link } from "react-router-dom";
import { Tooltip } from "react-tooltip";
import { Modal } from "../../components/Modal";
import "./Guardrails.scss";
import { alertModelAccess } from "./ModelModal";
import { Traces } from "./Traces";

// Enable the suggestions section for policy synthesis
const GUARDRAIL_SUGGESTIONS_ENABLED = true;
const GUARDRAIL_EVALUATION_ENABLED = false;

// Poll interval in milliseconds
const POLL_INTERVAL = 5000;

// Job status values
const JOB_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

// Reuse the same template API key as in Analyzer.tsx
const TEMPLATE_API_KEY = "<api key on the Explorer above>";

/**
 * Parse the analyzer configuration from localStorage
 */
function parseAnalyzerConfig(configType: string = "single"): {
  endpoint: string;
  apikey: string;
} {
  try {
    const storedConfig =
      localStorage.getItem("analyzerConfig-" + configType) || "{}";
    const config = JSON.parse(storedConfig);
    const endpoint =
      config.endpoint || "https://preview-explorer.invariantlabs.ai/";
    const apikey = config.apikey || "";
    return { endpoint, apikey };
  } catch (e) {
    console.error("Failed to parse analyzer config:", e);
    return {
      endpoint: "https://preview-explorer.invariantlabs.ai/",
      apikey: "",
    };
  }
}

// Type definitions for policy jobs and suggestions
interface PolicyJob {
  id: string;
  extra_metadata: {
    type: string;
    status: string;
    name: string;
    job_id: string;
    endpoint: string;
    cluster_name: string;
    num_processed?: number;
    total?: number;
  };
  secret_metadata?: {
    apikey?: string;
  };
}

interface CompletedPolicy {
  status: string;
  policy_code: string;
  success: boolean;
  detection_rate: number;
  job_id: string;
  cluster_name: string;
  from_metadata?: boolean;

  already_applied?: boolean; // Flag to indicate if this policy was already applied
}

function suggestion_to_policy(completedPolicy: CompletedPolicy) {
  return {
    id: null,
    name: completedPolicy.cluster_name,
    content: completedPolicy.policy_code,
    action: "block",
    enabled: true,
    extra_metadata: {
      suggestion_job_id: completedPolicy.job_id,
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
 * Content to show in the modal for configuring policy synthesis.
 */
function PolicySynthesisModalContent(props) {
  // Get the API URL and key from the analyzer config
  const { endpoint, apikey } = parseAnalyzerConfig();

  const [apiUrl, setApiUrl] = React.useState(endpoint);
  const [apiKey, setApiKey] = React.useState(apikey);
  const [loading, setLoading] = React.useState(false);
  const [loadingStatus, setLoadingStatus] = React.useState("");
  const [error, setError] = React.useState("");

  const onGenerate = async () => {
    setLoading(true);
    setError("");

    if (apiKey === TEMPLATE_API_KEY) {
      setLoading(false);
      alertModelAccess(
        "Please provide a valid API key in the Analyzer settings"
      );
      return;
    }

    try {
      // First, cancel any in-progress policy synthesis jobs
      setLoadingStatus("Canceling any active jobs...");
      await fetch(`/api/v1/dataset/byid/${props.dataset_id}/policy-synthesis`, {
        method: "DELETE",
      });

      // Next, delete any existing generated policies from metadata
      setLoadingStatus("Clearing previous suggestions...");
      await fetch(
        `/api/v1/dataset/byid/${props.dataset_id}/generated-policies`,
        {
          method: "DELETE",
        }
      );

      // Then, prepare the request payload for new policy synthesis
      setLoadingStatus("Starting policy generation...");
      const payload = {
        apiurl: apiUrl,
        apikey: apiKey,
      };

      // Make the API request to start policy synthesis
      const response = await fetch(
        `/api/v1/dataset/byid/${props.dataset_id}/policy-synthesis`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (response.ok) {
        const data = await response.json();
        setLoading(false);
        setLoadingStatus("");
        props.onSuccess(data);
        props.onClose();
      } else {
        const data = await response.json();
        setLoading(false);
        setLoadingStatus("");
        setError(data.detail || "An error occurred while generating policies");
      }
    } catch (error) {
      setLoading(false);
      setLoadingStatus("");
      setError("An error occurred: " + (error as Error).message);
    }
  };

  return (
    <div className="form policy-synthesis-form">
      <p>
        Generate guardrail suggestions based on the clusters identified in your
        dataset analysis. This will create guardrails tailored to the patterns
        found in your data.
      </p>

      <div className="banner-note">
        <BsInfoCircle /> Only high-quality guardrail suggestions will be shown.
      </div>

      {loading && loadingStatus && (
        <div className="status-message">{loadingStatus}</div>
      )}
      {error && <div className="error">{error}</div>}

      <div className="form-actions">
        <button onClick={props.onClose}>Cancel</button>
        <button
          className="primary"
          onClick={onGenerate}
          disabled={
            loading || !apiUrl || !apiKey || apiKey === TEMPLATE_API_KEY
          }
        >
          {loading ? loadingStatus || "Generating..." : "Generate Suggestions"}
        </button>
      </div>
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
  policy?: {
    id: string | null;
    name: string;
    content: string;
    action: string;
    enabled: boolean;
    extra_metadata?: any;
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
    React.useState<CompletedPolicy | null>(null);

  // Policy synthesis state
  const [showPolicySynthesisModal, setShowPolicySynthesisModal] =
    React.useState(false);

  // tracks whether we are currently synthesizing policies.
  const [loadingJobs, setLoadingJobs] = React.useState(false);
  // tracks the active policy jobs
  const [policyJobs, setPolicyJobs] = React.useState<PolicyJob[]>([]);
  const [completedPolicies, setCompletedPolicies] = React.useState<
    CompletedPolicy[]
  >([]);

  // flag to track if we've loaded the stored policies
  const [storedPoliciesLoaded, setStoredPoliciesLoaded] = React.useState(false);

  // Refs to avoid dependency issues
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const hasActiveJobsRef = React.useRef(false);
  const datasetIdRef = React.useRef<string | null>(null);

  const dataset = props.dataset;
  const datasetLoader = props.datasetLoader;

  // Update the dataset ID ref when it changes
  React.useEffect(() => {
    if (dataset?.id) {
      datasetIdRef.current = dataset.id;
    }
  }, [dataset?.id]);

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
  );

  // Track previous job statuses to detect state changes
  const prevJobStatusesRef = React.useRef<Record<string, string>>({});

  // Define fetchActiveJobs first before it's used
  const fetchActiveJobs = React.useCallback(async () => {
    if (!datasetIdRef.current) return;

    try {
      setLoadingJobs(true);
      const jobsResponse = await fetch(
        `/api/v1/dataset/byid/${datasetIdRef.current}/jobs`
      );
      if (jobsResponse.ok) {
        const data = await jobsResponse.json();
        // Filter for policy synthesis jobs
        const synthJobs = data.filter(
          (job: any) => job.extra_metadata.type === "policy_synthesis"
        ) as PolicyJob[];

        setPolicyJobs(synthJobs);

        // Check if there are any active jobs
        const activeJobs = synthJobs.some((job) =>
          [JOB_STATUS.PENDING, JOB_STATUS.RUNNING].includes(
            job.extra_metadata.status
          )
        );

        // If no active jobs found and we thought we had some, stop polling
        if (!activeJobs && hasActiveJobsRef.current) {
          console.log("No active jobs found, stopping polling");
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          // Fetch stored policies one final time
          await fetchStoredPolicies();
        }

        // Update the active jobs ref
        hasActiveJobsRef.current = activeJobs;

        // Only fetch policy details for newly completed jobs
        const newCompletedJobs: CompletedPolicy[] = [];
        for (const job of synthJobs) {
          if (
            job.extra_metadata.status === JOB_STATUS.COMPLETED &&
            !completedPolicies.some(
              (p) => p.job_id === job.extra_metadata.job_id
            )
          ) {
            try {
              const jobResponse = await fetch(
                `${
                  job.extra_metadata.endpoint.endsWith("/")
                    ? job.extra_metadata.endpoint.slice(0, -1)
                    : job.extra_metadata.endpoint
                }/api/v1/analysis/job/${job.extra_metadata.job_id}`,
                {
                  headers: {
                    Authorization: `Bearer ${job.secret_metadata?.apikey || ""}`,
                    "Content-Type": "application/json",
                  },
                }
              );

              if (jobResponse.ok) {
                const jobData = await jobResponse.json();
                if (jobData.status === JOB_STATUS.COMPLETED) {
                  newCompletedJobs.push({
                    ...jobData,
                    job_id: job.extra_metadata.job_id,
                    cluster_name: job.extra_metadata.cluster_name,
                  });
                }
              }
            } catch (error) {
              console.error("Error fetching job details:", error);
            }
          }
        }

        if (newCompletedJobs.length > 0) {
          // Using a Map to ensure we have only unique policies by job_id
          const uniquePoliciesMap = new Map();

          // First add existing policies from state
          completedPolicies.forEach((policy) => {
            uniquePoliciesMap.set(policy.job_id, policy);
          });

          // Then add new policies, overwriting any duplicates
          newCompletedJobs.forEach((policy) => {
            uniquePoliciesMap.set(policy.job_id, policy);
          });

          // Convert back to array
          const uniquePolicies = Array.from(uniquePoliciesMap.values());

          setCompletedPolicies(uniquePolicies);
        }
      }
    } catch (error) {
      console.error("Error fetching policy jobs:", error);
    } finally {
      // Only set loading to false if we have completed policies or no active jobs
      if (completedPolicies.length > 0 || !hasActiveJobsRef.current) {
        setLoadingJobs(false);
      }
    }
  }, [completedPolicies]);

  // Define fetchStoredPolicies next
  const fetchStoredPolicies = React.useCallback(async () => {
    if (!datasetIdRef.current || storedPoliciesLoaded) return;

    try {
      // Use query parameters to filter policies on the server side
      const minDetectionRate = 0.7; // Filter out policies with detection rate below 70%
      const successOnly = true; // Only include successful policies

      const storedPoliciesResponse = await fetch(
        `/api/v1/dataset/byid/${datasetIdRef.current}/generated-policies?min_detection_rate=${minDetectionRate}&success_only=${successOnly}`
      );

      if (!storedPoliciesResponse.ok) {
        console.error(
          "Failed to fetch stored policies:",
          storedPoliciesResponse.status
        );
        return;
      }

      const storedPoliciesData = await storedPoliciesResponse.json();
      const storedPolicies = storedPoliciesData.policies || [];

      // If we have no stored policies and no completed policies in state, just return
      if (storedPolicies.length === 0 && completedPolicies.length === 0) {
        // Only set loading to false if there are no active jobs
        if (!hasActiveJobsRef.current) {
          setLoadingJobs(false);
        }
        return;
      }

      // Convert stored policies to the CompletedPolicy format
      const storedCompletedPolicies = storedPolicies.map((policy) => ({
        status: JOB_STATUS.COMPLETED,
        policy_code: policy.policy_code,
        success: policy.success,
        detection_rate: policy.detection_rate,
        job_id: policy.id, // Using the policy ID as job_id
        cluster_name: policy.cluster_name,
        from_metadata: true, // Flag to indicate this came from metadata
        already_applied: suggestionJobIds.has(policy.id), // Check if this policy was already applied
      }));

      // Using a Map to ensure we have only unique policies by job_id
      const uniquePoliciesMap = new Map();

      // First add existing policies from state
      completedPolicies.forEach((policy) => {
        uniquePoliciesMap.set(policy.job_id, policy);
      });

      // Then add new policies, overwriting any duplicates
      storedCompletedPolicies.forEach((policy) => {
        uniquePoliciesMap.set(policy.job_id, policy);
      });

      // Convert back to array
      const uniquePolicies = Array.from(uniquePoliciesMap.values());

      // sort, so that already applied policies are in the end
      uniquePolicies.sort((a, b) => {
        if (a.already_applied && !b.already_applied) return 1;
        if (!a.already_applied && b.already_applied) return -1;
        return 0;
      });

      // Only update state if the policies have changed
      const currentIds = completedPolicies
        .map((p) => p.job_id)
        .sort()
        .join(",");
      const newIds = uniquePolicies
        .map((p) => p.job_id)
        .sort()
        .join(",");

      if (
        currentIds !== newIds ||
        completedPolicies.length !== uniquePolicies.length
      ) {
        setCompletedPolicies(uniquePolicies);

        // If we have any completed policies, ensure loading state is false
        if (uniquePolicies.length > 0) {
          setLoadingJobs(false);
        }
      } else {
        // Even if no changes, stop loading if we have policies
        if (uniquePolicies.length > 0) {
          setLoadingJobs(false);
        }
      }

      // Mark that we've loaded the stored policies
      setStoredPoliciesLoaded(true);
    } catch (error) {
      console.error("Error fetching stored policies:", error);
      // Set loading to false on error
      setLoadingJobs(false);
    }
  }, [completedPolicies, storedPoliciesLoaded]);

  // Define setupPolling last
  const setupPolling = React.useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Only set up polling if we have active jobs
    if (hasActiveJobsRef.current) {
      // Set loading to true if we have active jobs but no completed policies
      if (completedPolicies.length === 0) {
        setLoadingJobs(true);
      }

      console.log("Setting up polling for active jobs");
      intervalRef.current = setInterval(() => {
        // Fetch active jobs and check for completed policies if any jobs are running
        fetchActiveJobs();
        // Note: We removed the then() promise chain here since fetchActiveJobs now handles
        // stopping the interval and fetching stored policies when jobs complete
      }, POLL_INTERVAL);
    } else {
      console.log("No active jobs, not setting up polling");
      // No active jobs, ensure loading is false if we have completed policies
      if (completedPolicies.length > 0) {
        setLoadingJobs(false);
      }
    }
  }, [fetchActiveJobs, completedPolicies]);

  // Effect to fetch jobs and set up polling when dataset changes - optimize to avoid unnecessary polls
  React.useEffect(() => {
    if (!dataset?.id) return;

    // Initial fetch of both active jobs and stored policies
    const fetchInitialData = async () => {
      try {
        // First check if there are active jobs
        await fetchActiveJobs();

        // Then fetch stored policies only if we haven't already
        if (!storedPoliciesLoaded) {
          await fetchStoredPolicies();
        }

        // Only set up polling if we have active jobs
        if (hasActiveJobsRef.current) {
          setupPolling();
        } else {
          // console.log(
          //   "No active jobs found during initial load, not setting up polling"
          // );
        }
      } catch (error) {
        console.error("Error during initial data fetch:", error);
      }
    };

    fetchInitialData();

    // Cleanup interval on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [
    dataset?.id,
    fetchActiveJobs,
    fetchStoredPolicies,
    setupPolling,
    storedPoliciesLoaded,
  ]);

  // Update handlePolicySynthesisSuccess to include better polling management
  const handlePolicySynthesisSuccess = (data) => {
    console.log("Policy synthesis job started successfully:", data);

    // Clear existing completed policies and active jobs from state
    setCompletedPolicies([]);
    setPolicyJobs([]);

    // Reset stored policies loaded state
    setStoredPoliciesLoaded(false);

    // Set loading state to true since we're starting a new job and have no completed policies
    setLoadingJobs(true);

    // Reset previous job statuses
    prevJobStatusesRef.current = {};

    // Set hasActiveJobsRef to true to ensure polling starts
    hasActiveJobsRef.current = true;

    // Immediately fetch active jobs and start polling
    fetchActiveJobs().then(setupPolling);
  };

  // track whether 'Cancel' was clicked
  const [cancelClicked, setCancelClicked] = React.useState(false);

  // Cancel a policy job
  const cancelPolicyJob = async (jobId: string) => {
    try {
      const response = await fetch(
        `/api/v1/dataset/byid/${dataset.id}/policy-synthesis`,
        {
          method: "DELETE",
        }
      );

      if (response.ok) {
        fetchActiveJobs();
      }
    } catch (error) {
      console.error("Error cancelling policy job:", error);
    }
  };

  const cancelAllJobs = async () => {
    setCancelClicked(true);
    for (const job of policyJobs) {
      if (job.extra_metadata.status === JOB_STATUS.PENDING) {
        await cancelPolicyJob(job.extra_metadata.job_id);
      }
    }
  };

  // when all jobs are gone, setCancelClicked to false
  React.useEffect(() => {
    if (cancelClicked && policyJobs.length === 0) {
      setCancelClicked(false);
    }
  }, [policyJobs, cancelClicked]);

  // track whether synthesis is in progress
  const inProgress =
    policyJobs.filter((job) =>
      [JOB_STATUS.PENDING, JOB_STATUS.RUNNING].includes(
        job.extra_metadata.status
      )
    ).length > 0;

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
      {selectedPolicySuggestion && (
        <EditorModal
          title="Create Guardrail from Suggestion"
          onClose={() => setSelectedPolicySuggestion(null)}
          hasWindowControls
        >
          <MutatePolicyModalContent
            dataset={props.dataset}
            datasetLoadingError={props.datasetLoadingError}
            dataset_id={dataset.id}
            policy={suggestion_to_policy(selectedPolicySuggestion)}
            action="create"
            onClose={() => setSelectedPolicySuggestion(null)}
            onSuccess={() => datasetLoader.refresh()}
          ></MutatePolicyModalContent>
        </EditorModal>
      )}
      {/* policy synthesis modal */}
      {showPolicySynthesisModal && (
        <Modal
          title="Generate Suggestions"
          onClose={() => setShowPolicySynthesisModal(false)}
          hasWindowControls
        >
          <PolicySynthesisModalContent
            dataset_id={dataset.id}
            onClose={() => setShowPolicySynthesisModal(false)}
            onSuccess={handlePolicySynthesisSuccess}
          />
        </Modal>
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
        {GUARDRAIL_SUGGESTIONS_ENABLED && (
          <>
            <h3>
              <span>
                <BsStars /> Guardrail Suggestions
              </span>
              <div className="actions">
                <button
                  aria-label="generate guardrails"
                  className="button inline create-guardrail"
                  onClick={() => setShowPolicySynthesisModal(true)}
                  disabled={inProgress}
                >
                  <BsStars /> Generate Suggestions
                </button>
              </div>
            </h3>

            <div className="guardrail-list">
              {/* Show no suggestions yet state */}
              {!loadingJobs &&
                policyJobs.length === 0 &&
                completedPolicies.length === 0 && (
                  <div className="empty instructions box semi">
                    <h2>
                      <BsShieldExclamation /> No Guardrail Suggestions Yet
                    </h2>
                    <h3>
                      Generate guardrail suggestions based on the clusters
                      identified in analysis.
                    </h3>
                  </div>
                )}

              {/* box like on empty when inProgress, but showing progress */}
              {inProgress && (
                <div className="empty instructions box semi">
                  <h2 className="pulse-text">
                    <BsGearWideConnected className="spin" /> Generating
                    Suggestions...
                  </h2>
                  <h3>
                    Invariant is analyzing your clusters and generating
                    guardrail suggestions to safeguard your agentic system.
                  </h3>
                  {/* cancel button */}
                  <button
                    aria-label="cancel"
                    className="policy-action inline secondary cancel"
                    disabled={cancelClicked}
                    onClick={() => cancelAllJobs()}
                  >
                    {cancelClicked ? (
                      <>Cancelling...</>
                    ) : (
                      <>
                        <BsX /> Cancel
                      </>
                    )}{" "}
                  </button>
                </div>
              )}

              {/* Show completed policies (if any) */}
              {completedPolicies.length > 0 && (
                <>
                  {completedPolicies.map((policy: CompletedPolicy) => (
                    <div
                      key={policy.job_id}
                      className={
                        "box full setting guardrail-item suggestion-item" +
                        (policy.already_applied || false ? " applied" : "")
                      }
                    >
                      <div className={"job-info"}>
                        <h1>
                          <BsShieldCheck />
                          <span>{policy.cluster_name}</span>
                        </h1>
                      </div>
                      {policy.already_applied && (
                        <span className="badge ">Already Applied</span>
                      )}
                      <div className="guardrail-actions">
                        <button
                          aria-label="view"
                          className="policy-action inline"
                          onClick={() => setSelectedPolicySuggestion(policy)}
                        >
                          <BsCheck2 /> View & Apply
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
