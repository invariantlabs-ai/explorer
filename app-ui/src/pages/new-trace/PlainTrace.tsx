import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { TraceView } from "../../lib/traceview/traceview";
import { Base64 } from "js-base64";

/**
 * Screen component for uploading a new snippet (single trace outside of dataset).
 */
export function PlainTrace() {
  const urlParams = new URLSearchParams(window.location.search);
  const traceHash = urlParams.get("trace");
  const trace = traceHash? Base64.decode(traceHash) : "[]";
  const [traceString, setTraceString] = useState(trace);

  return (
      <TraceView
        // the trace string to display in the editor
        inputData={traceString}
        // whether to use the tabbed or side-by-side layout
        sideBySide={false}
        // update the trace string when the user types into the editor
        handleInputChange={(input: string | undefined) =>
          setTraceString(input || "")
        }
        // nothing to highlight/annotate here
        highlights={{}}
        // extra UI to show above the trace view
        header={false}
        title={""}
        traceId="<none>"
        editor={false}
      />
  );
}
