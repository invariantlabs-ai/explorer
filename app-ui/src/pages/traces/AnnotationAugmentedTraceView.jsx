import React, { act, useEffect, useMemo, useRef, useState } from "react";
import { Tooltip } from "react-tooltip";

import "./Annotations.scss";
import "../../styles/Explorer.scss";

import {
  RemoteResource,
  useRemoteResource,
} from "../../service/RemoteResource";
import { useUserInfo } from "../../utils/UserInfo";
import UserIcon from "../../lib/UserIcon";

import { Time } from "../../components/Time";
import { Metadata } from "../../lib/metadata";
import { AnalysisResult } from "../../lib/analysis_result";
import { HighlightedJSON } from "../../lib/traceview/highlights";
import { BroadcastEvent, RenderedTrace } from "../../lib/traceview/traceview";
import { config } from "../../utils/Config";
import { useTelemetry } from "../../utils/Telemetry";
import { AnnotationsParser } from "../../lib/annotations_parser";
import { HighlightDetails } from "./HighlightDetails";

import { HighlightsNavigator } from "./HighlightsNavigator";

import { AnalyzerPreview, AnalyzerSidebar, useAnalyzer } from "./Analyzer";
import { copyPermalinkToClipboard } from "../../lib/permalink-navigator";

import { openInPlayground } from "../playground/playground";

import "./Analyzer.scss";

import {
  BsArrowDown,
  BsArrowsCollapse,
  BsArrowsExpand,
  BsArrowUp,
  BsCaretLeftFill,
  BsCheck,
  BsCommand,
  BsDownload,
  BsLayoutSidebarInsetReverse,
  BsPencilFill,
  BsShare,
  BsTerminal,
  BsTrash,
} from "react-icons/bs";
import { useNavigate } from "react-router-dom";

export const THUMBS_UP = ":feedback:thumbs-up";
export const THUMBS_DOWN = ":feedback:thumbs-down";

/**
 * CRUD manager (RemoteResource) for trace annotations.
 */
export class Annotations extends RemoteResource {
  constructor(traceId) {
    super(
      `/api/v1/trace/${traceId}/annotations`,
      `/api/v1/trace/${traceId}/annotation`,
      `/api/v1/trace/${traceId}/annotation`,
      `/api/v1/trace/${traceId}/annotate`
    );
    this.traceId = traceId;
    this.isNone = traceId == "<none>";
  }

  transform(data) {
    if (!data) {
      return [];
    }
    // not a valid response (likely an error)
    if (!Array.isArray(data)) {
      return [];
    }
    let annotations = {};
    data.forEach((annotation) => {
      if (!annotations[annotation.address]) {
        annotations[annotation.address] = [annotation];
      } else {
        annotations[annotation.address].push(annotation);
      }
    });
    // sort by timestamp
    for (let address in annotations) {
      annotations[address].sort((a, b) => a.timestamp - b.timestamp);
    }
    return annotations;
  }
}

/**
 * Instantiates a memoized decorator for the traceview to show annotations and annotation thread in the traceview.
 *
 * The decorator is an object that configures a trace view's behavior when a user clicks on a line in the trace view.
 *
 * It also indicates to the trace view, which lines are considered 'highlighted' because of user annotations or thumbs up/down.
 *
 * @param {string} activeTraceId - the trace ID
 * @param {number} activeTraceIndex - the trace index
 * @param {Object} highlights - the highlights to show in the traceview (e.g. because of analyzer or search results)
 * @param {Object} filtered_annotations - the filtered annotations (without analyzer annotations), i.e. the user annotations
 * @param {Function} onAnnotationCreate - callback to update annotations count on the Sidebar
 * @param {Function} onAnnotationDelete - callback to update annotations count on the Sidebar
 *
 * @return {Object} - the decorator object with the editor component, hasHighlight function, and annotationIndicators function
 */
