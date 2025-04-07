// Split into logical components, but kept in one file
import {
  BsChatFill,
  BsChevronRight,
  BsExclamationCircleFill,
  BsGear,
  BsInfoCircleFill,
  BsSend,
  BsSpeedometer2,
  BsXCircleFill,
} from "react-icons/bs";
import "./Chat.scss";
import { PROMPT_LIBRARY } from "./Prompts";
import { useEffect, useRef, useState } from "react";
import { GuardrailsIcon } from "../../components/Icons";
import { DatasetRefreshBroadcastChannel } from "./Traces";
import { BroadcastEvent } from "../../lib/traceview/traceview";
import { config } from "../../utils/Config";
import {
  AutoAPIKeyInput,
  useAutoAPIKey,
  useHostedExplorerAPIKey,
  useLocalAPIKey,
  useLocalOpenAIAPIKey,
} from "../../components/AutoAPIKey";
import { ToggleButton } from "../../components/ToggleButton";

// trigger this to open the chat pane
export const TriggerChatOpenBroadcastEvent = new BroadcastEvent();

export function isLocalInstance() {
  return config("instance_name") != "local";
}

function Text({
  data,
  role,
  done,
}: {
  data: string;
  role: string;
  done?: boolean;
}) {
  const DEFAULT_DELAY = 5;
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    if (!data.startsWith(displayedText)) setDisplayedText(data);
    const step = setTimeout(
      () => {
        if (displayedText.length < data.length) {
          setDisplayedText(data.slice(0, displayedText.length + 1));
        }
      },
      done ? 1 : DEFAULT_DELAY
    );
    return () => clearTimeout(step);
  }, [data, displayedText]);

  return <>{role !== "assistant" ? data : displayedText}</>;
}
// useSettingsModal.tsx
export function useChatSettingsModal() {
  /**
   * Modal to configure the different required API keys.
   *
   * Depending on local, production, preview, this shows different
   * API keys prompts, including one for OpenAI.
   */
  const {
    required: localInvariantAPIKeyRequired,
    apiKey: localInvariantAPIKey,
    APIKeyInput: AutoAPIKeyInput,
  } = useAutoAPIKey();

  const { apiKey: openAIAPIKey, APIKeyInput: LocalOpenAIAPIKeyInput } =
    useLocalOpenAIAPIKey();

  const {
    required: hostedApiKeyRequired,
    apiKey: hostedInvariantAPIKey,
    APIKeyInput: HostedExplorerAPIKey,
  } = useHostedExplorerAPIKey();

  const [record, _setRecord] = useState(
    localStorage.getItem("chat-record") === "true"
  );

  const setRecord = (record: boolean) => {
    _setRecord(record);
    localStorage.setItem("chat-record", record.toString());
  };

  const SettingsModal = ({ onClose }: { onClose: () => void }) => (
    <div className="chat-modal">
      <div className="modal-content view-options">
        <h1>Chat Configuration</h1>
        <div className="options">
          {localInvariantAPIKeyRequired && (
            <>
              <h2>Invariant Key</h2>
              <p>Configure an Invariant API key used to push traces.</p>
              <AutoAPIKeyInput />
            </>
          )}
          <h2>OpenAI API Key</h2>
          <p>
            To use chat, provide an OpenAI API key. This key will be stored in
            your browser's local storage only.
          </p>
          <LocalOpenAIAPIKeyInput />
          {hostedApiKeyRequired && (
            <>
              <h2>Guardrails API Key</h2>
              <p>
                To enable Guardrail evaluation, please obtain a Guardrails API
                key from the hosted{" "}
                <a href="https://explorer.invariantlabs.ai">
                  Invariant Explorer
                </a>{" "}
                instance.
              </p>
              <HostedExplorerAPIKey />
            </>
          )}
          <h2>Trace Interactions</h2>
          {/* <ToggleButton toggled={record} setToggled={setRecord} className="red">
          Record interactions with this simulated agent as traces in this dataset.
          </ToggleButton> */}
          <div className="banner-note info">
            <BsInfoCircleFill />
            All interactions will be logged in this dataset.
          </div>
        </div>
        <br />
        <button
          className="inline primary"
          disabled={
            !localInvariantAPIKey ||
            (localInvariantAPIKeyRequired && !openAIAPIKey) ||
            (hostedApiKeyRequired && !hostedInvariantAPIKey)
          }
          onClick={onClose}
        >
          Save
        </button>
      </div>
    </div>
  );

  return {
    SettingsModal,
    localInvariantAPIKey,
    openAIAPIKey,
    hostedInvariantAPIKey,
    record,
    setRecord,
  };
}

