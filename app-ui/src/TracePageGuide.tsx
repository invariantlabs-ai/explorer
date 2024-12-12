import Joyride, {CallBackProps, STATUS, Step, Placement} from 'react-joyride';
import { useEffect, useState } from 'react';

const defaultOptions = {
    options: {
        arrowColor: '#fff',
        backgroundColor: '#fff',
        beaconSize: 36,
        overlayColor: 'rgba(0, 0, 0, 0.5)',
        primaryColor: '#8b89f7',
        textColor: '#000',
        zIndex: 100,
        Cursor: 'None',
    }
  };

//   The variable is declared in the global scope so that once the className of the second event is found no more requests are made
let className_event = "undefined";

export default function TracePageGuide() {
    const [run, setRun] = useState(true);
    const [isFirstVisit, setIsFirstVisit] = useState(false);

    // keep requesting until the className of the second event is found, first event is always metadata
    const selector = ".event:nth-child(2)";
    if (! className_event.includes("event")){ 
        const eventFind = document.querySelector(selector)
        // construct the className of the second event
        className_event = "."+eventFind?.className.replace(/\s+/g, ".") || '';
        const content = eventFind?.querySelector(".content") || null;
        if(content){
            className_event = "."+content.className.replace(/\s+/g, ".") || '';
        }
    }

    const steps: Step[] = [
        {
            target: ".sidebar",
            content: "Explore and browse all traces from your dataset.",
            disableBeacon: true,
            placement: 'right',
        },
        {
            target: ".toolbar button",
            content: "Collapse All / Expand All messages in the current trace selected",
            placement: 'bottom',
            locale: { next: 'Next', skip: 'Skip', back: 'Back' },
        },
        {
            target: className_event,
            content: "Click on any line inside a message to add an annotation.",
            placement: 'top',
    
        },
        {
            target: "button.inline.guide-step-4",
            content: "Share the trace with a collaborator. The annotations that you left on it are sticky and will follow the trace in their own Explorer view.",
            placement: 'bottom',
            locale: { next: 'Next', skip: 'Skip', back: 'Back' },
        },
    ]

    useEffect(() => {
        const firstVisitTraceFlag = localStorage.getItem('firstVisitTraceFlag');
        if (!firstVisitTraceFlag || firstVisitTraceFlag === 'true') {
            setIsFirstVisit(true);
            localStorage.setItem('firstVisitTraceFlag', 'false');
        }
    }, []);

    const handleJoyrideCallback = (data: CallBackProps) => {
        const { status, type } = data;
        const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];
        if (finishedStatuses.includes(status)) {
          setRun(false);
        }
      };

    return (
        <div>
            {isFirstVisit &&
                <Joyride
                    steps={steps}
                    run={run}
                    continuous={true}
                    showProgress={true}
                    showSkipButton={true}
                    disableScrolling={true}
                    styles = {defaultOptions}
                    callback={handleJoyrideCallback}
                    >
                </Joyride>
            }
        </div>
    ) 
}