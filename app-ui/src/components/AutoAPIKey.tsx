import React, { useEffect, useState } from "react";
import "./AutoAPIKey.scss";
import { config } from "../utils/Config";
import { BsCheckCircleFill, BsInfoCircleFill } from "react-icons/bs";

const LOCAL_KEY = "invariant_auto_api_key";

interface AutoAPIKeyItem {
  key: string;
  id: string;
  createdOn: number;
}

function getLocalAPIKey(name: string): AutoAPIKeyItem | null {
  const data = localStorage.getItem(LOCAL_KEY + "-" + name);
  if (data) {
    return JSON.parse(data);
  }
  return null;
}

function setLocalAPIKey(name: string, key: AutoAPIKeyItem) {
  localStorage.setItem(LOCAL_KEY + "-" + name, JSON.stringify(key));
}

const LOCAL_AUTO_API_KEY_STORAGE_KEY = "local";

export function useAutoAPIKey() {
  /**
   * Use this component (and render <AutoAPIKeyInput />) to get an API key
   * for the current instance of Explorer.
   *
   * The component automatically creates an API key and stores it in the user's
   * browser's local storage.
   *
   * It also offers buttons to create a new key or clear and expire the old one.
   *
   * Using this component ensure that there is always a valid API key for the
   * current instance of Explorer available. Note, that if a user accesses
   * Explorer from a different browser or device, they will have one API key per
   * browser/session.
   */
  const [apiKey, setApiKey] = useState(
    getLocalAPIKey(LOCAL_AUTO_API_KEY_STORAGE_KEY)?.key as string | null
  );

  if (config("instance_name") == "local") {
    return {
      required: true,
      apiKey,
      APIKeyInput: () => <AutoAPIKeyInput onChange={setApiKey} />,
    };
  }

  return {
    required: true,
    apiKey,
    APIKeyInput: () => <AutoAPIKeyInput onChange={setApiKey} />,
  };
}

