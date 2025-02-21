import { Link } from "react-router-dom";
import { Time } from "../../components/Time";
import "./Guardrails.scss";
import { Editor } from "@monaco-editor/react";
import { ReportFormat, useJSONParse } from "./Insights";
import { BsPlusCircle, BsStars, BsTrash, BsX } from "react-icons/bs";
import { Traces } from "./Traces";
import { useEffect, useState } from "react";

const POLICIES = [
  {
    name: "Prevent sending emails",
    description: "Highlights agents that send emails.",
    policy: `raise "sends mail" if: 
    (call: ToolCall)
    call is tool:send_email
    `,
  },
  {
    name: "Mayor of the town",
    description: "Factual agent patch regarding the mayor of Zurich",
    policy: `raise PolicyViolation("User asks about the mayor of Zurich", patch="If someone asks, the mayor of Zurich is Marc Fischer") if:
    (msg: Message)
    msg.role == "user"
    "mayor" in msg.content and "Zurich" in msg.content
    `,
  },
  {
    name: "Detect secrets",
    description: "Detects secret tokens in agent trajectories",
    policy: `from invariant.detectors import secrets

raise "found secret token in agent message" if:
    (msg: Message)
    any(secrets(msg.content))
    `,
  },
];

interface Guardrail {
  name: string;
  description: string;
  policy: string;

  enabled?: boolean;
}

