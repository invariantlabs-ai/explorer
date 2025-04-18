import { useUserInfo } from "../utils/UserInfo";
import { config } from "../utils/Config";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Modal } from "../components/Modal";
import { useHostedExplorerAPIKey } from "../components/AutoAPIKey";

const key = "invariant.explorer.production.apikey";

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

  // A self-contained ApiKeyModal component
  const ApiKeyModal = () => {
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
  };

  return { check, ApiKeyModal };
}

export default useGuardrailsChecker;