function useHighlightDecorator(
  activeTraceId,
  activeTraceIndex,
  highlights,
  filtered_annotations,
  onAnnotationCreate,
  onAnnotationDelete,
  onRunAnalyzerEvent = null
) {
  // filter to hide analyzer messages in annotation threads
  const noAnalyzerMessages = (a) =>
    !a.extra_metadata || a.extra_metadata.source !== "analyzer";

  return useMemo(() => {
    let indicatorCache = new Map();

    return {
      editorComponent: (props) => {
        return (
          <div className="comment-insertion-point">
            <HighlightDetails {...props} />
            {!props.annotationsDisabled &&
              <AnnotationThread
                {...props}
                filter={noAnalyzerMessages}
                traceId={activeTraceId}
                traceIndex={activeTraceIndex}
                onAnnotationCreate={onAnnotationCreate}
                onAnnotationDelete={onAnnotationDelete}
                onRunAnalyzerEvent={onRunAnalyzerEvent}
                numHighlights={props.highlights.length}
              />
            }
          </div>
        );
      },
      hasHighlight: (address, ...args) => {
        if (
          filtered_annotations &&
          filtered_annotations[address] !== undefined
        ) {
          let thumbs = "";
          if (
            filtered_annotations[address].some((a) => a.content == THUMBS_UP)
          ) {
            thumbs += " thumbs-up";
          }
          if (
            filtered_annotations[address].some((a) => a.content == THUMBS_DOWN)
          ) {
            thumbs += " thumbs-down";
          }
          return (
            "highlighted num-" + filtered_annotations[address].length + thumbs
          );
        }
      },
      annotationIndicators: (address, ...args) => {
        // make sure, we do not recompute the indicators for the same address
        if (indicatorCache.has(address)) {
          return indicatorCache.get(address);
        }

        let counts = [];

        // add highlights
        if (highlights) {
          let forAddress = highlights.highlights.for_path(address);
          // replace address such that messages[4] is transformed to messages.4
          // this is needed because the traceview uses the address as a key
          let forAddressKey = address.replace(/\[\d+\]/g, (match) => {
            return "." + match.slice(1, -1);
          });
          let importantHighlights = highlights.highlights
            .for_path(forAddressKey)
            .allHighlights();
          const sources = importantHighlights.map(
            (importantHighlight) =>
              importantHighlight[1].content?.source ?? "unknown"
          );
          let counts_map = new Map();
          for (const source of sources) {
            counts_map.set(source, (counts_map.get(source) || 0) + 1);
          }

          for (const [s, c] of counts_map.entries()) {
            counts.push({
              type: s,
              count: c,
            });
          }
        }

        // add user annotations
        if (filtered_annotations) {
          // filter keys by prefix
          let keys = Object.keys(filtered_annotations).filter((key) =>
            key.startsWith(address)
          );
          let first_match = keys.length > 0 ? keys[0] : null;
          let count = 0;
          keys.forEach((key) => {
            count += filtered_annotations[key].length;
          });
          if (count > 0) {
            counts.push({
              type: "user",
              count: count,
              address: first_match,
            });
          }
        }

        indicatorCache.set(address, counts);

        return counts;
      },
      extraArgs: [activeTraceId],
    };
  }, [activeTraceId, filtered_annotations, highlights]);
}

/**
 * Components that renders agent traces with the ability for user's to add comments ("annotation").
 *
 * @param {Object} props
 * @param {Object} props.collapsed - whether the trace is collapsed by default
 * @param {Object} props.activeTrace - the trace to render
 * @param {string} props.selectedTraceId - the trace ID
 * @param {number} props.selectedTraceIndex - the trace index
 * @param {Object} props.mappings - the mappings to highlight in the traceview
 * @param {Function} props.onShare - callback to share the trace
 * @param {boolean} props.sharingEnabled - whether the trace is shared
 * @param {Function} props.onAnnotationCreate - callback to update annotations count on the Sidebar
 * @param {Function} props.onAnnotationDelete - callback to update annotations count on the Sidebar
 * @param {React.Component} props.header - the header component (e.g. <user>/<dataset>/<trace> links)
 * @param {React.Component} props.is_public - whether the trace is public
 * @param {React.Component} props.actions - the actions component (e.g. share, download, open in playground)
 * @param {React.Component} props.empty - the empty component to show if no trace is selected/specified (default: "No trace selected")
 * @param {boolean} props.isUserOwned - whether the trace is owned by the user
 * @param {boolean} props.enableNux - callback to enable the NUX
 * @param {boolean} props.enableAnalyzer - whether to enable the analyzer
 * @param {React.Component} props.prelude - extra prelude components to show at the top of the traceview (e.g. metadata)
 * @param {Array} props.annotations - the annotations to show in the traceview (if null-ish, stored annotations are used)
 * @param {boolean} props.toolbarItems - the toolbar items to show in the traceview (see TraceToolbarItems)
 */

