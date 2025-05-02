import { useCallback, useEffect, useState } from "react";
import { useUserInfo } from "../utils/UserInfo";
import { config } from "../utils/Config";
import { useNavigate } from "react-router-dom";
import { Modal } from "../components/Modal";
import { useHostedExplorerAPIKey } from "../components/AutoAPIKey";
import { events } from "fetch-event-stream";

const key = "invariant.explorer.production.apikey";

export interface PolicyCheckResult {
  traceId: string;
  status: "success" | "error";
  triggered?: boolean;
  errors?: any[];
  error?: string;
  index: number;
  metadata?: {
    num_traces: number;
  };
}

export interface DatasetPolicyChecker {
  running: boolean;
  error: string | null;
  results: PolicyCheckResult[];
  startCheck: (policy: string) => Promise<void>;
  stopCheck: () => void;
  // whether the evaluation is running
  isEvaluating: boolean;
  // number of traces to evaluate
  numTraces: number;
  // progress of the evaluation (in number of traces evaluated)
  progress: number;
  // a modal for configuring the API key
  ApiKeyModal: React.FC<any>
}

// A self-contained ApiKeyModal component moved to top-level
export function ApiKeyModal({ isModalVisible, setIsModalVisible, handleSubmit, APIKeyInput }: {
  isModalVisible: boolean;
  setIsModalVisible: (visible: boolean) => void;
  handleSubmit: () => void;
  APIKeyInput: React.ComponentType;
}) {
  return (
    <div>
      {isModalVisible && (
        <Modal
          title="Configure Guardrails API Key"
          hasFooter={false}
          className="view-options"
          onClose={() => setIsModalVisible(false)}
        >
          <div className="options">
            <h2>Guardrails API Key</h2>
            <p>
              To enable Guardrail evaluation, please obtain a Guardrails API
              key from the hosted{" "}
              <a href="https://explorer.invariantlabs.ai">
                Invariant Explorer
              </a>{" "}
              instance.
            </p>
            <APIKeyInput />
          </div>
          <footer>
            <button className="primary inline" onClick={handleSubmit}>
              Save
            </button>
            <div className="spacer" />
          </footer>
        </Modal>
      )}
    </div>
  );
}

function useGuardrailsChecker() {
  const userInfo = useUserInfo();
  const navigate = useNavigate();
  const isLocal = config("instance_name") === "local";
  const [isModalVisible, setIsModalVisible] = useState(false);

  // const [apiKey, setApiKey] = useState('');

  const { apiKey, APIKeyInput } = useHostedExplorerAPIKey();

  const handleSubmit = () => {
    setIsModalVisible(false);
  };

  const check = async (messages: any, policy: string): Promise<Response> => {
    // we need to use API keys if we are not on the explorer.invariantlabs.ai domain, or if we are local
    const requiresApiKey =
      isLocal || window.location.hostname !== "explorer.invariantlabs.ai";

    if (requiresApiKey) {
      // if we are local, use an API key from local storage -- if it is not there, ask the user
      if (!apiKey) {
        // Display a modal to ask for the API key
        setIsModalVisible(true);
        return Promise.reject(new Error("API key required"));
      }

      return fetch("https://explorer.invariantlabs.ai/api/v1/policy/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          messages: messages,
          policy: policy,
        }),
      });
    } else if (userInfo?.signedUp) {
      // If we are on the production instance, we can use session cookies instead for authentication
      // No explicit Authorization header needed if using session cookies

      return fetch("https://explorer.invariantlabs.ai/api/v1/policy/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: messages,
          policy: policy,
        }),
        credentials: "include",
      });
    } else {
      // If not local, and not signed in, redirect to sign-in
      window.location.href = "/login";
      return Promise.reject(new Error("Authentication required"));
    }
  };

  return { check, ApiKeyModal: (props: any) => <ApiKeyModal isModalVisible={isModalVisible} setIsModalVisible={setIsModalVisible} handleSubmit={handleSubmit} APIKeyInput={APIKeyInput} {...props} /> };
}