function Toolbar({
  onReset,
  loading,
  historyLength,
  openSettings,
  record,
  setRecord,
}: any) {
  return (
    <header className="toolbar">
      <h3>Simulated Agent</h3>
      <div className="secondary">Interact with your agent and guardrails.</div>
      <div className="spacer" />
      <button
        className="inline icon"
        onClick={onReset}
        disabled={loading || !historyLength}
      >
        <BsXCircleFill />
      </button>
      <button className="inline icon" onClick={openSettings}>
        <BsGear />
      </button>
    </header>
  );
}

function Composer({
  userInput,
  setUserInput,
  onKeyDown,
  onSend,
  textareaRef,
}: any) {
  return (
    <div className="composer">
      <div className="templates">
        {PROMPT_LIBRARY.map((prompt) => (
          <div
            key={prompt.title}
            className="template"
            onClick={(event) => {
              if (event.shiftKey) {
                onSend(prompt.value, []);
              } else {
                onSend(prompt.value);
              }
            }}
          >
            {prompt.title}
          </div>
        ))}
      </div>
      <textarea
        placeholder="Ask a question..."
        value={userInput}
        onChange={(e) => setUserInput(e.target.value)}
        onKeyDown={onKeyDown}
        ref={textareaRef}
      />
      <div className="composer-actions">
        <button
          className="inline icon"
          onClick={() => {
            onSend(userInput);
            setUserInput("");
          }}
        >
          <BsSend />
        </button>
      </div>
    </div>
  );
}

function Message({ msg, index, loading, historyLength, loadingDotRef }: any) {
  if (!isMessageVisible(msg, loading)) return null;
  return (
    <div
      className={`bubble-container ${msg.role === "user" ? "right" : "left"}`}
    >
      <div className={`message ${msg.role}`}>
        <Text
          role={msg.role}
          data={msg.content}
          done={
            msg.role !== "assistant" || !loading || index !== historyLength - 1
          }
        />
        {index === historyLength - 1 && loading && (
          <div className="chat-loading" ref={loadingDotRef} />
        )}
        {(index !== historyLength - 1 || !loading) &&
          msg.role === "assistant" && (
            <div className="message-actions">
              {/* <button className="icon">
                <BsGear />
              </button> */}
              <div className="spacer" />
              <span className="stat">
                <BsSpeedometer2 />
                {msg.time}ms
              </span>
            </div>
          )}
      </div>
    </div>
  );
}

function isMessageVisible(message: any, loading: boolean) {
  return !(message.role === "assistant" && !loading && !message.content);
}

function GuardrailMessage({ error }: { error: any }) {
  const err = error.details.errors[0];
  const id = err.guardrail.id;
  const name = err.guardrail.name;
  const content = err.guardrail.content;
  const message = err.args.map((arg: any) => arg.toString()).join(" ");

  return (
    <>
      <div className="event guardrail nofocus flow-in">
        <div className="content">
          <div className="guardrail-header expanded">
            <GuardrailsIcon />
            <b>Guardrail Failure</b> {message}
            <span className="guardrail-id">{name}</span>
          </div>
          <pre className="marked-line">
            <div># id: {id}</div>
            <div># action: {err.guardrail.action}</div>
            <br />
            {content.split("\n").map((line, i) => (
              <div
                key={i}
                className={line.includes(message) ? "highlight" : undefined}
              >
                {line}
              </div>
            ))}
          </pre>
        </div>
      </div>
      <div className="stat">
        <BsSpeedometer2 />
        {error.time}ms
      </div>
    </>
  );
}