export function AnnotationAugmentedTraceView(props) {
  // the rendered trace
  const activeTrace = props.activeTrace || null;
  // the trace ID
  const activeTraceId = props.selectedTraceId || null;
  // the trace index
  const activeTraceIndex = props.selectedTraceIndex;
  // whether the trace is public
  const is_public = props.is_public || null;
  // event hooks for the traceview to expand/collapse messages
  const [events, setEvents] = useState({});
  // loads and manages annotations as a remote resource (server CRUD)
  const [storedAnnotations, annotationStatus, annotationsError, annotator] = 
    useRemoteResource(Annotations, activeTraceId);

  const annotations = props.annotations || (annotationStatus == "ready" ? storedAnnotations : null);

  // highlights to show in the traceview (e.g. because of analyzer or search results)
  const [highlights, setHighlights] = useState({
    highlights: HighlightedJSON.empty(),
    traceId: null,
  });
  // filtered annotations (without analyzer annotations)
  const [filtered_annotations, setFilteredAnnotations] = useState({});
  // errors from analyzer annotations
  const [errors, setErrors] = useState([]);
  // top-level annotations (e.g. global errors, assertions)
  const [top_level_annotations, setTopLevelAnnotations] = useState([]);

  // top-level annotations (e.g. global errors, assertions)
  const [analyzer_annotations, setAnalyzerAnnotations] = useState([]);

  // Callback functions to update annotations count on the Sidebad.
  const { onAnnotationCreate, onAnnotationDelete } = props;

  // record if the trace is expanded to decide show "expand all" or "collapse all" button
  const [is_all_expanded, setAllExpand] = useState(props.collapsed);

  // get telemetry object
  const telemetry = useTelemetry();

  const [lastPushedAnalyzerResult, setLastPushedAnalyzerResult] =
    useState(null);

  const analyzer = useAnalyzer();

  // expand all messages
  const onExpandAll = () => {
    setAllExpand(true);
    telemetry.capture("traceview.expand-all");
    events.expandAll?.fire();
  };

  // collapse all messages
  const onCollapseAll = () => {
    setAllExpand(false);
    telemetry.capture("traceview.collapse-all");
    events.collapseAll?.fire();
  };

  const navigate = useNavigate();

  // open in playground
  const onOpenInPlayground = () => {
    openInPlayground(activeTrace?.messages || [], navigate);
    telemetry.capture("traceview.open-in-playground");
  };

  // on share
  const onShare = () => {
    props.onShare();
    telemetry.capture("traceview.share-modal-opened");
  };

  // whenever activeTrace changed, the trace is defaultly expanded, set the button to be collapse
  useEffect(() => {
    if (props.collapsed) {
      setAllExpand(false);
      events.collapseAll?.fire();
    } else {
      setAllExpand(true);
      events.expandAll?.fire();
    }
  }, [activeTrace]);

  // reset analyzer when trace changes
  useEffect(() => {
    analyzer.reset();
  }, [activeTraceId]);

  // whenever annotations change, update mappings
  useEffect(() => {
    let {
      highlights,
      errors,
      filtered_annotations,
      top_level_annotations,
      analyzer_annotations,
    } = AnnotationsParser.parse_annotations(
      !props.hideAnnotations ? annotations : [],
      props.mappings
    );
    setHighlights({
      highlights: HighlightedJSON.from_entries(highlights),
      traceId: activeTraceId,
    });
    setErrors(errors);
    setFilteredAnnotations(filtered_annotations);
    setTopLevelAnnotations(top_level_annotations);
    setAnalyzerAnnotations(analyzer_annotations);
  }, [annotations, props.mappings]);

  // event to trigger analysis model run
  const [onRunAnalyzerEvent, _setOnRunAnalyzerEvent] = useState(
    new BroadcastEvent()
  );

  // construct decorator for the traceview, to show annotations and annotation thread in the traceview
  const decorator = useHighlightDecorator(
    activeTraceId,
    activeTraceIndex,
    highlights,
    filtered_annotations,
    onAnnotationCreate,
    onAnnotationDelete,
    onRunAnalyzerEvent
  );

  // wait a bit after the last render of the components to enable the guide
  useEffect(() => {
    const timer = setTimeout(() => {
      if (props.enableNux) props.enableNux(); // Mark rendering as stabilized
    }, 500); // Adjust the timeout based on the rendering frequency
    return () => {
      clearTimeout(timer); // Clear the timeout if re-render occurs
    };
  }, [events]);

  // callback for when a user downloads a dataset
  const onDownloadTrace = (event, trace_id) => {
    // trigger the download (endpoint is /api/v1/dataset/byid/:id/download)
    window.open(`/api/v1/trace/${trace_id}/download`, "_blank");
    event.preventDefault();
  };

  // note: make sure to only pass highlights here that actually belong to the active trace
  // otherwise we can end up in an intermediate state where we have a new trace but old highlights (this must never happen)
  const traceHighlights =
    highlights.traceId == activeTraceId
      ? highlights.highlights
      : HighlightedJSON.empty();

  const onDiscardAnalysisResult = async (analysis_annotations) => {
    await analysis_annotations.forEach(async (a) => {
      // delete the corresponding stored annotation by ID (if it exists)
      if (a.id) await annotator.delete(a.id);
    });
    // set local analyzer output to null
    analyzer.setOutput(null);
    // wait for delete to finish, then refresh the annotations
    window.setTimeout(() => annotator.refresh(), 20);
  };

  const onAcceptAnalysisResult = async (annotation) => {
    // set the last pushed analyzer result to the current analysis result
    await annotator.update(
      annotation.id,
      {
        content: annotation.content,
        extra_metadata: {
          status: annotation.status == "accepted" ? "proposed" : "accepted",
        },
      }
    )
    await annotator.refresh();
  };

  const onRejectAnalysisResult = async (annotation) => {
    // set the last pushed analyzer result to the current analysis result
    await annotator.update(
      annotation.id,
      {
        content: annotation.content,
        extra_metadata: {
          status: annotation.status == "rejected" ? "proposed" : "rejected",
        },
      }
    )
    await annotator.refresh();
  };

  const [analyzerOpen, _setAnalyzerOpen] = useState(
    localStorage.getItem("analyzerOpen") == "true"
  );
  const setAnalyzerOpen = (open) => {
    _setAnalyzerOpen(open);
    localStorage.setItem("analyzerOpen", open);
  };

  return (
    <>
      <header className="toolbar">
        {props.header}
        {
          // Add a box to show if the trace is public or private (if the prop is set)
          props.is_public != null && (
            <div
              className={`badge ${props.is_public ? "public-trace" : "private-trace"}`}
            >
              {props.is_public ? "Shared" : "Private"}
            </div>
          )
        }
        <div className="spacer" />
        <div className="vr" />
        <HighlightsNavigator
          highlights={traceHighlights}
          top_level_annotations={top_level_annotations}
          onOpen="expand-first"
          traceId={activeTraceId}
        />
        {activeTrace && (
          <>
            {props.toolbarItems?.expandCollapse && (
            is_all_expanded ? (
              <button
                className="inline icon nux-step-3"
                onClick={onCollapseAll}
                data-tooltip-id="highlight-tooltip"
                data-tooltip-content="Collapse All"
              >
                <BsArrowsCollapse />
              </button>
            ) : (
              <button
                className="inline icon nux-step-3"
                onClick={onExpandAll}
                data-tooltip-id="highlight-tooltip"
                data-tooltip-content="Expand All"
              >
                <BsArrowsExpand />
              </button>
            ))}
            {props.toolbarItems?.download && (
            <button
              className="inline icon"
              onClick={(e) => {
                onDownloadTrace(e, activeTraceId);
                e.stopPropagation();
                telemetry.capture("traceview.download");
              }}
              data-tooltip-id="highlight-tooltip"
              data-tooltip-content="Download"
            >
              <BsDownload />
            </button>
            )}
            {props.actions}
            <div className="vr" />
            {
              props.toolbarItems?.openInPlayground && (
              <button
                className="inline"
                onClick={onOpenInPlayground}
                data-tooltip-id="highlight-tooltip"
                data-tooltip-content="Opens this trace in the Guardrails Playground"
              >
                {" "}
                <BsTerminal /> Open In Playground
              </button>
              )
            }
            {props.toolbarItems?.share && (props.isUserOwned && config("sharing") && props.onShare && (
              <button
                className={
                  "inline nux-step-4" + (props.sharingEnabled ? "primary" : "")
                }
                onClick={onShare}
              >
                {!props.sharingEnabled ? (
                  <>
                    <BsShare /> Share
                  </>
                ) : (
                  <>
                    <BsCheck /> Shared
                  </>
                )}
              </button>
            ))}
            {props.enableAnalyzer && props.toolbarItems?.analyzer && (<button
              className="inline analyzer-button"
              data-aria-label="open-analyzer-button"   
              onClick={() => setAnalyzerOpen(!analyzerOpen)}
            >
              Analysis
              <BsLayoutSidebarInsetReverse />
            </button>)}
          </>
        )}
      </header>
      <div className="explorer panel traceview">
        <TraceViewContent
          empty={props.empty}
          datasetname={props.datasetname}
          activeTrace={activeTrace}
          activeTraceId={activeTraceId}
          highlights={traceHighlights}
          errors={errors}
          decorator={decorator}
          setEvents={setEvents}
          allExpanded={is_all_expanded}
          topLevelAnnotations={top_level_annotations}
          traceIndex={activeTraceIndex}
          onUpvoteDownvoteCreate={onAnnotationCreate}
          onUpvoteDownvoteDelete={onAnnotationDelete}
          prelude={
            <>
              {props.enableAnalyzer && (
                <AnalyzerPreview
                  analyzer={analyzer}
                  open={analyzerOpen}
                  setAnalyzerOpen={setAnalyzerOpen}
                  output={analyzer.output}
                  running={analyzer.running}
                  annotations={analyzer_annotations}
                  onRunAnalyzer={onRunAnalyzerEvent}
                />
              )}
            </>
          }
          padding={{
            right: props.enableAnalyzer && analyzerOpen ? "370pt" : "65pt",
          }}
        />
        {props.enableAnalyzer && activeTraceId && (
          <AnalyzerSidebar
            open={analyzerOpen}
            output={analyzer.output}
            analyzer={analyzer}
            running={analyzer.running}
            debugInfo={analyzer.debugInfo}
            annotations={analyzer_annotations}
            traceId={activeTraceId}
            datasetId={props.datasetId}
            username={props.username}
            onDiscardAnalysisResult={
              props.isUserOwned ? onDiscardAnalysisResult : null
            }
            dataset={props.dataset}
            onAnalyzeEvent={onRunAnalyzerEvent}
            onAnnotationChange={() => annotator.refresh()}
            onAcceptAnalysisResult={onAcceptAnalysisResult}
            onRejectAnalysisResult={onRejectAnalysisResult}
          />
        )}
      </div>
      <Tooltip
        id="highlight-tooltip"
        place="bottom"
        style={{ whiteSpace: "pre" }}
      />
      <Tooltip id="highlights-navigator-tooltip" place="bottom" />
    </>
  );
}

