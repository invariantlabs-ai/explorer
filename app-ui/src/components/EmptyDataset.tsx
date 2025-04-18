import React, { useEffect, useRef } from "react";
import { FileUploadMask } from "../pages/home/NewDataset";
import { uploadDataset } from "../service/DatasetOperations";
import { useTelemetry } from "../utils/Telemetry";
import {
  BsChat,
  BsChatFill,
  BsClipboard2,
  BsClipboard2Check,
  BsCollection,
} from "react-icons/bs";
import "../styles/EmptyDataset.scss";
import { createSharedHighlighter } from "../lib/traceview/plugins/code-highlighter";
import { SETUP_SNIPPETS } from "./SetupSnippets";
import { TriggerChatOpenBroadcastEvent } from "../pages/traces/Chat";
import { generateNewProjectName } from "../pages/home/ProjectNames";

function ChatStart() {
  return (
    <div className="simulated-agent options">
      <div>
        <b>Capture Traces with a Simulated Agent</b>
        <div>
          You can start experiment by chatting to a <i>simulated agent</i> that
          logs to this dataset.
        </div>
      </div>
      <button
        className="primary"
        onClick={() => TriggerChatOpenBroadcastEvent.fire({ open: true })}
        aria-label="start-simulated-agent"
      >
        <BsChatFill /> Simulated Agent
      </button>
    </div>
  );
}

function TypedInput({
  initialValue,
  onChange,
}: {
  initialValue: string;
  onChange: (val: string) => void;
}) {
  const [value, setValue] = React.useState("");
  const hasTyped = useRef(false);

  useEffect(() => {
    if (hasTyped.current) return;
    if (value.length < initialValue.length) {
      const timeout = setTimeout(() => {
        setValue((v) => v + initialValue[value.length]);
        if (value.length === initialValue.length - 1) {
          hasTyped.current = true;
        }
      }, 20);
      return () => clearTimeout(timeout);
    } else {
      hasTyped.current = true;
    }
  }, [value, initialValue]);

  return (
    <input
      type="text"
      value={hasTyped.current ? value : value}
      onChange={(e) => {
        setValue(e.target.value);
        onChange(e.target.value);
        hasTyped.current = true;
      }}
    />
  );
}

