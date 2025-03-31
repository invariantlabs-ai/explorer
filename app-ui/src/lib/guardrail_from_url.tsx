import React, { useEffect } from "react";
import { GuardrailSuggestion } from "../pages/traces/GuardrailSuggestions";

export function useGuardrailSuggestionFromURL(): [
  GuardrailSuggestion | null,
  () => void,
] {
  /**
   * This hook checks the URL hash for a guardrail rule and returns it.
   *
   * Also exposes a clear callback, to clear the URL hash.
   */
  const [selectedPolicySuggestion, setSelectedPolicySuggestion] =
    React.useState<GuardrailSuggestion | null>(null);

  // state to track guardrail rule in url hash
  const [proposedGuardrailRule, setProposedGuardrailRule] = React.useState({
    policy_code:
      new URLSearchParams(window.location.hash.substring(1)).get(
        "policy-code"
      ) || "",
    name:
      new URLSearchParams(window.location.hash.substring(1)).get("name") || "",
  });

  const generatedGuardrailURL = (name: string, rule: string) => {
    const url = new URL(window.location.href);
    url.hash = `#policy-code=${encodeURIComponent(rule)}&name=${encodeURIComponent(
      name
    )}`;
    return url.href;
  };
  window["generatedGuardrailURL"] = generatedGuardrailURL;

  // when a proposed guardrail could be parsed from the URL hash, set is as selected guardrail suggestion (convert it appropriately)
  useEffect(() => {
    if (!proposedGuardrailRule.name) return;
    setSelectedPolicySuggestion({
      policy_code: proposedGuardrailRule.policy_code,
      created_on: new Date().toISOString(),
      success: true,
      detection_rate: null,
      id: "url-proposed-guardrail",
      cluster_name: proposedGuardrailRule.name,
      extra_metadata: { from_url: true },
    });
  }, [proposedGuardrailRule]);

  const clearGuardrailURL = () => {
    // clear url hash if set
    window.history.replaceState(null, "", window.location.pathname);
    // clear proposed guardrail rule
    setProposedGuardrailRule({
      policy_code: "",
      name: "",
    });
    setSelectedPolicySuggestion(null);
  };

  return [selectedPolicySuggestion, clearGuardrailURL];
}
