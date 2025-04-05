// Split into logical components, but kept in one file
import {
  BsChatFill,
  BsChevronRight,
  BsExclamationCircleFill,
  BsGear,
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

function SettingsModal({
  apiKey,
  invariantApiKey,
  guardrailsApiKey,
  setApiKey,
  setInvariantApiKey,
  setGuardrailsApiKey,
  onClose,
}: any) {
  return (
    <div className="chat-modal">
      <div className="modal-content view-options">
        <h1>Chat Configuration</h1>
        <div className="options">
          <h2>OpenAI API Key</h2>
          <p>
            Before using the chat, set your OpenAI API key. This key will be
            stored locally in this browser and will not be shared with anyone.
          </p>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
          {isLocalInstance() && (
            <>
              <h2>Invariant API Key</h2>
              <p>
                Set an Invariant API key for this instance of Explorer. You can
                obtain it <a href="/settings">in your account settings</a>.
              </p>
              <input
                type="password"
                value={invariantApiKey}
                onChange={(e) => setInvariantApiKey(e.target.value)}
                autoComplete="off"
              />
            </>
          )}
          <h2>Guardrails API Key</h2>
          <p>
            Obtain a Guardrails API key from the{" "}
            <a href="https://explorer.invariantlabs.ai">hosted Explorer</a>, to
            execute guardrails on your agent.
          </p>
          <input
            type="password"
            value={guardrailsApiKey}
            onChange={(e) => setGuardrailsApiKey(e.target.value)}
            autoComplete="off"
          />
        </div>
        <br />
        <button
          className="inline primary"
          disabled={
            !apiKey ||
            (!invariantApiKey && !isLocalInstance) ||
            !guardrailsApiKey
          }
          onClick={onClose}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function Toolbar({ onReset, loading, historyLength, openSettings }: any) {
  return (
    <header className="toolbar">
      <h3>Chat</h3>
      <div className="secondary">Interact with your agent and guardrails.</div>
      <div className="spacer" />
      <button
        className="inline"
        onClick={onReset}
        disabled={loading || !historyLength}
      >
        <BsXCircleFill /> Clear
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

function Message({ msg, index, loading, historyLength }: any) {
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
          <div className="chat-loading" />
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
  const [apiKey, _setApiKey] = useState(
    localStorage.getItem("explorer-chat-openai-api-key") || ""
  );
  const setApiKey = (key: string) => {
    _setApiKey(key);
    localStorage.setItem("explorer-chat-openai-api-key", key);
  };
  const [invariantApiKey, _setInvariantApiKey] = useState(
    localStorage.getItem("explorer-chat-invariant-api-key") || ""
  );
  const setInvariantApiKey = (key: string) => {
    _setInvariantApiKey(key);
    localStorage.setItem("explorer-chat-invariant-api-key", key);
  };
  const [guardrailsApiKey, _setGuardrailsApiKey] = useState(
    localStorage.getItem("explorer-chat-guardrails-api-key") || ""
  );
  const setGuardrailsApiKey = (key: string) => {
    _setGuardrailsApiKey(key);
    localStorage.setItem("explorer-chat-guardrails-api-key", key);
  };
  const [settingsVisible, setSettingsVisible] = useState(!apiKey);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardrailingError, setGuardrailingError] = useState<string | null>(
    null
  );
  const chatWindowRef = useRef<HTMLDivElement>(null);
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

      const res = await fetch(
        `/api/v1/gateway/${props.dataset}/openai/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Invariant-Authorization": `Bearer ${isLocalInstance() ? "dev-mode" : invariantApiKey}}`,
            "Invariant-Guardrails-Authorization": `Bearer ${guardrailsApiKey}`,
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

      if (chatWindowRef.current) {
        chatWindowRef.current.scrollTo({
          top: chatWindowRef.current.scrollHeight,
          behavior: "smooth",
        });
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
    parseInt(localStorage.getItem("chat-width") || "0") || 400
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
          Chat
        </div>
      </button>
    );
  }

  return (
    <>
      <button className="chat-button tab active" onClick={() => setShow(false)}>
        <div className="inner">
          <BsChatFill />
          Chat
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
          <SettingsModal
            apiKey={apiKey}
            invariantApiKey={invariantApiKey}
            guardrailsApiKey={guardrailsApiKey}
            setApiKey={setApiKey}
            setInvariantApiKey={setInvariantApiKey}
            setGuardrailsApiKey={setGuardrailsApiKey}
            onClose={() => setSettingsVisible(false)}
          />
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
              <Message
                key={index}
                msg={msg}
                index={index}
                loading={loading}
                historyLength={history.length}
              />
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