function JSONLUpload({
  file,
  loading,
  error,
  setFile,
  onSubmit,
}: {
  file: File | null;
  setFile: (file: File | null) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string;
}) {
  return (
    <div className="jsonl-upload">
      <h2>Upload a JSON Lines file</h2>
      <p>
        Before uploading traces make sure they are in the{" "}
        <a
          target="_blank"
          href="https://explorer.invariantlabs.ai/docs/explorer/api/trace-format/"
        >
          correct format
        </a>
        .
      </p>
      <FileUploadMask file={file} />
      <input
        aria-label="file-input"
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />
      <button
        aria-label="upload"
        className="primary"
        disabled={loading || !file}
        onClick={onSubmit}
      >
        {loading ? "Uploading..." : "Upload"}
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

async function highlightPythonCode(content: string) {
  const highlighter = await createSharedHighlighter();
  const tokens = await highlighter.codeToTokensWithThemes(content, {
    lang: "python",
    themes: ["github-light"],
  });
  return tokens;
}

export function CodeWithCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = React.useState(false);
  const [tokens, setTokens] = React.useState<any[]>([]);

  useEffect(() => {
    highlightPythonCode(code).then((tokens) => {
      setTokens(tokens);
    });
  }, [code]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-with-copy">
      {/* {code} */}
      <RenderedTokens tokens={tokens} />
      <button
        onClick={handleCopy}
        className={"inline icon copy " + (copied ? "copied" : "")}
      >
        {copied ? <BsClipboard2Check /> : <BsClipboard2 />}
      </button>
    </div>
  );
}

export function RenderedTokens(props: { tokens: any[] }) {
  return (
    <div className="rendered-tokens">
      {/* first line, then tokens */}
      {props.tokens.map((line, i) => (
        <div key={i} className="line">
          {line.length === 0 && <span>&nbsp;</span>}
          {line.map((token: any, j: number) => {
            const { content, variants } = token;
            const variant = variants[0];
            return (
              <span
                key={j}
                className={variant.fontStyle === 1 ? "bold" : ""}
                style={{
                  color: variant.color,
                  fontWeight: variant.fontStyle === 1 ? "bold" : "normal",
                }}
              >
                {content}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * A component to show when there are no traces in the dataset.
 *
 * It contains information on how to populate the dataset with traces.
 */
export function EmptyDatasetInstructions(props: {
  onSuccess: () => void;
  datasetname: string;
}) {
  const telemetry = useTelemetry();
  const datasetname = props.datasetname;

  return (
    <>
      <div className="empty instructions box left wide">
        <h2>
          <BsCollection />
          No Traces Captured Yet
        </h2>
        <h3>
          Connect or simulate an agent to capture traces. To obtain an API key,
          go <a href="/settings">here</a>.
        </h3>
        <ChatStart />
        <div className="or-separator">
          <span className="line" />
          or
          <span className="line" />
        </div>
        <UploadOptions dataset={datasetname} onSuccess={props.onSuccess} />
      </div>
    </>
  );
}
/**
 * A component to show the upload options for a dataset (different frameworks and the JSONL upload).
 */
export function UploadOptions({
  dataset: givenDatasetName,
  onSuccess,
  excluded,
  className,
  onChangeName,
}: {
  // the name of the dataset
  dataset?: string;
  // function to call on success (e.g. when file upload is complete)
  onSuccess: () => void;
  // list of excluded options
  excluded?: string[];
  // optional class name
  className?: string;
  // optional create button
  onChangeName?: (name: string) => void;
}) {
  const telemetry = useTelemetry();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);

  const [customDatasetName, setCustomDatasetName] = React.useState<string>(
    generateNewProjectName()
  );

  // update name on change
  useEffect(() => {
    onChangeName?.(customDatasetName);
  }, [customDatasetName]);

  const dataset = givenDatasetName || customDatasetName;

  const onSubmit = () => {
    if (!file) {
      return;
    }
    setLoading(true);
    uploadDataset(dataset, file)
      .then(() => {
        setLoading(false);
        telemetry.capture("dataset-uploaded", {
          name: dataset,
          from_file: true,
        });
        onSuccess();
      })
      .catch((err) => {
        console.log(err);
        setLoading(false);
        setError(err.detail || "An unknown error occurred, please try again.");
        telemetry.capture("dataset-upload-failed", {
          name: dataset,
          error: err.detail,
        });
      });
  };

  const SNIPPETS = SETUP_SNIPPETS.filter((s) => {
    // filter out the excluded options
    if (excluded) {
      return !excluded?.includes(s.name);
    }
    return true;
  });

  const [activeTab, setActiveTab] = React.useState(SNIPPETS[0].name);

  // active option
  const activeOption = SNIPPETS.find((o) => o.name === activeTab);

  // get the control
  let snippet: any = activeOption?.snippet;
  // if snippet is a function, call it with datasetname (it is a template based on the dataset name)
  if (typeof snippet === "function") {
    // instance url is location.protocol + "//" + location.host
    const instance = `${location.protocol}//${location.host}`;
    snippet = snippet(dataset, instance);
  }

  const link = activeOption?.link ? (
    <a href={activeOption?.link}> Learn More.</a>
  ) : null;

  return (
    <div className={"options " + (className || "")}>
      {!givenDatasetName && (
        <div className="upload-banner-input">
          <label>Project Name</label>
          <TypedInput
            initialValue={customDatasetName}
            onChange={(val) => setCustomDatasetName(val)}
          />
        </div>
      )}
      <div className="options-tabs">
        {SNIPPETS.map((option) => (
          <div
            key={option.name}
            className={`tab ${activeTab === option.name ? "active" : ""}`}
            onClick={() => setActiveTab(option.name)}
          >
            {option.name}
          </div>
        ))}
      </div>
      <div className="options-content">
        <div className="description">
          {SETUP_SNIPPETS.find((o) => o.name === activeTab)?.description}
          {link}
        </div>
        {snippet == "<jsonl-upload>" ? (
          <JSONLUpload
            file={file}
            loading={loading}
            error={error}
            setFile={setFile}
            onSubmit={onSubmit}
          />
        ) : (
          <CodeWithCopyButton code={snippet} />
        )}
      </div>
    </div>
  );
}
