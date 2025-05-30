import React from "react";
import Editor from "@monaco-editor/react";
import { BsTools } from "react-icons/bs";
import "./AnalysisAPIAccess.scss";
import { InvariantIcon } from "../components/Icons";
import { config } from "../utils/Config";

export const DEFAULT_ENDPOINT = "https://preview-explorer.invariantlabs.ai/";

function onMountConfigEditor(editor, monaco) {
  let apikey = config("analysis_requires_api_keys") ? "\n  \"apikey\": \"<api key>\"," : "";
  // register completion item provider
  monaco.languages.registerCompletionItemProvider("json", {
    provideCompletionItems: function (model, position) {
      return {
        suggestions: [
          {
            label: "local",
            kind: monaco.languages.CompletionItemKind.Text,
            insertText: `{
  "endpoint": "http://host.docker.internal:8010",
  "apikey": "<api key>",
  "model_params": {
    "model": "i01",
    "options":{}
  }
}`,
          },
          {
            label: "preview",
            kind: monaco.languages.CompletionItemKind.Text,
            insertText: `{
  "endpoint": "${DEFAULT_ENDPOINT}",${
apikey}
  "model_params": {
    "model": "i01",
    "options":{}
  }
}`,
          },
        ],
      };
    },
  });
}

export function AnalysisConfigEditor(props: { collapsed?: boolean }) {
  const [analysisConfig, setAnalysisConfig] = useAnalysisConfig();
  const [analysisConfigString, setAnalysisConfigStringState] = React.useState(
    JSON.stringify(analysisConfig, null, 2)
  );
  const [collapsed, setCollapsed] = React.useState(props.collapsed || false);
  const [advancedMode, _setAdvancedMode] = React.useState(
    localStorage.getItem("invariantlabs-analysis-config-advanced-mode") ===
      "true"
  );

  const setAdvancedMode = (mode: boolean) => {
    localStorage.setItem(
      "invariantlabs-analysis-config-advanced-mode",
      mode ? "true" : "false"
    );
    _setAdvancedMode(mode);
  };

  const setAnalysisConfigString = (configString: string) => {
    try {
      const config = JSON.parse(configString);
      setAnalysisConfig(config);
    } catch (e) {
      console.error("Invalid JSON in Analysis API config editor", e);
    }
  };

  return (
    <div
      className={"analysis-config-editor" + (advancedMode ? " expanded" : "")}
    >
      <header>
        <InvariantIcon />
        <h4>
          {collapsed ? (
            <>This feature requires advanced API access.</>
          ) : (
            <>Advanced API Access</>
          )}
        </h4>
        {!collapsed && (
          <button
            className={
              "button inline toggleable " + (advancedMode ? "toggled" : "")
            }
            onClick={() => {
              setAdvancedMode(!advancedMode);
            }}
          >
            More Settings
          </button>
        )}
        {collapsed && (
          <button
            className="button inline toggleable"
            onClick={() => {
              setCollapsed(!collapsed);
            }}
          >
            Configure
          </button>
        )}
      </header>
      {!collapsed && (
        <>
          <div className="info secondary">
            The Analysis API gives you advanced functionality to analyze your
            agent data. Note that you may need to first be unlocked for access
            to the Analysis API. If you are not, please{" "}
            <a
              href="mailto:model@invariantlabs.ai"
              target="_blank"
              rel="noreferrer"
            >
              contact us
            </a>
            .
          </div>
          {advancedMode ? (
            <Editor
              language="json"
              theme="vs-dark"
              className="analyzer-config"
              value={analysisConfigString}
              onMount={onMountConfigEditor}
              onChange={(value, model) => {
                if (value) {
                  setAnalysisConfigStringState(value);
                  setAnalysisConfigString(value);
                }
              }}
              height="200pt"
              options={{
                minimap: {
                  enabled: false,
                },
                lineNumbers: "off",
                wordWrap: "on",
              }}
            />
          ) : (
            <div>
              {/* <div className="form-group">
                    <label>Endpoint</label>
                    <input 
                        type="text" 
                        autoComplete="off" 
                        value={analysisConfig.endpoint || DEFAULT_ENDPOINT}
                        onChange={(e) => {
                            const newConfig = { ...analysisConfig, endpoint: e.target.value };
                            setAnalysisConfig(newConfig);
                            setAnalysisConfigStringState(JSON.stringify(newConfig, null, 2));
                        }}
                    />
                </div> */}
              {(config("analysis_requires_api_keys") || false) && (
                <div className="form-group">
                  <label>API Key</label>
                  <input
                    placeholder="only required for private instances"
                    type="password"
                    autoComplete="off"
                    value={analysisConfig.apikey || ""}
                    onChange={(e) => {
                      let newConfig = {
                        ...analysisConfig,
                        ...{ apikey: e.target.value },
                      };
                      // if not specified or empty, remove the apikey
                      if (
                        !e.target.value &&
                        typeof newConfig.apikey !== "undefined"
                      ) {
                        delete (newConfig as any).apikey;
                      }
                      setAnalysisConfig(newConfig);
                      setAnalysisConfigStringState(
                        JSON.stringify(newConfig, null, 2)
                      );
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const ANALYSIS_CONFIG_STORAGE_KEY = "invariantlabs-analysis-config";
const DEFAULT_ANALYSIS_CONFIG: AnalysisAPIConfig = {
  endpoint: DEFAULT_ENDPOINT,
  model_params: {
    model: "i01",
    options: {},
  },
};

interface AnalysisAPIConfig {
  endpoint: string;
  apikey?: string;

  [key: string]: any; // allow additional properties
}

const ANALYSIS_CONFIG_CHANGED_LISTENERS: Array<
  (config: AnalysisAPIConfig) => void
> = [];

function notifyAnalysisConfigChanged() {
  ANALYSIS_CONFIG_CHANGED_LISTENERS.forEach((listener) => {
    listener(
      JSON.parse(
        localStorage.getItem(ANALYSIS_CONFIG_STORAGE_KEY) || JSON.stringify({})
      ) as AnalysisAPIConfig
    );
  });
}

function setAnalysisConfig(config: AnalysisAPIConfig) {
  localStorage.setItem(ANALYSIS_CONFIG_STORAGE_KEY, JSON.stringify(config));
  notifyAnalysisConfigChanged();
}

export function getAnalysisConfig(): AnalysisAPIConfig {
  const stored = JSON.parse(
    localStorage.getItem(ANALYSIS_CONFIG_STORAGE_KEY) || JSON.stringify({})
  ) as AnalysisAPIConfig;

  return { ...DEFAULT_ANALYSIS_CONFIG, ...stored };
}

// global window. wide access to the Analysis API config
export function useAnalysisConfig(): [
  AnalysisAPIConfig,
  (config: AnalysisAPIConfig) => void,
] {
  const [analysisConfig, setAnalysisConfigState] =
    React.useState(getAnalysisConfig());

  // install listener, and keep sync
  React.useEffect(() => {
    const listener = (config: AnalysisAPIConfig) => {
      setAnalysisConfigState(config);
    };
    ANALYSIS_CONFIG_CHANGED_LISTENERS.push(listener);
    return () => {
      const index = ANALYSIS_CONFIG_CHANGED_LISTENERS.indexOf(listener);
      if (index > -1) {
        ANALYSIS_CONFIG_CHANGED_LISTENERS.splice(index, 1);
      }
    };
  }, []);

  return [
    analysisConfig,
    (config: AnalysisAPIConfig) => {
      setAnalysisConfig(config);
    },
  ];
}
