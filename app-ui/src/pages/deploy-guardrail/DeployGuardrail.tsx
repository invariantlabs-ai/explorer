import { useEffect } from "react";
import React from "react";
import { useDatasetList } from "../../service/DatasetOperations";
import { useUserInfo } from "../../utils/UserInfo";

export function DeployGuardrail() {
  const userInfo = useUserInfo();

  const [privateDatasets, refreshPrivateDatasets] = useDatasetList(
    "private",
    8
  );

  useEffect(() => {
    if (userInfo?.loggedIn) {
      refreshPrivateDatasets();
    }
  }, [userInfo?.loggedIn, refreshPrivateDatasets]);

  // get most recent dataset
  const mostRecentDataset = privateDatasets?.[0];
  // get most recent dataset name
  const mostRecentDatasetName = mostRecentDataset?.name;

  // get dataset name that was last picked (via localStorage)
  const lastPickedDatasetName = localStorage.getItem("last-picked-dataset");

  const datasetName =
    mostRecentDatasetName ||
    lastPickedDatasetName ||
    privateDatasets?.[0]?.name ||
    "";

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
    return `#policy-code=${encodeURIComponent(rule)}&name=${encodeURIComponent(name)}`;
  };
  window["generatedGuardrailURL"] = generatedGuardrailURL;

  // if dataset name is set, redirect to /u/<user>/<datasetName>?tab=guardrail#policy-code=<rule>&name=<name>
  useEffect(() => {
    if (datasetName) {
      const url = generatedGuardrailURL(
        proposedGuardrailRule.name,
        proposedGuardrailRule.policy_code
      );
      window.location.href = `/u/${userInfo?.username}/${datasetName}?tab=guardrails#${window.location.hash.substring(1)}`;
    }
  }, [datasetName, proposedGuardrailRule, userInfo?.username]);

  return <>{datasetName}</>;
}