/**
 * Show the rendered trace or an `props.empty` component if no trace is selected.
 */
function TraceViewContent(props) {
  const {
    datasetname,
    activeTrace,
    activeTraceId,
    highlights,
    errors,
    decorator,
    setEvents,
    traceIndex,
    onUpvoteDownvoteCreate,
    onUpvoteDownvoteDelete,
    padding,
  } = props;
  const EmptyComponent =
    props.empty || (() => <div className="empty">No trace selected</div>);

  const onSuccess = () => {
    window.location.reload();
  };

  // if no trace ID set
  if (activeTraceId === null) {
    return (
      <div className="explorer panel">
        <EmptyComponent datasetname={datasetname} onSuccess={onSuccess} />
      </div>
    );
  }
  return (
    <RenderedTrace
      // the trace events
      trace={JSON.stringify(activeTrace?.messages || [], null, 2)}
      // ranges to highlight (e.g. because of analyzer or search results)
      highlights={highlights}
      // callback to register events for collapsing/expanding all messages
      onMount={(events) => setEvents(events)}
      // extra UI decoration (inline annotation editor)
      decorator={decorator}
      // extra UI to show at the top of the traceview like metadata
      prelude={
        <>
          <TopLevelHighlights topLevelAnnotations={props.topLevelAnnotations} />
          <Metadata
            extra_metadata={
              activeTrace?.extra_metadata || activeTrace?.trace?.extra_metadata
            }
            header={<div className="role">Trace Information</div>}
            excluded={["invariant.num-warnings", "invariant.num-failures"]}
          />
          {errors.length > 0 && <AnalysisResult errors={errors} />}
          {props.prelude}
        </>
      }
      allExpanded={props.allExpanded}
      traceId={activeTraceId}
      traceIndex={traceIndex}
      onUpvoteDownvoteCreate={onUpvoteDownvoteCreate}
      onUpvoteDownvoteDelete={onUpvoteDownvoteDelete}
      padding={padding}
    />
  );
}

