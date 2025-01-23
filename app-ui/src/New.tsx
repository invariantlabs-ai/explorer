import { useState, useEffect } from "react";
import { TraceView } from "./lib/traceview/traceview";

const CONTENT = `[
  {
    "role": "assistant",
    "content": "Hello, how can I help you today?"
  }
]`;

function postTrace(trace: string) {
  return fetch("/api/v1/trace/snippets/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: JSON.parse(trace),
      extra_metadata: {},
    }),
  }).then((res) => {
    if (!res.ok) {
      throw new Error("Failed to post trace");
    }
    return res.json();
  });
}

/**
 * Screen component for uploading a new snippet (single trace outside of dataset).
 */
export function New() {
  const [traceString, setTraceString] = useState(CONTENT);
  const [sideBySide, setSideBySide] = useState(true);

  // observe window and switch to side by side if window is wide enough
  useEffect(() => {
    const handleResize = () => {
      setSideBySide(window.innerWidth > 1000);
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const onPostTrace = () => {
    postTrace(traceString)
      .then((response: any) => {
        if (response.id) {
          window.location.href = `/trace/${response.id}`;
        } else {
          throw new Error("Failed to post trace");
        }
      })
      .catch((err) => {
        alert("Failed to post trace");
      });
  };

  // show Upload button in header
  const header = (
    <>
      <div className="spacer"></div>
      <button className="primary" onClick={() => onPostTrace()}>
        Upload
      </button>
    </>
  );

  return (
    <div className="panel fullscreen app new">
      {/* uses a standard trace view which includes a side-by-side of an editor and the rendered view */}
      <TraceView
        // the trace string to display in the editor
        inputData={traceString}
        // whether to use the tabbed or side-by-side layout
        sideBySide={sideBySide}
        // update the trace string when the user types into the editor
        handleInputChange={(input: string | undefined) =>
          setTraceString(input || "")
        }
        // nothing to highlight/annotate here
        highlights={{}}
        // extra UI to show above the trace view
        header={header}
        title={"Upload Trace"}
        traceId="<new>"
      />
    </div>
  );
}