export function AutoAPIKeyInput({ onChange }) {
  const [apiKey, setApiKey] = useState(null as AutoAPIKeyItem | null);
  const [loading, setLoading] = useState(false);

  const loadKey = async () => {
    const stored = getLocalAPIKey(LOCAL_AUTO_API_KEY_STORAGE_KEY);
    if (stored) {
      setApiKey(stored);
      onChange && onChange(stored.key);
    } else {
      await createKey();
    }
  };

  // clears the key
  const clearKey = async () => {
    setLoading(true);
    setApiKey(null);
    try {
      // Revoke old key if exists
      if (apiKey?.id)
        await fetch(`/api/v1/keys/${apiKey!.id}`, { method: "DELETE" });
      setLocalAPIKey("local", {
        key: "",
        id: "cleared",
        createdOn: 0,
      });
      onChange && onChange(null);
    } catch (e) {
      console.error("Failed to revoke API key");
    } finally {
      setLoading(false);
    }
  };

  const createKey = async () => {
    setLoading(true);
    setApiKey(null);
    try {
      // Revoke old key if exists
      if (apiKey?.id)
        await fetch(`/api/v1/keys/${apiKey!.id}`, { method: "DELETE" });

      const res = await fetch("/api/v1/keys/create", { method: "POST" });
      const data = await res.json();
      data.createdOn = Date.now();
      setLocalAPIKey("local", data);
      setApiKey(data);
      onChange && onChange(data.key);
    } catch (e) {
      console.error("Failed to create API key");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKey();
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setApiKey(val);
    onChange && onChange(val);
  };

  return (
    <div className="auto-api-key">
      <input
        type={apiKey?.key ? "password" : "text"}
        // show 32*
        value={
          apiKey?.key
            ? "*".repeat(64)
            : apiKey?.id == "cleared"
              ? "API key disabled. Please create a new one."
              : apiKey?.key
        }
        onChange={handleChange}
        autoComplete="off"
        disabled={loading}
      />
      {apiKey?.key && (
        <button onClick={clearKey} disabled={loading} className="inline">
          Clear
        </button>
      )}
      {!apiKey?.key && (
        <button onClick={createKey} disabled={loading} className="inline">
          Create
        </button>
      )}
      <p>
        {apiKey?.createdOn
          ? "Last updated: " + new Date(apiKey.createdOn).toLocaleString()
          : null}
        {!apiKey ? " " : null}
      </p>
    </div>
  );
}

export function LocalAPIKeyInput({
  url,
  onChange,
}: {
  url: string;
  onChange?: (key: string | null) => void;
}) {
  /**
   * Components looks like above, but actually links to another Explorer instance (via `<url>/settings`).
   */
  const [apiKey, setApiKey] = useState(null as AutoAPIKeyItem | null);
  const [loading, setLoading] = useState(false);

  const loadKey = async () => {
    const stored = getLocalAPIKey(url);
    if (stored) {
      setApiKey(stored);
      onChange && onChange(stored.key);
    }
  };

  // clears the key (in local storage)
  const clearKey = async () => {
    setLoading(true);
    setApiKey(null);
    onChange && onChange(null);
    setLocalAPIKey(url, {
      key: "",
      id: "cleared",
      createdOn: 0,
    });
    setLoading(false);
  };

  const onGetKey = async () => {
    setLoading(true);
    window.open(url, "_blank");
    setLoading(false);
  };

  useEffect(() => {
    loadKey();
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setApiKey({
      key: val,
      id: "user-set",
      createdOn: Date.now(),
    });
    setLocalAPIKey(url, {
      key: val,
      id: "user-set",
      createdOn: Date.now(),
    });
    onChange && onChange(val);
  };

  return (
    <div className="auto-api-key">
      <input
        type={apiKey?.key ? "password" : "text"}
        // show 32*
        value={apiKey?.key ? "*".repeat(64) : ""}
        onChange={handleChange}
        placeholder="No API key set."
        autoComplete="off"
      />
      {apiKey?.key && (
        <button onClick={clearKey} disabled={loading} className="inline">
          Clear
        </button>
      )}
      {!apiKey?.key && (
        <button onClick={onGetKey} disabled={loading} className="inline">
          Get Key
        </button>
      )}
      <p>
        {apiKey?.createdOn
          ? "Last updated: " + new Date(apiKey.createdOn).toLocaleString()
          : null}
        {!apiKey ? " " : null}
      </p>
    </div>
  );
}

export function useLocalAPIKey(url: string) {
  const [apiKey, setApiKey] = useState(
    getLocalAPIKey(url)?.key as string | null
  );

  return {
    apiKey,
    APIKeyInput: () => <LocalAPIKeyInput url={url} onChange={setApiKey} />,
  };
}

type ExplorerHost = "local" | "production";

export function useExplorerAPIKey(instance: ExplorerHost) {
  if (instance == "local") {
    return useAutoAPIKey();
  } else if (instance == "production") {
    return useLocalAPIKey("https://explorer.invariantlabs.ai/settings");
  } else {
    throw new Error("Invalid Explorer host");
  }
}

export function useLocalOpenAIAPIKey() {
  const url = "https://platform.openai.com/api-keys";

  const [apiKey, setApiKey] = useState(
    getLocalAPIKey(url)?.key as string | null
  );

  return {
    apiKey,
    APIKeyInput: () => <LocalAPIKeyInput url={url} onChange={setApiKey} />,
  };
}

export function useHostedExplorerAPIKey() {
  // Returns controls/keys for the hosted production explorer.
  // Same as useAutoAPIKey if this is the production explorer instance.
  const isProduction = location.hostname === "explorer.invariantlabs.ai";

  if (isProduction) {
    return {
      ...useAutoAPIKey(),
      // if we are in production, this api key input is not required next to
      // the normal auto API key input (see useAutoAPIKey).
      required: false,
    };
  }

  return {
    ...useLocalAPIKey("https://explorer.invariantlabs.ai/settings"),
    required: true,
  };
}