// shows details on the top-level highlights of a trace (e.g. higlights without a specific address)
function TopLevelHighlights(props) {
  const highlights = {
    snippet: "Top Level Annotations",
    start: 0,
    end: 0,
    content: props.topLevelAnnotations || [],
  };

  // if no highlights, return null
  if (!highlights.content.length) {
    return null;
  }

  // render the highlights
  return (
    <div className="event top-level-highlights">
      <HighlightDetails highlights={[highlights]} />
    </div>
  );
}

function safeAnchorId(annotationId) {
  if (!annotationId) {
    return "no-id";
  }
  return annotationId.replace(/[^a-zA-Z0-9]/g, "_");
}

// AnnotationThread renders a thread of annotations for a given address in a trace (shown inline)
function AnnotationThread(props) {
  // let [annotations, annotationStatus, annotationsError, annotator] = props.annotations
  const [cachedAnnotations, annotationStatus, annotationsError, annotator] =
    useRemoteResource(Annotations, props.traceId);
  
  // Create a deep copy to avoid mutating the shared cached object
  const annotations = {};
  for (let address in cachedAnnotations) {
    // filter out analyzer annotations without mutating the original
    annotations[address] = cachedAnnotations[address].filter(
      (a) => a.extra_metadata?.source !== "analyzer-model"
    );
  }
  const { onAnnotationCreate, onAnnotationDelete } = props;
  let threadAnnotations = (annotations || {})[props.address] || [];

  return (
    <div className="annotation-thread">
      {threadAnnotations
        .filter((a) => (props.filter ? props.filter(a) : true))
        .map((annotation) => (
          <Annotation
            {...annotation}
            annotator={annotator}
            key={annotation.id}
            traceIndex={props.traceIndex}
            onAnnotationDelete={onAnnotationDelete}
            onRunAnalyzerEvent={props.onRunAnalyzerEvent}
          />
        ))}
      <AnnotationEditor
        address={props.address}
        traceId={props.traceId}
        traceIndex={props.traceIndex}
        onClose={props.onClose}
        onRunAnalyzerEvent={props.onRunAnalyzerEvent}
        annotations={[
          annotations,
          annotationStatus,
          annotationsError,
          annotator,
        ]}
        onAnnotationCreate={onAnnotationCreate}
        numHighlights={props.numHighlights}
      />
    </div>
  );
}