export function useGuardrails(dataset: any) {
  const [guardrails, _setGuardrails] = useState([] as Guardrail[] | null);

  // get guardrails from extra_metadata.guardrails. if not present, return default guardrails
  useEffect(() => {
    const rawGuardrails = dataset?.extra_metadata?.guardrails;
    try {
      if (rawGuardrails) {
        const guardrails = JSON.parse(rawGuardrails);
        _setGuardrails(guardrails);
      } else {
        _setGuardrails(POLICIES);
      }
    } catch (e) {
      console.error("Failed to parse guardrails", e);
    }
  }, [dataset]);

  const setGuardrails = (
    update_fct: (guardrails: Guardrail[]) => Guardrail[]
  ) => {
    const new_guardrails = update_fct(guardrails || []);
    _setGuardrails(new_guardrails);

    fetch(`/api/v1/dataset/metadata/${dataset.name}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        metadata: {
          guardrails: JSON.stringify(new_guardrails),
        },
      }),
    })
      .then((r) => {
        if (!r.ok) {
          alert("Failed to save guardrails");
        }
      })
      .catch((e) => {
        alert("Failed to save guardrails");
      });
  };

  return [guardrails || [], setGuardrails] as const;
}

function selectActiveGuardrail(
  index: number,
  guardrails: Guardrail[],
  suggestions: Guardrail[]
) {
  // -1, is null
  // within range of 'guardrails', is a guardrail
  // within range of 'suggestions', is a suggestion
  if (index === -1) {
    return null;
  } else if (index < guardrails.length) {
    return guardrails[index];
  } else if (index < guardrails.length + suggestions.length) {
    return suggestions[index - guardrails.length];
  } else {
    return null;
  }
}

export function Guardrails(props: {
  dataset: any;
  datasetLoadingError: any;
  username: string;
  datasetError: any;
  datasetname: string;
  onRefreshReport?: () => void;
}) {
  const [guardrails, setGuardrails] = useGuardrails(props.dataset);

  const rawReport = props.dataset?.extra_metadata?.analysis_report;
  const report = useJSONParse(rawReport) as ReportFormat | null;

  const guardrailSuggestsions =
    (report && report["guardrail-suggestions"]) || [];

  const [sidepaneOpen, setSidepaneOpen] = useState(false);
  const [activeGuardrailIndex, setActiveGuardrailIndex] = useState(-1);
  const activeGuardrail = selectActiveGuardrail(
    activeGuardrailIndex,
    guardrails,
    guardrailSuggestsions
  );

  const [activeGuardrailIndices, setActiveGuardrailIndices] = useState(
    null as null | number[]
  );
  const [evaluating, setEvaluating] = useState(false);

  const [activeHighlightResults, setActiveHighlightResults] = useState({});

  const onTestRule = async (code) => {
    setEvaluating(true);
    setActiveGuardrailIndices(null);

    fetch(`/api/v1/dataset/byid/${props.dataset.id}/rule`, {
      method: "POST",
      body: JSON.stringify({ code }),
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((r) => {
        if (r.ok) {
          return r.json().then((r) => {
            setActiveGuardrailIndices(r.indices);

            // for each trace, list numebr of annotations
            let transformedHighlights = {};
            Object.keys(r.annotations).forEach((key) => {
              // for each annotation, list the address, content
              // transform them
              let annotations_object = {};
              let traceAnnotations = r.annotations[key];
              traceAnnotations.map((annotation) => {
                annotations_object[annotation.address] = {
                  content: annotation.content,
                  source: "guardrail",
                };
              });
              transformedHighlights[key] = annotations_object;
            });

            setActiveHighlightResults(transformedHighlights);
          });
        } else {
          alert("Rule test failed");
        }
      })
      .finally(() => {
        setEvaluating(false);
      });
  };

  // enable/disable current rule
  const onEnable = async (index: number, enable: boolean) => {
    // if rule is already enabled, disable it
    setGuardrails((guardrails) => {
      const newGuardrails = [...guardrails];
      if (newGuardrails[index]) {
        newGuardrails[index].enabled = enable;
      }
      return newGuardrails;
    });
  };

  // when active guardrail changes, clear indices
  useEffect(() => {
    setActiveGuardrailIndices(null);
  }, [activeGuardrail]);

  return (
    <>
      <div className="panel">
        <header className="toolbar">
          <h1>
            <Link to="/"> /</Link>
            <Link to={`/u/${props.username}`}>{props.username}</Link>/
            {props.datasetname}
            <span> </span>
          </h1>
        </header>
        <div className="guardrails">
          <h3>
            Active
            <span className="spacer" />
            <button
              className="primary inline"
              onClick={() => {
                setGuardrails((guardrails) => {
                  const newGuardrails = [...guardrails];
                  newGuardrails.push({
                    name: "New Guardrail",
                    description: "",
                    policy: `raise "found user message" if: 
    (msg: Message)
    msg.role == "user"`,
                  });
                  return newGuardrails;
                });
                setTimeout(() => {
                  setActiveGuardrailIndex(guardrails.length);
                  setSidepaneOpen(true);
                }, 0);
              }}
            >
              New Guardrail
            </button>
          </h3>
          <div className="list">
            {guardrails.map((policy, pidx) => (
              <div className="box" key={pidx}>
                <h2>
                  {policy.name}
                  <div className="spacer" />
                  {!policy.enabled && <span className="badge">Disabled</span>}
                  {policy.enabled && <span className="live badge">Live</span>}
                </h2>
                <i>{policy.description || "No description"}</i>
                <Editor
                  height="200px"
                  language="python"
                  className="policy"
                  value={policy.policy}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    // no scrollbars
                    scrollbar: { vertical: "hidden", horizontal: "hidden" },
                    // no overscroll
                    scrollBeyondLastLine: false,
                    // no right ruler
                    rulers: [],
                    // no line numbers
                    lineNumbers: "off",
                    // wrap lines
                    wordWrap: "on",
                  }}
                />
                <div className="actions">
                  <button
                    className="inline"
                    onClick={() => {
                      setSidepaneOpen(true);
                      setActiveGuardrailIndex(pidx);
                    }}
                  >
                    Details
                  </button>
                </div>
              </div>
            ))}
          </div>
          <h3>
            <span>
              Suggestions
              <span className="secondary">Synthesized in Offline Analysis</span>
            </span>
          </h3>
          <div className="list">
            {guardrailSuggestsions.map((suggestion, sidx) => (
              <div className="box" key={sidx}>
                <h2>
                  <BsStars />
                  {suggestion.name}
                </h2>
                <i>{suggestion.description}</i>
                <Editor
                  height="200px"
                  language="python"
                  className="policy"
                  value={suggestion.policy}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    // no scrollbars
                    scrollbar: { vertical: "hidden", horizontal: "hidden" },
                    // no overscroll
                    scrollBeyondLastLine: false,
                    // no right ruler
                    rulers: [],
                    // no line numbers
                    lineNumbers: "off",
                    // wrap lines
                    wordWrap: "on",
                  }}
                />
                <div className="actions">
                  <button
                    className="inline"
                    onClick={() => {
                      setActiveGuardrailIndex(guardrails.length + sidx);
                      setSidepaneOpen(true);
                    }}
                  >
                    Details
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        {sidepaneOpen && (
          <div className="sidepane" onClick={() => setSidepaneOpen(false)}>
            <div
              className="sidepane-content"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="sidep">
                <button
                  className="close inline"
                  onClick={() => setSidepaneOpen(false)}
                >
                  <BsX />
                </button>
                <div className="guardrail-editor">
                  <div className="box">
                    <h2>
                      Guardrail:{"  "}
                      <input
                        type="text"
                        value={activeGuardrail?.name}
                        onChange={(e) => {
                          setGuardrails((guardrails) => {
                            const newGuardrails = [...guardrails];
                            newGuardrails[activeGuardrailIndex].name =
                              e.target.value;
                            return newGuardrails;
                          });
                        }}
                      />
                    </h2>
                    <i>
                      <input
                        type="text"
                        value={activeGuardrail?.description}
                        onChange={(e) => {
                          setGuardrails((guardrails) => {
                            const newGuardrails = [...guardrails];
                            newGuardrails[activeGuardrailIndex].description =
                              e.target.value;
                            return newGuardrails;
                          });
                        }}
                      />
                    </i>
                  </div>
                </div>
                {/* delete button */}
                <button
                  className="inline"
                  onClick={() => {
                    setGuardrails((guardrails) => {
                      const newGuardrails = [...guardrails];
                      newGuardrails.splice(activeGuardrailIndex, 1);
                      return newGuardrails;
                    });
                    setSidepaneOpen(false);
                  }}
                >
                  <BsTrash />
                  Delete
                </button>
                <button
                  className="inline primary test"
                  onClick={() => onTestRule(activeGuardrail?.policy)}
                  disabled={evaluating}
                >
                  <>{evaluating ? "Evaluating..." : "Test"}</>
                </button>
                <button
                  className="inline"
                  onClick={() =>
                    onEnable(activeGuardrailIndex, !activeGuardrail?.enabled)
                  }
                >
                  {activeGuardrail?.enabled ? "Disable" : "Enable"}
                </button>
              </header>
              <div className="policy-editor">
                <Editor
                  height="200px"
                  className="policy"
                  language="python"
                  value={activeGuardrail?.policy}
                  onChange={(value) => {
                    setGuardrails((guardrails) => {
                      const newGuardrails = [...guardrails];
                      if (value !== undefined) {
                        newGuardrails[activeGuardrailIndex].policy = value;
                      }
                      return newGuardrails;
                    });
                  }}
                  options={{
                    readOnly: false,
                    // font size 16
                    fontSize: 16,
                    minimap: { enabled: true },
                    // no scrollbars
                    scrollbar: { vertical: "hidden", horizontal: "hidden" },
                    // no overscroll
                    scrollBeyondLastLine: false,
                    // no right ruler
                    rulers: [],
                    // no line numbers
                    lineNumbers: "on",
                    // wrap lines
                    wordWrap: "on",
                    // padding top 10pt
                    padding: { top: 20, bottom: 10, left: 0, right: 0 },
                  }}
                />
              </div>
              <div className="traces-container">
                {activeGuardrailIndices &&
                  activeGuardrailIndices.length > 0 && (
                    <Traces
                      dataset={props.dataset}
                      hideAnnotations={true}
                      query={
                        "filter:Guardrail Matches:0" +
                        activeGuardrailIndices.join(",")
                      }
                      datasetLoadingError={props.datasetError}
                      withoutHeader={true}
                      enableAnalyzer={false}
                      highlightsProvider={(trace) => {
                        if (
                          trace &&
                          activeHighlightResults &&
                          activeHighlightResults[trace.index]
                        ) {
                          return activeHighlightResults[trace.index];
                        }
                        return null;
                      }}
                    />
                  )}
                {activeGuardrailIndices &&
                activeGuardrailIndices.length == 0 ? (
                  <div className="empty">No traces matched the guardrail</div>
                ) : (
                  <div className="empty">
                    {evaluating
                      ? "Evaluating..."
                      : "Press 'Test' to see guardrail matches."}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

