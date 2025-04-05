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

type TextProps = {
  data: string;
  role: string;
  done?: boolean;
};

export function Text({ data, role, done }: TextProps) {
  const DEFAULT_DELAY = 5; // milliseconds

  if (role != "assistant") {
    return data;
  }

  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    if (!data.startsWith(displayedText)) {
      setDisplayedText(data);
    }

    const updater = () => {
      if (displayedText.length < data.length) {
        setDisplayedText(data.slice(0, displayedText.length + 1));
      }
    };

    const step = setTimeout(updater, done ? 1 : DEFAULT_DELAY);

    return () => {
      clearTimeout(step);
    };
  }, [data, displayedText]);

  return displayedText;
}

export function Chat(props: { dataset: string }) {
  const [userInput, setUserInput] = useState("");
  const [apiKey, _setApiKey] = useState(
    localStorage.getItem("explorer-chat-openai-api-key") || ""
  );
  const setApiKey = (newKey: string) => {
    _setApiKey(newKey);
    localStorage.setItem("explorer-chat-openai-api-key", newKey);
  };

  const [invariantApiKey, _setInvariantApiKey] = useState(
    localStorage.getItem("explorer-chat-invariant-api-key") || ""
  );

  const setInvariantApiKey = (newKey: string) => {
    _setInvariantApiKey(newKey);
    localStorage.setItem("explorer-chat-invariant-api-key", newKey);
  };

  const [guardrailsApiKey, _setGuardrailsApiKey] = useState(
    localStorage.getItem("explorer-chat-guardrails-api-key") || ""
  );

  const setGuardrailsApiKey = (newKey: string) => {
    _setGuardrailsApiKey(newKey);
    localStorage.setItem("explorer-chat-guardrails-api-key", newKey);
  };

  const [settingsVisible, setSettingsVisible] = useState(!apiKey);

  const [loading, setLoading] = useState(false);

  const [history, setHistory] = useState([] as any);

  const [error, setError] = useState(null as string | null);
  const [guardrailingError, setGuardrailingError] = useState(
    null as string | null
  );

  const chatWindowRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // on open, focus on the textarea
  useEffect(() => {
    if (!settingsVisible && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [settingsVisible, textareaRef]);

  const onSendMessage = async (msg: string, history: any[] = []) => {
    try {
      setHistory([
        ...history,
        { role: "user", content: msg },
        { role: "assistant", content: "" },
      ]);
      setLoading(true);
      setError(null);
      setGuardrailingError(null);

      // reset stats
      const start = Date.now();

      const updatedHistory = [...history, { role: "user", content: msg }];
      const controller = new AbortController();

      const res = await fetch(
        "/api/v1/gateway/" + props.dataset + "/openai/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Invariant-Authorization": `Bearer ${invariantApiKey}`,
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

      // scroll into view (smoothly)
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

            // check for error
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
            // setError("Could not parse stream chunk: " + err);
            console.error("Could not parse stream chunk", err);
          }
        }
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
    } finally {
      setTimeout(() => {
        DatasetRefreshBroadcastChannel.postMessage({
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
      // Handle send message
      onSendMessage(userInput, history);
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

  return (
    <div className="chat panel">
      {settingsVisible && (
        <div className="chat-modal">
          <div className="modal-content view-options">
            <h1>Chat Configuration</h1>
            <div className="options">
              <h2>OpenAI API Key</h2>
              <p>
                Before you can use the chat, you need to set your OpenAI API
                key. You API key is stored locally in your browser and is not
                sent to
              </p>
              <input
                type="password"
                placeholder="Enter your OpenAI API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
              />
              <h2>Invariant API Key</h2>
              <p>
                Set your Invariant API key to an API key coming from{" "}
                <b>this instance of Explorer</b>. You can obtain it{" "}
                <a href="/settings">here</a>.
              </p>
              <input
                type="password"
                placeholder="Enter your Invariant API key"
                value={invariantApiKey}
                onChange={(e) => setInvariantApiKey(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
              />
              <h2>Guardrails API Key</h2>
              <p>
                Set your Guardrails API key. You can obtain a Guardrails API key
                from the{" "}
                <a href="https://explorer.invariantlabs.ai" target="_blank">
                  hosted Invariant Explorer
                </a>
                .
              </p>
              <input
                type="password"
                placeholder="Enter your Guardrails API key"
                value={guardrailsApiKey}
                onChange={(e) => setGuardrailsApiKey(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
              />
            </div>
            <br />
            <button
              className="inline primary"
              disabled={!apiKey || !invariantApiKey || !guardrailsApiKey}
              onClick={() => {
                setSettingsVisible(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      <header className="toolbar">
        <BsChevronRight />
        <h3>
          <BsChatFill /> Chat
        </h3>
        <div className="spacer"></div>
        <button
          className="inline"
          onClick={() => onReset()}
          disabled={loading || !history.length}
        >
          <BsXCircleFill /> Clear
        </button>
        <button
          className="inline icon"
          onClick={() => setSettingsVisible(true)}
        >
          <BsGear />
        </button>
      </header>
      <div className="chat-messages" ref={chatWindowRef}>
        <div className="contents">
          {history.length === 0 && !error && (
            <div className="empty">How can I help you today?</div>
          )}
          {history.map((msg, index) => (
            <div
              key={index}
              className={`bubble-container ${
                msg.role === "user" ? "right" : "left"
              }`}
            >
              {isMessageVisible(msg, loading) && (
                <div className={`message ${msg.role}`}>
                  {/* {msg.content} */}
                  <Text
                    role={msg.role}
                    data={msg.content}
                    done={
                      msg.role !== "assistant" ||
                      !loading ||
                      index !== history.length - 1
                    }
                  />
                  {index == history.length - 1 && loading && (
                    <div className="chat-loading" />
                  )}
                  {(index != history.length - 1 || !loading) && (
                    <div className="message-actions">
                      {msg.role === "assistant" && (
                        <>
                          <button className="icon">
                            <BsGear />
                          </button>
                          <div className="spacer" />
                          <span className="stat">
                            <BsSpeedometer2 />
                            {msg.time}ms
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {error && (
            <div className="error">
              <BsExclamationCircleFill /> {error}
            </div>
          )}
          {guardrailingError && <GuardrailMessage error={guardrailingError} />}
          {history.length > 0 && <div className="message spacer" />}

          <div className="composer">
            <div className="templates">
              {PROMPT_LIBRARY.map((prompt) => (
                <div
                  key={prompt.title}
                  className="template"
                  onClick={(event) => {
                    if (event.shiftKey) {
                      onSendMessage(prompt.value, []);
                    } else {
                      onSendMessage(prompt.value, history);
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
                  // Handle send message
                  console.log("Sending message:", userInput);
                  setUserInput("");
                }}
              >
                <BsSend />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function isMessageVisible(message: any, loading: boolean) {
  // hide empty assistant messages if we are not loading
  if (message.role == "assistant" && !loading && !message.content) {
    return false;
  }
  return true;
}

export function GuardrailMessage({ error }: { error: any }) {
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