function readableSourceName(source) {
  if (source == "accepted-analyzer-model") {
    return "Analysis Model";
  }
  if (source == "analyzer-model") {
    return "Analysis Model";
  }
  return source;
}

// Annotation renders an annotation bubble with the ability to edit and delete
function Annotation(props) {
  const annotator = props.annotator;
  const [comment, setComment] = useState(props.content);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const user = props?.user;
  const userInfo = useUserInfo();

  const telemetry = useTelemetry();

  const onDelete = () => {
    annotator
      .delete(props.id)
      .then(() => {
        setComment("");
        telemetry.capture("annotation.deleted");
        annotator.refresh();
        if (props.onAnnotationDelete) {
          props.onAnnotationDelete(props.traceIndex);
        }
      })
      .catch((error) => {
        alert("Failed to delete annotation: " + error);
      });
  };

  const onUpdate = () => {
    setSubmitting(true);
    annotator
      .update(props.id, { content: comment })
      .then(() => {
        setSubmitting(false);
        telemetry.capture("annotation.updated");
        annotator.refresh();
        setEditing(false);
        // enable this, if you want to re-run the analysis whenever a new @Invariant annotation appears
        // if (props.onRunAnalyzerEvent && comment.includes("@Invariant")) {
        //   props.onRunAnalyzerEvent.fire();
        // }
      })
      .catch((error) => {
        alert("Failed to save annotation: " + error);
        setSubmitting(false);
      });
  };

  const onKeyDown = (e) => {
    // on mac cmd+enter, on windows ctrl+enter to save
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onUpdate();
    }
    // escape cancels editing
    if (e.key === "Escape") {
      setComment(props.content);
      setEditing(false);
    }
  };

  let content = props.content;  
  if (content == THUMBS_UP) {
    content = (
      <span className="thumbs-up-icon">
        <BsArrowUp />
        Positive Feedback
      </span>
    );
  } else if (content == THUMBS_DOWN) {
    content = (
      <span className="thumbs-down-icon">
        <BsArrowDown />
        Negative Feedback
      </span>
    );
  } else {
    // Render @-mentions in bold for non-edit mode
    content = renderTextWithMentions(content);
  }

  const source = readableSourceName(props.extra_metadata?.source);

  return (
    <div className="annotation">
      <div className="user">
        <UserIcon username={userInfo?.username} />
      </div>
      <div className="bubble">
        <header className="username">
          <BsCaretLeftFill className="caret" />
          <div>
            <b>
              {userInfo?.loggedIn && userInfo.username == props.user.username
                ? "You"
                : props.user.username}
            </b>
            {source && (
              <span className="source">
                via <b>{source}</b>{" "}
              </span>
            )}
            annotated{" "}
            <span className="time">
              {" "}
              <Time>{props.time_created}</Time>{" "}
            </span>
          </div>
          <div className="spacer" />
          <div className="actions">
            {userInfo?.id == props.user.id && !editing && (
              <button onClick={() => setEditing(!editing)}>
                <BsPencilFill />
              </button>
            )}
            {userInfo?.id == props.user.id && (
              <button onClick={onDelete}>
                <BsTrash />
              </button>
            )}
          </div>
        </header>
        {!editing && <div className="content">{content}</div>}
        {editing && (
          <ContentEditableText
            value={comment}
            onChange={setComment}
            onKeyDown={onKeyDown}
            autoFocus={true}
            style={{
              minHeight: "40px",
              padding: "6px",
              fontSize: "14px",
              lineHeight: "1.3"
            }}
          />
        )}
        {editing && (
          <div className="actions">
            <button onClick={() => {
              setComment(props.content);
              setEditing(false);
            }}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={submitting || comment === ""}
              onClick={onUpdate}
            >
              {submitting ? "Saving..." : "Save"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// List of highlightable @-mentions
const HIGHLIGHTABLE_MENTIONS = ["@Invariant"];

// ContentEditableText is a reusable component for text editing with @-mention highlighting
function ContentEditableText({ 
  value, 
  onChange, 
  onKeyDown, 
  onSave,
  placeholder = "",
  autoFocus = false,
  className = "",
  style = {},
  mentions = HIGHLIGHTABLE_MENTIONS 
}) {
  const editorRef = useRef(null);

  // Function to safely format content with @-mention highlighting
  // Returns an array of DOM elements to safely insert into the contentEditable div
  const formatContentSafely = (text) => {
    if (!text) return [];
    
    // Create regex pattern for all mentions
    const mentionPattern = new RegExp(`(${mentions.join('|')})`, 'g');
    
    // Split text by mentions and create safe DOM elements
    const parts = text.split(mentionPattern);
    const elements = [];
    
    parts.forEach((part, index) => {
      if (mentions.includes(part)) {
        // Create bold element for mentions
        const boldElement = document.createElement('b');
        boldElement.textContent = part; // textContent automatically escapes
        elements.push(boldElement);
      } else if (part) {
        // Create text node for regular text (automatically safe)
        elements.push(document.createTextNode(part));
      }
    });
    
    return elements;
  };

  // Helper function to safely update the DOM content
  const updateContentSafely = (container, text) => {
    // Clear existing content
    container.innerHTML = '';
    
    // Add safe elements
    const elements = formatContentSafely(text);
    elements.forEach(element => {
      container.appendChild(element);
    });
  };

  // Function to get plain text content from the editor
  const getTextContent = () => {
    if (editorRef.current) {
      return editorRef.current.textContent || "";
    }
    return "";
  };

  // Handle input changes
  const onInput = () => {
    if (editorRef.current) {
      const textContent = getTextContent();
      onChange(textContent);
      
      // Store cursor position relative to text content (not DOM nodes)
      const selection = window.getSelection();
      let cursorOffset = 0;
      
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        // Calculate cursor position in the entire text content
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(editorRef.current);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        cursorOffset = preCaretRange.toString().length;
      }
      
      // Update content with safe formatting
      updateContentSafely(editorRef.current, textContent);
      
      // Restore cursor position
      try {
        const newRange = document.createRange();
        const walker = document.createTreeWalker(
          editorRef.current,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );
        
        let currentOffset = 0;
        let targetNode = null;
        let targetOffset = cursorOffset;
        
        let node;
        while (node = walker.nextNode()) {
          const nodeLength = node.textContent.length;
          if (currentOffset + nodeLength >= cursorOffset) {
            targetNode = node;
            targetOffset = cursorOffset - currentOffset;
            break;
          }
          currentOffset += nodeLength;
        }
        
        if (targetNode) {
          newRange.setStart(targetNode, Math.min(targetOffset, targetNode.textContent.length));
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
        } else {
          // If no target node found, place cursor at the end
          newRange.selectNodeContents(editorRef.current);
          newRange.collapse(false);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      } catch (e) {
        // If cursor restoration fails, just place it at the end
        try {
          const newRange = document.createRange();
          newRange.selectNodeContents(editorRef.current);
          newRange.collapse(false);
          selection.removeAllRanges();
          selection.addRange(newRange);
        } catch (fallbackError) {
          // Final fallback - focus the element
          editorRef.current.focus();
        }
      }
    }
  };

  // Handle key down events
  const handleKeyDown = (e) => {
    // Tab autocompletion for mentions
    if (e.key === "Tab") {
      const selection = window.getSelection();
      if (selection.rangeCount > 0 && editorRef.current) {
        const range = selection.getRangeAt(0);
        const textContent = getTextContent();
        
        // Calculate cursor position in the entire text content
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(editorRef.current);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        const cursorOffset = preCaretRange.toString().length;
        
        // Get text before cursor
        const textBeforeCursor = textContent.slice(0, cursorOffset);
        
        // Check if the text before cursor ends with a partial mention (case-insensitive)
        let bestMatch = null;
        let matchLength = 0;
        
        mentions.forEach(mention => {
          for (let i = 1; i <= Math.min(mention.length - 1, textBeforeCursor.length); i++) {
            const partial = mention.slice(0, i);
            // Case-insensitive comparison
            if (textBeforeCursor.toLowerCase().endsWith(partial.toLowerCase())) {
              if (i > matchLength) {
                bestMatch = mention;
                matchLength = i;
              }
            }
          }
        });
        
        if (bestMatch && matchLength > 0) {
          e.preventDefault();
          
          // Replace the partial text with the full mention
          const beforePartial = textBeforeCursor.slice(0, -matchLength);
          const afterCursor = textContent.slice(cursorOffset);
          const newText = beforePartial + bestMatch + " " + afterCursor;
          
          // Update content
          onChange(newText);
          
          // Update the DOM with safe formatting
          updateContentSafely(editorRef.current, newText);
          
          // Set cursor position after the completed mention and space
          const newCursorPosition = beforePartial.length + bestMatch.length + 1;
          
          try {
            const newRange = document.createRange();
            const walker = document.createTreeWalker(
              editorRef.current,
              NodeFilter.SHOW_TEXT,
              null,
              false
            );
            
            let currentOffset = 0;
            let targetNode = null;
            let targetOffset = newCursorPosition;
            
            let node;
            while (node = walker.nextNode()) {
              const nodeLength = node.textContent.length;
              if (currentOffset + nodeLength >= newCursorPosition) {
                targetNode = node;
                targetOffset = newCursorPosition - currentOffset;
                break;
              }
              currentOffset += nodeLength;
            }
            
            if (targetNode) {
              newRange.setStart(targetNode, Math.min(targetOffset, targetNode.textContent.length));
              newRange.collapse(true);
              selection.removeAllRanges();
              selection.addRange(newRange);
            }
          } catch (error) {
            // Fallback: place cursor at the end
            const newRange = document.createRange();
            newRange.selectNodeContents(editorRef.current);
            newRange.collapse(false);
            selection.removeAllRanges();
            selection.addRange(newRange);
          }
        }
      }
    }
    
    // Prevent some formatting shortcuts
    if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'i' || e.key === 'u')) {
      e.preventDefault();
    }
    
    // Call parent onKeyDown handler
    if (onKeyDown) {
      onKeyDown(e);
    }
  };

  // Set initial content and focus
  useEffect(() => {
    if (editorRef.current) {
      updateContentSafely(editorRef.current, value);
      
      if (autoFocus) {
        window.setTimeout(() => {
          if (editorRef.current) {
            editorRef.current.focus();
          }
        }, 100);
      }
    }
  }, []);

  // Update content when value prop changes
  useEffect(() => {
    if (editorRef.current && editorRef.current.textContent !== value) {
      updateContentSafely(editorRef.current, value);
    }
  }, [value]);

  return (
    <div
      contentEditable={true}
      ref={editorRef}
      onInput={onInput}
      onKeyDown={handleKeyDown}
      className={`content-editable-text ${className}`}
      // style={defaultStyle}
      suppressContentEditableWarning={true}
      placeholder={placeholder}
    />
  );
}

// Function to render text with @-mention highlighting (for read-only display)
function renderTextWithMentions(text, mentions = HIGHLIGHTABLE_MENTIONS) {
  if (!text) return text;
  
  // Create regex pattern for all mentions
  const mentionPattern = new RegExp(`(${mentions.join('|')})`, 'g');
  
  // Split text by mentions and render
  const parts = text.split(mentionPattern);
  return parts.map((part, index) => {
    if (mentions.includes(part)) {
      return <b key={index}>{part}</b>;
    }
    return part;
  });
}

// AnnotationEditor renders an inline annotation editor for a given address in a trace (for creating a new annotation).
function AnnotationEditor(props) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [annotations, annotationStatus, annotationsError, annotator] =
    props.annotations;
  const userInfo = useUserInfo();

  const telemetry = useTelemetry();

  const onSave = () => {
    if (!userInfo?.loggedIn) {
      window.location.href = "/login";
    }

    if (content === "") {
      return;
    }

    setSubmitting(true);
    annotator
      .create({ address: props.address, content: content })
      .then(() => {
        setSubmitting(false);
        telemetry.capture("annotation.created");
        annotator.refresh();
        setContent("");
        if (props.onAnnotationCreate) {
          props.onAnnotationCreate(props.traceIndex);
        }
        // enable this, if you want to re-run the analysis whenever a new @Invariant annotation appears
        // if (props.onRunAnalyzerEvent && content.includes("@Invariant")) {
        //   props.onRunAnalyzerEvent.fire();
        // }
      })
      .catch((error) => {
        alert("Failed to save annotation: " + error);
        setSubmitting(false);
      });
  };

  const onKeyDown = (e) => {
    // on mac cmd+enter, on windows ctrl+enter to save
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSave();
    }
    // escape closes
    if (e.key === "Escape") {
      props.onClose();
    }
  };

  return (
    <div className="annotation">
      <div className="user">
        {userInfo?.loggedIn ? (
          <UserIcon username={userInfo?.username} />
        ) : (
          // if not logged in, show a generic user icon without name.
          <UserIcon username="" />
        )}
      </div>
      <div className="bubble">
        <header className="username">
          <BsCaretLeftFill className="caret" />
          {userInfo?.loggedIn ? (
            <p>Add Annotation</p>
          ) : (
            <p>Log in to be able to add an annotation</p>
          )}
          <div className="spacer" />
          <div className="actions">
            <pre
              style={{ opacity: 0.4 }}
              onClick={() => copyPermalinkToClipboard(props.address)}
            >
              {props.address}
            </pre>
          </div>
        </header>
        <ContentEditableText
          value={content}
          onChange={setContent}
          onKeyDown={onKeyDown}
          autoFocus={props.numHighlights < 3}
          className="annotation-editor"
        />
        <div className="actions">
          <button className="secondary" onClick={props.onClose}>
            Close
          </button>
          <button
            className="primary"
            disabled={submitting || (content === "" && userInfo?.loggedIn)}
            onClick={onSave}
            aria-label="save-annotation"
          >
            {!userInfo?.loggedIn ? (
              "Sign Up To Annotate"
            ) : submitting ? (
              "Saving..."
            ) : (
              <>
                Save{" "}
                <span className="shortcut">
                  <BsCommand /> + Enter
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