export function Chat(props: { dataset: string }) {
  const [show, _setShow] = useState(
    localStorage.getItem("chat-open") === "true"
  );
  const setShow = (show: boolean) => {
    _setShow(show);
    localStorage.setItem("chat-open", show.toString());
  };

  // connect with TriggerChatOpenBroadcastEvent
  useEffect(() => {
    const handleOpenChat = () => {
      setShow(!show);
    };

    TriggerChatOpenBroadcastEvent.on(handleOpenChat);

    return () => {
      TriggerChatOpenBroadcastEvent.off(handleOpenChat);
    };
  }, [show]);

  const [userInput, setUserInput] = useState("");

  const {
    localInvariantAPIKey,
    hostedInvariantAPIKey,
    openAIAPIKey,
    SettingsModal,
    record,
    setRecord,
  } = useChatSettingsModal();

  const [settingsVisible, setSettingsVisible] = useState(!openAIAPIKey);

  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardrailingError, setGuardrailingError] = useState<string | null>(
    null
  );
  const chatWindowRef = useRef<HTMLDivElement>(null);
  const loadingDotRef = useRef<HTMLDivElement>(null);
  const lastUserMessageRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!settingsVisible && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [settingsVisible, textareaRef]);

  const onSendMessage = async (msg: string, hist: any[] = history) => {
    try {
      setHistory([
        ...hist,
        { role: "user", content: msg },
        { role: "assistant", content: "" },
      ]);
      setLoading(true);
      setError(null);
      setGuardrailingError(null);
      const start = Date.now();
      const updatedHistory = [...hist, { role: "user", content: msg }];
      const controller = new AbortController();

      setTimeout(() => {
        if (chatWindowRef.current) {
          // find the anchor right after the last user message and scroll to it
          // the anchor is offset by -70pt to make sure the last line of the user
          // message is still visible. Otherwise, we mostly focus on the assistant response.
          let anchors = chatWindowRef.current.querySelectorAll(
            ".post-message-anchor.user"
          );
          if (anchors.length > 0) {
            let lastAnchor = anchors[anchors.length - 1];
            lastAnchor.scrollIntoView({
              behavior: "smooth",
              block: "start",
              inline: "nearest",
            });
          }
        }
      }, 0);

      const res = await fetch(
        `/api/v1/gateway/${props.dataset}/openai/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openAIAPIKey}`,
            "Invariant-Authorization": `Bearer ${isLocalInstance() ? "dev-mode" : localInvariantAPIKey}}`,
            "Invariant-Guardrails-Authorization": `Bearer ${hostedInvariantAPIKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4",
            messages: updatedHistory,
            stream: true,
          }),
          signal: controller.signal,
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        setError("Failed to fetch response: " + errorText);
        setHistory(updatedHistory);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder("utf-8");
      let assistantMessage = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk
          .split("\n")
          .filter((line) => line.trim().startsWith("data:"));

        for (const line of lines) {
          const json = line.replace(/^data: /, "");
          if (json === "[DONE]") break;
          try {
            const parsed = JSON.parse(json);
            if (parsed.error) {
              const duration = Date.now() - start;
              const msg = parsed.error.message;
              if (msg.includes("[Invariant]")) {
                setGuardrailingError({ ...parsed.error, time: duration });
              } else {
                setError(JSON.stringify(parsed.error));
              }
              setLoading(false);
              controller.abort();
              return;
            }
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantMessage += delta;
              setHistory((prev) => {
                const newHist = [...prev];
                newHist[newHist.length - 1] = {
                  role: "assistant",
                  content: assistantMessage,
                  time: Date.now() - start,
                };
                return newHist;
              });
            }
          } catch (err) {
            console.error("Could not parse stream chunk", err);
          }
        }
      }
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      else setError("An unknown error occurred");
    } finally {
      setTimeout(() => {
        DatasetRefreshBroadcastChannel.fire({
          type: "refresh",
          dataset: props.dataset,
        });
      }, 500);
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSendMessage(userInput);
      setUserInput("");
    }
  };

  const onReset = () => {
    setHistory([]);
    setError(null);
    setGuardrailingError(null);
    setUserInput("");
    setLoading(false);
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTo({
        top: chatWindowRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  const [width, _setWidth] = useState(
    parseInt(localStorage.getItem("chat-width") || "0") || 600
  );

  const setWidth = (w: number) => {
    _setWidth(w);
    localStorage.setItem("chat-width", w.toString());
  };

  const MAX_WIDTH = window.innerWidth * 0.5;
  const MIN_WIDTH = 400;

  if (!show) {
    return (
      <button className="chat-button tab" onClick={() => setShow(true)}>
        <div className="inner">
          <BsChatFill />
          Simulated Agent
        </div>
      </button>
    );
  }

  return (
    <>
      <button className="chat-button tab active" onClick={() => setShow(false)}>
        <div className="inner">
          <BsChatFill />
          Simulated Agent
        </div>
      </button>
      <div
        className="chat panel"
        style={{ maxWidth: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width)) }}
      >
        <LeftSideResizeGrabber
          width={width}
          setWidth={setWidth}
          minWidth={MIN_WIDTH}
          maxWidth={MAX_WIDTH}
        />
        {settingsVisible && (
          <SettingsModal onClose={() => setSettingsVisible(false)} />
        )}
        <Toolbar
          onReset={onReset}
          loading={loading}
          historyLength={history.length}
          openSettings={() => setSettingsVisible(true)}
        />
        <div className="chat-messages" ref={chatWindowRef}>
          <div className="contents">
            {history.length === 0 && !error && (
              <div className="empty">How can I help you today?</div>
            )}
            {history.map((msg, index) => (
              <>
                <Message
                  key={index}
                  msg={msg}
                  index={index}
                  loading={loading}
                  loadingDotRef={loadingDotRef}
                  historyLength={history.length}
                />
                <div
                  className={"post-message-anchor " + msg.role}
                  style={{ position: "relative", top: "-70pt" }}
                />
              </>
            ))}
            {error && (
              <div className="error">
                <BsExclamationCircleFill /> {error}
              </div>
            )}
            {guardrailingError && (
              <GuardrailMessage error={guardrailingError} />
            )}
            {history.length > 0 && <div className="message spacer" />}
            <Composer
              userInput={userInput}
              setUserInput={setUserInput}
              onKeyDown={onKeyDown}
              onSend={onSendMessage}
              textareaRef={textareaRef}
            />
          </div>
        </div>
      </div>
    </>
  );
}

export function LeftSideResizeGrabber({
  width,
  setWidth,
  minWidth = 300,
  maxWidth = 800,
}: any) {
  // left-side-resize-grabber

  const [isResizing, setIsResizing] = useState(false);
  const [startX, setStartX] = useState(0);

  const [startWidth, setStartWidth] = useState(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    // disable user select everywhere
    e.preventDefault();
    e.stopPropagation();

    setIsResizing(true);
    setStartX(e.clientX);
    setStartWidth(width);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing) return;
    const newWidth = startWidth - (e.clientX - startX);
    if (newWidth < minWidth) {
      setWidth(minWidth);
      return;
    }
    if (newWidth > maxWidth) {
      setWidth(maxWidth);
      return;
    }
    setWidth(newWidth);
  };

  const handleMouseUp = () => {
    setIsResizing(false);
    document.body.style.userSelect = "auto";
  };

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    } else {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  return (
    <div
      className={"left-side-resize-grabber " + (isResizing ? "active" : "")}
      onMouseDown={handleMouseDown}
    >
      <div className="grabber" />
    </div>
  );
}