export function useDatasetGuardrailsChecker(datasetId: string): DatasetPolicyChecker {
  /**
   * Returns a DatasetPolicyChecker object that allows you to check a whole dataset against
   * a given guardrailing rule.
   * 
   * Evaluation can be stopped at any time by calling the stopCheck function.
   * 
   * Results are streamed and returned as they come in as part of the DatasetPolicyChecker object.
   * 
   * Track progress using .numTraces and .progress.
   */
  const userInfo = useUserInfo();
  const isLocal = config("instance_name") === "local";
  const { apiKey, APIKeyInput } = useHostedExplorerAPIKey();
  
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PolicyCheckResult[]>([]);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const [numTraces, setNumTraces] = useState(0);
  const [progress, setProgress] = useState(0);

  // Modal state and handler for API key
  const [isModalVisible, setIsModalVisible] = useState(false);
  const handleSubmit = () => {
    setIsModalVisible(false);
  };

  // stops the guardrails evaluation
  const stopCheck = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setRunning(false);
  }, [abortController]);

  // starts the guardrails evaluation
  const startCheck = useCallback(async (policy: string) => {
    if (isEvaluating) {
      return;
    }

    // check if we need an API key (e.g. non-production, or local)
    const requiresApiKey = isLocal || window.location.hostname !== "explorer.invariantlabs.ai";

    if (requiresApiKey && !apiKey) {
      setError("API key required");
      setIsModalVisible(true);
      return;
    }

    if (!userInfo?.signedUp && !requiresApiKey) {
      window.location.href = "/login";
      return;
    }

    setRunning(true);
    setError(null);
    setResults([]);

    const controller = new AbortController();
    setAbortController(controller);
    setIsEvaluating(true);

    try {
      let response: Response;

      // send request (with API key or session cookies)
      if (requiresApiKey) {
        response = await fetch(`/api/v1/dataset/byid/${datasetId}/policy-check/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            policy,
            policy_check_url: "https://explorer.invariantlabs.ai/api/v1/policy/check"
          }),
          signal: controller.signal
        });
      } else {
        response = await fetch(`/api/v1/dataset/byid/${datasetId}/policy-check/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            policy,
            policy_check_url: "https://explorer.invariantlabs.ai/api/v1/policy/check"
          }),
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      if (!response.body) throw new Error("Response body is null");

      const stream = events(response, controller.signal);

      for await (const event of stream) {
        if (event.data) {
          try {
            const result: PolicyCheckResult = JSON.parse(event.data);
            
            // check for metadata result
            if (result.metadata) {
              setNumTraces(result.metadata.num_traces);
              setProgress(0);
              continue;
            }
            
            // process as trace result
            if (result.error) {
              setError(result.error);
            } else {
              setResults(prev => [...prev, result]);
            }
            setProgress(prev => prev + 1);
          } catch (e) {
            console.error("Failed to parse policy check result:", e);
          }
        }
      }

      setRunning(false);

    } catch (error: any) {
      setRunning(false);

      if (error.toString().includes("Fetch is aborted")) {
        setError("guardrails evaluation was aborted");
      } else if (error.toString().includes("was aborted")) { 
        return;
      } else {
        const errorMessage = error.message || "Unknown error occurred";
        setError(errorMessage);
      }
    } finally {
      setIsEvaluating(false);
    }
  }, [datasetId, apiKey, userInfo, isLocal, isEvaluating]);

  return {
    running,
    error,
    results,
    startCheck,
    stopCheck,
    isEvaluating,
    numTraces,
    progress,
    ApiKeyModal: (props: any) => <ApiKeyModal isModalVisible={isModalVisible} setIsModalVisible={setIsModalVisible} handleSubmit={handleSubmit} APIKeyInput={APIKeyInput} {...props} />
  };
}

export default useGuardrailsChecker;
