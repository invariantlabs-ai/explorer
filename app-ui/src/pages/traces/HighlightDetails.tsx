/**
 * Highlight details are extra views shown, when a specific line with highlights is selected in the trace view.
 *
 * This component renders the details of the highlights in the unfolding UI.
 */
import {
  BsCheckCircleFill,
  BsExclamationTriangleFill,
  BsXCircleFill,
} from "react-icons/bs";
import {
  GroupedHighlight,
  HighlightData,
} from "../../lib/traceview/highlights";
import { AnalysisResult } from "../../lib/analysis_result";
import { useState, useEffect } from "react";
import { AnchorDiv } from "../../lib/permalink-navigator";
import { GuardrailsIcon } from "../../components/Icons";

/**
 * Renders details on specific highlights in the unfolding UI that is shown
 * on selecting a line in the trace view.

 */
export function HighlightDetails(props: { highlights: GroupedHighlight[] }) {
  let highlightsByKey: Record<string, HighlightData> = {};
  for (const highlight of props.highlights) {
    for (const highlightData of highlight.content || []) {
      highlightsByKey[highlightData.annotationId!] = highlightData;
    }
  }
  const highlights: HighlightData[] = Object.values(highlightsByKey);

  // analyzer highlights
  const analyzerHighlights = highlights.filter(
    (highlight) => highlight.source == "analyzer"
  );
  let otherHighlights = highlights.filter(
    (highlight) => highlight.source != "analyzer"
  );

  // test highlights
  const testHighlights = otherHighlights.filter((highlight) =>
    highlight.source?.startsWith("test-")
  );
  otherHighlights = otherHighlights.filter(
    (highlight) => !highlight.source?.startsWith("test-")
  );

  return (
    <>
      {(analyzerHighlights.length > 0 || testHighlights.length > 0) && (
        <div className="highlight-header">Issues</div>
      )}
      {analyzerHighlights.length > 0 && (
        <AnalysisResultDetail highlights={analyzerHighlights} />
      )}
      {testHighlights.length > 0 && (
        <TestResultDetail highlights={testHighlights} />
      )}
      {otherHighlights.map((highlight) => {
        return (
          <HighlightDetail key={highlight.annotationId} highlight={highlight} />
        );
      })}
    </>
  );
}

/**
 * Shows a box summarizing the analyzer errors in the selected line of the trace view.
 */
export function AnalysisResultDetail(props: { highlights: HighlightData[] }) {
  const [errors, setErrors] = useState<{ type: string; count: number }[]>([]);

  useEffect(() => {
    let count_per_message: Record<string, number> = {};
    for (let highlight of props.highlights) {
      try {
        let analyzerContent = JSON.parse(highlight.content);
        let msg = analyzerContent["args"].join(" ");
        if (count_per_message[msg]) {
          count_per_message[msg] += 1;
        } else {
          count_per_message[msg] = 1;
        }
      } catch (error) {
        // ignore
      }
    }

    let errors = Object.entries(count_per_message).map(([type, count]) => {
      return { type, count };
    });
    setErrors(errors);
  }, [props.highlights]);

  return <AnalysisResult errors={errors} />;
}

/**
 * Renders all test highlights in the selected line of the trace view,
 * showing failed checks first.
 */
export function TestResultDetail(props: { highlights: HighlightData[] }) {
  // keep original order, but sort by -passed first
  let passed = props.highlights.filter((highlight) =>
    highlight.source?.endsWith("-passed")
  );
  let failed = props.highlights.filter(
    (highlight) => !highlight.source?.endsWith("-passed")
  );

  // always show failed on top
  return (
    <>
      {failed.map((highlight) => {
        return (
          <HighlightDetail key={highlight.annotationId} highlight={highlight} />
        );
      })}
      {passed.map((highlight) => {
        return (
          <HighlightDetail key={highlight.annotationId} highlight={highlight} />
        );
      })}
    </>
  );
}

/**
 * A box component detailing one of the highlights in the selected
 * line of the trace view.
 *
 * For instance, a test failure or a analyzer warning.
 *
 * May return null if we don't have custom detailing for a highlight.
 *
 * @param props.highlight The highlight data to render details for.
 */
export function HighlightDetail(props: { highlight: HighlightData }) {
  const highlight = props.highlight;

  if (
    highlight.source == "test-assertion" ||
    highlight.source == "test-expectation"
  ) {
    return (
      <TestFailureHighlightDetail
        highlight={highlight}
        severity={highlight.source.replace("test-", "")}
      />
    );
  } else if (
    highlight.source == "test-assertion-passed" ||
    highlight.source == "test-expectation-passed"
  ) {
    return (
      <TestSuccessHighlightDetail
        highlight={highlight}
        severity={highlight.source.replace("test-", "")}
      />
    );
  }
  if (highlight.source == "guardrails-error") {
    return <GuardrailFailureHighlightDetail highlight={highlight} />;
  } else if (highlight.source == "analyzer") {
    // ignore analyzer highlights (they are aggregated and shown in the separate analysis result)
  }

  return null;
}

/**
 * Details successful test highlights in the selected line of the trace view.
 */
