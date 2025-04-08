import Joyride, { CallBackProps, STATUS, Step } from "react-joyride";
import { useEffect, useState } from "react";
import { config } from "../../utils/Config";
import "../../styles/NUX.scss";
import { NuxStyle } from "../../styles/NuxStyle";

export default function TracePageNUX() {
  const [run, setRun] = useState(true);
  const [enableNux, setEnableNux] = useState(false);
  const [className_event, setClassNameEvent] = useState("undefined");
  const HAS_SEEN_NUX_TRACE_VIEW = "invariant.explorer.disable.guide.trace_view";
  const steps: Step[] = [
    {
      target: ".sidebar",
      title: "Explore Traces",
      content: "Browse the captured agent trajectories in this dataset.",
      placement: "right",
      disableBeacon: true,
    },
    // {
    //   target: "button.inline.nux-step-3",
    //   content:
    //     "Collapse All / Expand All messages in the current trace selected",
    //   placement: "bottom",
    // },
    {
      target: className_event,
      title: "Inspect the Agent's Behavior",
      content: "Inspect the different steps an agent took to reach this state.",
      placement: "top",
    },
    {
      target: ".chat-button.tab",
      title: "Simulate the Agent",
      content:
        "Once you're ready, you can also simulate the agent's behavior to generate more trajectories and see how it behaves in different situations.",
      placement: "bottom",
      locale: { next: "Next", skip: "Skip", back: "Back" },
    },
  ];

  // Add the sharing step if sharing is enabled
  if (config("sharing")) {
    steps.push({
      target: "button.inline.nux-step-4",
      content:
        "Share the trace with a collaborator. The annotations that you left on it are sticky and will follow the trace in their own Explorer view.",
      placement: "bottom",
      locale: { next: "Next", skip: "Skip", back: "Back" },
    });
  }

  useEffect(() => {
    if (!localStorage.getItem(HAS_SEEN_NUX_TRACE_VIEW)) {
      // return the first event that's not test, metadata, but expanded
      // Note the expanded status is contracted, when the event is collapsed it has the class expanded
      const selector = `.event:not([class*="test"]):not([class*="top-level"]):not([class*="analyzer-hint"]):not([class*="metadata"]):not([class*="expanded"]):not([class*="analyzer-output"])`;
      const eventFind = document.querySelector(selector);
      const new_className_event =
        "." + eventFind?.className.replace(/\s+/g, ".") || "";
      if (
        className_event != new_className_event &&
        !new_className_event.includes("undefined")
      ) {
        // build class name as format ".class1.class2.class3"
        const temp_className_event =
          "." + eventFind?.className.replace(/\s+/g, ".") || "";
        setClassNameEvent(temp_className_event);
        // if there is a content, get the class name of the content
        const content = eventFind?.querySelector(".content") || null;
        if (content) {
          setClassNameEvent("." + content.className.replace(/\s+/g, "."));
        }
      }
      // This code should be deleted after some time
      localStorage.removeItem("firstVisitTraceFlag");
      setEnableNux(true);

      localStorage.setItem(HAS_SEEN_NUX_TRACE_VIEW, "true");
    }
  }, []);

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];
    if (finishedStatuses.includes(status)) {
      setRun(false);
    }
  };

  return (
    <>
      {enableNux && config("nux") && (
        <Joyride
          steps={steps}
          run={run}
          continuous={true}
          showProgress={true}
          showSkipButton={true}
          disableScrolling={true}
          styles={NuxStyle}
          callback={handleJoyrideCallback}
          locale={{
            last: "Complete Tour",
          }}
        ></Joyride>
      )}
    </>
  );
}
