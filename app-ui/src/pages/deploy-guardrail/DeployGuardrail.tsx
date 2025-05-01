import React, { useEffect, useState } from "react";
import { useDatasetList } from "../../service/DatasetOperations";
import { useUserInfo } from "../../utils/UserInfo";
import { sharedFetch } from "../../service/SharedFetch";

export function DeployGuardrail() {
  const userInfo = useUserInfo();
  const [privateDatasets, refreshPrivateDatasets] = useDatasetList(
    "private",
    8
  );

  const [validDatasetName, setValidDatasetName] = useState("");
  const [dataset, setDataset] = useState(null);
  const [error, setError] = useState(null);

  const [proposedGuardrailRule] = useState({
    policy_code:
      new URLSearchParams(window.location.hash.substring(1)).get(
        "policy-code"
      ) || "",
    name:
      new URLSearchParams(window.location.hash.substring(1)).get("name") || "",
  });

  const [url, setUrl] = useState(null as string | null);

  useEffect(() => {
    if (userInfo?.loggedIn) refreshPrivateDatasets();
  }, [userInfo?.loggedIn, refreshPrivateDatasets]);

  useEffect(() => {
    if (!userInfo?.username || privateDatasets?.length === 0) return;

    const lastPicked = localStorage.getItem("last-picked-dataset");
    const candidates = [
      lastPicked,
      privateDatasets?.[0]?.name,
      ...(privateDatasets || []).map((d) => d.name),
    ];

    (async () => {
      for (const name of candidates) {
        if (!name) continue;
        try {
          const data = await sharedFetch(
            `/api/v1/dataset/byuser/${userInfo.username}/${name}`
          );
          setValidDatasetName(name);
          setDataset(data);
          setUrl(
            `/u/${userInfo?.username}/${name}?tab=guardrails#${window.location.hash.substring(1)}`
          );
          break;
        } catch (e: any) {
          if (!isClientError(e.status)) setError(e);
        }
      }
    })();
  }, [privateDatasets, userInfo?.username]);

  const generatedGuardrailURL = (name, rule) =>
    `#policy-code=${encodeURIComponent(rule)}&name=${encodeURIComponent(name)}`;
  window["generatedGuardrailURL"] = generatedGuardrailURL;

  useEffect(() => {
    if (url) {
      window.location.href = url;
    }
  }, [url]);

  return (
    <>
      {validDatasetName}
      {url && <a href={url}>{url}</a>}
    </>
  );
}

function isClientError(status) {
  return status >= 400 && status < 500;
}
