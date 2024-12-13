import Joyride, {CallBackProps, STATUS, Step, Placement} from 'react-joyride';
import { useEffect, useState } from 'react';
import {useWorkflow} from "./workflow-control";
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


export default function TracePageGuide() {
    const [run, setRun] = useState(true);
    const [isFirstVisit, setIsFirstVisit] = useState(false);
    const [className_event,setClassNameEvent] = useState("undefined");
    // keep requesting until the className of the second event is found, first event is always metadata
    const selector = ".event:nth-child(2)";
    console.log("outside loop", className_event)
    const {isTraceviewComplete} = useWorkflow();
    if(isTraceviewComplete){
        const eventFind = document.querySelector(`.event:not([class*="metadata"]):not([class*="expanded"])`);
        let new_className_event = "."+eventFind?.className.replace(/\s+/g, ".") || ''
        console.log("new_className_event",className_event, new_className_event)
        if (className_event != new_className_event && !new_className_event.includes("undefined")) { 
            console.log("selector", document.querySelector(`.event`))
            // const eventFind = document.querySelector(`.event:not([class*="metadata"]):not([class*="expanded"])`);
            // const eventFind = document.querySelector(`.event[class*="expanded"]:not([class*="metadata"])`);
            // construct the className of the second event
            console.log("eventFind", eventFind)
            setClassNameEvent("."+eventFind?.className.replace(/\s+/g, ".") || '');
            console.log("className_event", className_event)
            const content = eventFind?.querySelector(".content") || null;
            // if(content){
            //     className_event = "."+content.className.replace(/\s+/g, ".") || '';
            //     console.log("content.className", className_event)
            // }
        }
    }

    let steps: Step[] = [
        {
            target: ".sidebar",
            content: "Explore and browse all traces from your dataset.",
            disableBeacon: true,
            placement: 'right',
        },
        {
            target: "button.inline.guide-step-3",
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
        const eventFind = document.querySelector(`.event:not([class*="metadata"]):not([class*="expanded"])`);
        let new_className_event = "."+eventFind?.className.replace(/\s+/g, ".") || ''
        console.log("new_className_event",className_event, new_className_event)
        if (className_event != new_className_event && !new_className_event.includes("undefined")) { 
            console.log("selector", document.querySelector(`.event`))
            // const eventFind = document.querySelector(`.event:not([class*="metadata"]):not([class*="expanded"])`);
            // const eventFind = document.querySelector(`.event[class*="expanded"]:not([class*="metadata"])`);
            // construct the className of the second event
            console.log("eventFind", eventFind)
            setClassNameEvent("."+eventFind?.className.replace(/\s+/g, ".") || '');
            console.log("steps", steps)
            const content = eventFind?.querySelector(".content") || null;
            // if(content){
            //     className_event = "."+content.className.replace(/\s+/g, ".") || '';
            //     console.log("content.className", className_event)
            // }
        }
        }
    }, [isFirstVisit,isTraceviewComplete]);

    const handleJoyrideCallback = (data: CallBackProps) => {
        const { status, type } = data;
        const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];
        console.log("callback status", data)
        if (finishedStatuses.includes(status)) {
          setRun(false);
        }
      };

    return (
        <div>
            isFirstVisit && isTraceviewComplete &&
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
            
        </div>
    ) 
}