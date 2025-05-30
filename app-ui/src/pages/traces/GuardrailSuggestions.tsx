import React from "react";
import {
  BsCheck2,
  BsDatabaseFillLock,
  BsGearWideConnected,
  BsInfoCircle,
  BsInfoCircleFill,
  BsList,
  BsShieldCheck,
  BsShieldExclamation,
  BsStars,
  BsTools,
  BsX,
} from "react-icons/bs";
import { Modal } from "../../components/Modal";
import { JOB_STATUS } from "./Analyzer";
import "./Guardrails.scss";
import { AnalysisConfigEditor, getAnalysisConfig } from "../../lib/AnalysisAPIAccess";

// Enable the suggestions section for policy synthesis
const GUARDRAIL_SUGGESTIONS_ENABLED = true;

// Poll interval in milliseconds
const POLL_INTERVAL = 5000;

// Type definitions for policy jobs and suggestions
export interface PolicyJob {
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

export interface GuardrailSuggestion {
  cluster_name: string;
  created_on: string;
  detection_rate: number | null;
  id: string;
  policy_code: string;
  policy_name?: string;
  success: boolean;
  extra_metadata: any;
}

function ensureString(value: any): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Content to show in the modal for configuring policy synthesis.
 */
function PolicySynthesisModalContent(props) {
  // Get the API URL and key from the analyzer config
  const [loading, setLoading] = React.useState(false);
  const [loadingStatus, setLoadingStatus] = React.useState("");
  const [error, setError] = React.useState("");

  const [synthesisMode, setSynthesisMode] = React.useState("tools"); // 'analysis' or 'tools'

  const onGenerateFromAnalysis = async () => {
    setLoading(true);
    setError("");

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

      // obtain api url and key from the analyzer config
      const config = getAnalysisConfig();

      // Then, prepare the request payload for new policy synthesis
      setLoadingStatus("Starting policy generation...");
      const payload = {
        apiurl: config.endpoint,
        apikey: config.apikey
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
        const job_info = await response.json();
        setLoading(false);
        setLoadingStatus("");
        props.onSuccess(job_info);
        props.onClose();
      } else if (response.status === 401) {
        setLoading(false);
        setLoadingStatus("");
        setError("Unauthorized: Please ensure that you have access to the Analysis API.");
      } else {
        const data = await response.json();
        setLoading(false);
        setLoadingStatus("");
        setError(ensureString(data.detail) || "An error occurred while generating policies");
      }
    } catch (error) {
      setLoading(false);
      setLoadingStatus("");
      setError("An error occurred: " + (error as Error).message);
    }
  };

  const onGenerateFromTools = async () => {
    setLoading(true);
    setError("");

    try {
      await props.generateToolGuardrails();
      setLoading(false);
      props.onSuccess({});
      props.onClose();
    } catch (error) {
      setLoading(false);
      setError((error as Error).message);
    }
  };