export function TestSuccessHighlightDetail(props: {
  highlight: HighlightData;
  severity: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const highlight = props.highlight;

  const label =
    props.severity == "expectation-passed"
      ? "Expectation Met"
      : "Assertion Passed";
  const icon =
    props.severity == "expectation-passed" ? (
      <BsCheckCircleFill />
    ) : (
      <BsCheckCircleFill />
    );

  return (
    <AnchorDiv
      className={
        "event test-result " + props.severity + (expanded ? " " : " compact")
      }
      onClick={() => setExpanded(!expanded)}
      copyOnClick={false}
      id={safeAnchorId(highlight.annotationId || "")}
    >
      <div className="content">
        <div className="test-result-header">
          {icon}
          <b>{label}</b> {highlight.content}
        </div>
        {expanded && highlight.extra_metadata?.test && (
          <>
            <MarkedLinePre line={highlight.extra_metadata?.line}>
              {highlight.extra_metadata?.test}
            </MarkedLinePre>
          </>
        )}
      </div>
    </AnchorDiv>
  );
}

/**
 * Visualizes a guardrail evaluation details when the corresponding line is selected in the trace view.
 */
export function GuardrailHighlightDetail(props: {
  highlight: HighlightData;
  text: string;
  onHover?: (hover: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const highlight = props.highlight;

  let guardrail_information = highlight.extra_metadata?.guardrail;
  let guardrail_id = guardrail_information?.id;
  let guardrail_action = guardrail_information?.action;
  let guardrail_content = guardrail_information?.content;

  // try to guess relevant line, but checking for exact match of the content with a line in guardrail_content (if present)
  let line = -1;
  if (guardrail_content) {
    // determine line
    const lines = guardrail_content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(highlight.content)) {
        line = i;
        break;
      }
    }

    // in header include # id: nad #action: if available and update line accordingly. Also add spacing line between header and content if thereis a header
    let header_lines: string[] = [];
    if (guardrail_id) {
      header_lines.push("# id: " + guardrail_id);
    }
    if (guardrail_action) {
      header_lines.push("# action: " + guardrail_action);
    }
    if (header_lines.length > 0) {
      header_lines.push("");
    }
    // add header to content
    guardrail_content = header_lines.join("\n") + " " + guardrail_content;
    line = line + header_lines.length - 1;
  }

  return (
    <AnchorDiv
      className={"event guardrail flow-in"}
      onClick={() => guardrail_content && setExpanded(!expanded)}
      copyOnClick={false}
      id={safeAnchorId(highlight.annotationId || "")}
    >
      <div
        className="content"
        onMouseEnter={() => props.onHover?.(true)}
        onMouseLeave={() => props.onHover?.(false)}
      >
        <div className={"guardrail-header" + (expanded ? " expanded" : "")}>
          <GuardrailsIcon />
          <b>{props.text}</b> {highlight.content}
          {guardrail_id && <span className="guardrail-id">{guardrail_id}</span>}
        </div>
        {expanded && guardrail_content && (
          <>
            <MarkedLinePre line={line}>{guardrail_content}</MarkedLinePre>
          </>
        )}
      </div>
    </AnchorDiv>
  );
}

/**
 * Visualizes a guardrail failure when the corresponding line is selected in the trace view.
 */
export function GuardrailFailureHighlightDetail(props: {
  highlight: HighlightData;
  onHover?: (hover: boolean) => void;
}) {
  return (
    <GuardrailHighlightDetail
      highlight={props.highlight}
      onHover={props.onHover}
      text="Guardrail Failure"
    />
  );
}

/**
 * Details failed test highlights in the selected line of the trace view.
 */
export function TestFailureHighlightDetail(props: {
  highlight: HighlightData;
  severity: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const highlight = props.highlight;

  const label =
    props.severity == "expectation"
      ? "Expectation Violated"
      : "Assertion Failed";
  const icon =
    props.severity == "expectation" ? (
      <BsExclamationTriangleFill />
    ) : (
      <BsXCircleFill />
    );

  return (
    <AnchorDiv
      className={
        "event test-result " + props.severity + (expanded ? " " : " compact")
      }
      onClick={() => setExpanded(!expanded)}
      copyOnClick={false}
      id={safeAnchorId(highlight.annotationId || "")}
    >
      <div className="content">
        <div className="test-result-header">
          {icon}
          <b>{label}</b> {highlight.content}
        </div>
        {expanded && highlight.extra_metadata?.test && (
          <>
            <MarkedLinePre line={highlight.extra_metadata?.line}>
              {highlight.extra_metadata?.test}
            </MarkedLinePre>
          </>
        )}
      </div>
    </AnchorDiv>
  );
}

/**
 * Simple code block where one specific line is highlighted in bold.
 */
export function MarkedLinePre(props: {
  line?: number;
  children: React.ReactNode;
}) {
  const lines = (props.children?.toString() || "").split("\n");
  return (
    <pre className={"marked-line " + ((props.line || -1) < 0 ? "no-line" : "")}>
      {lines.map((line, index) => {
        const highlighted = index == props.line;
        const className = index == props.line ? "highlight" : "";
        return (
          <div key={index} className={className}>
            {highlighted && ""}
            {line}
          </div>
        );
      })}
    </pre>
  );
}

export function safeAnchorId(annotationId: string) {
  return annotationId.replace(/[^a-zA-Z0-9]/g, "_");
}