  return (
    <div className="form policy-synthesis-form">
      <p>
        Invariant can generate guardrail suggestions based on Analysis and the
        tools of of your agent, to help you safeguard your agent.
      </p>

      <p className="policy-type-selection">
        <h3>Suggestion Type</h3>
        <label>
          <input
            type="radio"
            name="policy-synthesis-type"
            value="tools"
            onChange={(e) => {
              setSynthesisMode(e.target.value);
            }}
            defaultChecked={synthesisMode === "tools"}
          />
          <h3>Based on Tool Definitions</h3>
          <span className="subtext">
            Generate guardrails based on the tools of your agent.
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="policy-synthesis-type"
            value="analysis"
            onChange={(e) => {
              setSynthesisMode(e.target.value);
            }}
            defaultChecked={synthesisMode === "analysis"}
          />
          <h3>Based on Analysis Results</h3>
          <span className="subtext">
            Generate guardrails based on the error clusters identified by
            Analysis.
          </span>
        </label>
      </p>

      <AnalysisConfigEditor collapsed={true}/>
      
      <p/>

      {loading && loadingStatus && (
        <div className="banner-note info">
          <BsInfoCircleFill /> {loadingStatus}
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <div className="form-actions">
        <button onClick={props.onClose}>Cancel</button>
        <button
          className="primary"
          onClick={
            synthesisMode === "analysis"
              ? onGenerateFromAnalysis
              : onGenerateFromTools
          }
          disabled={loading}
        >
          {loading ? loadingStatus || "Generating..." : "Generate Suggestions"}
        </button>
      </div>
    </div>
  );
}

export function usePolicyLibrary() {
  const [libraryPolicies, setLibraryPolicies] = React.useState<
    GuardrailSuggestion[]
  >([]);

  // refreshes the list of standard suggested guardrails (@dataset.get("/byid/{id}/suggested-policies"))
  const refreshStandardPolicies = async () => {
    try {
      const libraryPoliciesResponse = await fetch(
        `/api/v1/dataset/library-policies`
      );

      if (!libraryPoliciesResponse.ok) {
        console.error(
          "Failed to fetch standard policies:",
          libraryPoliciesResponse.status
        );
        return;
      }

      const libraryPoliciesData = await libraryPoliciesResponse.json();
      setLibraryPolicies(libraryPoliciesData || []);
    } catch (error) {
      console.error("Error fetching standard policies:", error);
    }
  };

  // on mount, refresh
  React.useEffect(() => {
    refreshStandardPolicies();
  }, []);

  return libraryPolicies;
}

export function useToolTemplatePolicies(datasetId) {
  const [templatePolicies, setTemplatePolicies] = React.useState<
    GuardrailSuggestion[]
  >([]);
  const [isLoading, setIsLoading] = React.useState(false);

  const refreshTemplatePolicies = async () => {
    if (!datasetId) return;

    try {
      setIsLoading(true);

      // Fetch stored template-based policies from the new endpoint
      const response = await fetch(
        `/api/v1/dataset/byid/${datasetId}/templates-based-policies`
      );

      if (!response.ok) {
        console.error("Failed to fetch template policies:", response.status);
        setIsLoading(false);
        return;
      }

      const policies = await response.json();

      // Convert to GuardrailSuggestion format
      const formattedPolicies = policies.map((policy) => ({
        id: `template_${policy.template_name}_${Date.now()}`,
        policy_name: policy.template_name,
        policy_code: policy.filled_policy,
        cluster_name: policy.template_name,
        created_on: new Date().toISOString(),
        detection_rate: null,
        success: true,
        extra_metadata: {
          from_tool_template: true,
        },
      }));

      setTemplatePolicies(formattedPolicies);
      setIsLoading(false);
    } catch (error) {
      console.error("Error fetching template policies:", error);
      setIsLoading(false);
    }
  };

  // Function to generate new template policies
  const generateToolGuardrails = async () => {
    if (!datasetId) return;

    try {
      setIsLoading(true);

      // Get the API URL and key from the analyzer config
      const config = getAnalysisConfig();
      const endpoint = config.endpoint;
      const apikey = config.apikey;
        

      // Prepare the request payload
      const payload = {
        apiurl: endpoint,
        apikey: apikey,
      };

      // Make the API request to generate new policies
      const response = await fetch(
        `/api/v1/dataset/byid/${datasetId}/generate-policies-from-templates`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        // Extract the error details from the response
        const errorData = await response.json().catch(() => ({}));
        let errorMessage;
        
        if (response.status === 401) {
          errorMessage = "Unauthorized: Please ensure that you have access to the Analysis API.";
        } else {
          errorMessage = errorData.detail || "Failed to generate policies from templates";
        }
        
        console.error(errorMessage);

        setIsLoading(false);
        throw new Error(errorMessage);
      }

      // After generating, refresh to get the latest policies
      await refreshTemplatePolicies();
    } catch (error) {
      console.error("Error generating policies from tool templates:", error);
      setIsLoading(false);
      
      // Re-throw the error so it can be caught by the calling function
      throw error;
    }
  };

  React.useEffect(() => {
    refreshTemplatePolicies();
  }, [datasetId]);

  return {
    templatePolicies,
    refreshTemplatePolicies,
    generateToolGuardrails,
    isLoading,
  };
}

export function GuardrailSuggestions({
  dataset,
  setSelectedPolicySuggestion,
  suggestionJobIds,
}: {
  dataset: any;
  setSelectedPolicySuggestion: React.Dispatch<
    React.SetStateAction<GuardrailSuggestion | null>
  >;
  suggestionJobIds: Set<string>;
}) {
  // tracks synthesis jobs that have not completed yet
  const [policyJobs, setPolicyJobs] = React.useState<PolicyJob[]>([]);
  // tracks completed synthesis jobs, i.e. guardrail suggetsions
  const [storedPolicies, setStoredPolicies] = React.useState<
    GuardrailSuggestion[]
  >([]);

  // policy synthesis state
  const [showPolicySynthesisModal, setShowPolicySynthesisModal] =
    React.useState(false);
  // tool template policy generation state
  const [showToolTemplateModal, setShowToolTemplateModal] =
    React.useState(false);

  // library policies
  const libraryPolicies = usePolicyLibrary();
  const {
    templatePolicies,
    refreshTemplatePolicies,
    generateToolGuardrails,
    isLoading: isLoadingTemplates,
  } = useToolTemplatePolicies(dataset.id);

  // show all suggestions (even low-quality ones)
  const [showAll, setShowAll] = React.useState(false);
  const minDetectionRate = showAll ? 0.0 : 0.7; // Filter out policies with detection rate below 70%

  // refreshes the list of stored suggested guardrails
  const refreshStoredPolicies = async () => {
    try {
      // Use query parameters to filter policies on the server side
      const successOnly = !showAll; // Only include successful policies

      const storedPoliciesResponse = await fetch(
        `/api/v1/dataset/byid/${dataset.id}/generated-policies?min_detection_rate=${minDetectionRate}&success_only=${successOnly}`
      );

      if (!storedPoliciesResponse.ok) {
        console.error(
          "Failed to fetch stored policies:",
          storedPoliciesResponse.status
        );
        return;
      }

      const storedPoliciesData = await storedPoliciesResponse.json();
      setStoredPolicies(storedPoliciesData.policies || []);
    } catch (error) {
      console.error("Error fetching stored policies:", error);
    }
  };

  // whenever showAll changes, refresh stored policies
  React.useEffect(() => {
    refreshStoredPolicies();
  }, [showAll]);

  // refreshes the list of active guardrail suggestion jobs
  const refreshActiveJobs = async () => {
    try {
      const jobsResponse = await fetch(
        `/api/v1/dataset/byid/${dataset.id}/jobs`
      );
      if (jobsResponse.ok) {
        const data = await jobsResponse.json();
        // Filter for policy synthesis jobs
        let synthJobs = data.filter(
          (job: any) => job.extra_metadata.type === "policy_synthesis"
        ) as PolicyJob[];

        // filter down to jobs that are not already done
        synthJobs = synthJobs.filter((job) =>
          [JOB_STATUS.PENDING, JOB_STATUS.RUNNING].includes(
            job.extra_metadata.status
          )
        );

        setPolicyJobs(synthJobs);
      }
    } catch (error) {
      console.error("Error fetching active jobs:", error);
    }
  };

  // on mount, refresh
  React.useEffect(() => {
    // fetch active jobs and stored policies
    refreshStoredPolicies();
    refreshActiveJobs();
  }, [dataset]);

  // when there are pending policy jobs, regularly refresh stored and active jobs
  React.useEffect(() => {
    if (policyJobs.length > 0) {
      const refresher = () => {
        refreshStoredPolicies();
        refreshActiveJobs();
      };

      // set and clear interval
      const interval = setInterval(refresher, POLL_INTERVAL);
      return () => clearInterval(interval);
    }
  }, [policyJobs]);

  // Update handlePolicySynthesisSuccess to include better polling management
  const onPolicySynthesisStart = (job_info) => {
    // clear existing stored policies and active jobs
    setStoredPolicies([]);
    setPolicyJobs([]);
    // Immediately fetch active jobs and start polling
    refreshStoredPolicies();
    refreshActiveJobs();
  };

  // track whether 'Cancel' was clicked
  const [cancelClicked, setCancelClicked] = React.useState(false);

  const cancelAllJobs = async () => {
    setCancelClicked(true);
    try {
      const response = await fetch(
        `/api/v1/dataset/byid/${dataset.id}/policy-synthesis`,
        {
          method: "DELETE",
        }
      );

      if (response.ok) {
        refreshActiveJobs();
      }
    } catch (error) {
      console.error("Error cancelling policy job:", error);
    }
  };

  // when all jobs are gone, setCancelClicked to false
  React.useEffect(() => {
    if (cancelClicked && policyJobs.length === 0) {
      setCancelClicked(false);
    }
  }, [policyJobs, cancelClicked]);

  // // track whether synthesis is in progress
  const inProgress = policyJobs.length > 0;

  const onToolTemplateSuccess = () => {
    // Refresh template policies after generation
    refreshTemplatePolicies();
  };

  return (
    GUARDRAIL_SUGGESTIONS_ENABLED && (
      <>
        {/* policy synthesis modal */}
        {showPolicySynthesisModal && (
          <Modal
            title="Guardrail Suggestions"
            onClose={() => setShowPolicySynthesisModal(false)}
            hasWindowControls
          >
            <PolicySynthesisModalContent
              dataset_id={dataset.id}
              onClose={() => setShowPolicySynthesisModal(false)}
              onSuccess={(job_info) => onPolicySynthesisStart(job_info)}
              generateToolGuardrails={generateToolGuardrails}
            />
          </Modal>
        )}

        <h3>
          <span>
            <BsStars /> Guardrail Suggestions
            <span className="show-all-checkbox">
            <input type="checkbox" id="show-templates" checked={showAll} onChange={() => setShowAll(!showAll)} />
            <label htmlFor="show-templates">
              Show All
            </label>
            </span>

          </span>
          <div className="actions">
            <button
              aria-label="generate guardrails"
              className="button inline create-guardrail"
              onClick={() => setShowPolicySynthesisModal(true)}
              disabled={policyJobs.length > 0}
            >
              <BsStars /> Generate Suggestions
            </button>
          </div>
        </h3>
        <div className="guardrail-list">
          {/* Show no suggestions yet state */}
          {policyJobs.length === 0 &&
            storedPolicies.length === 0 &&
            libraryPolicies.length === 0 &&
            templatePolicies.length === 0 && (
              <div className="empty instructions box semi">
                <h2>
                  <BsShieldExclamation /> No Guardrail Suggestions Yet
                </h2>
                <h3>
                  Generate guardrail suggestions based on clusters or tool
                  templates.
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
                Invariant is analyzing your clusters and generating guardrail
                suggestions to safeguard your agent.
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
          {(storedPolicies.length > 0 ||
            libraryPolicies.length > 0 ||
            templatePolicies.length > 0) && (
            <>
              {[...storedPolicies, ...templatePolicies, ...libraryPolicies].map(
                (policy: GuardrailSuggestion, i: number) => {
                  const already_applied = suggestionJobIds.has(policy.id);
                  return (
                    <div
                      key={i + "_" + policy.id}
                      className={
                        "box full setting guardrail-item suggestion-item" +
                        (already_applied || false ? " applied" : "")
                      }
                    >
                      <div className={"job-info"}>
                        <h1>
                          <BsShieldCheck />
                          <span>
                            {policy.policy_name || policy.cluster_name}
                          </span>
                          {!policy.extra_metadata?.from_rule_library &&
                            !policy.extra_metadata?.from_tool_template && (
                              <span className="badge blue">
                                <BsStars /> Generated
                              </span>
                            )}
                          {policy.extra_metadata?.from_rule_library && (
                            <span className="badge">
                              <BsDatabaseFillLock /> Rule Library
                            </span>
                          )}
                          {policy.extra_metadata?.from_tool_template && (
                            <span className="badge purple">
                              <BsTools /> Tool Template
                            </span>
                          )}
                        </h1>
                      </div>
                      {already_applied && (
                        <span className="badge ">Already Applied</span>
                      )}
                      <div className="guardrail-actions">
                        <button
                          aria-label="view"
                          className="policy-action inline"
                          onClick={() => setSelectedPolicySuggestion(policy)}
                        >
                          <BsList /> Details
                        </button>
                      </div>
                    </div>
                  );
                }
              )}
            </>
          )}
        </div>
      </>
    )
  );
}
