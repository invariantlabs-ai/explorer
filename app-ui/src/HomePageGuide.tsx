import Joyride, {CallBackProps, STATUS, Step, Placement} from 'react-joyride';
import { useEffect, useState } from 'react';
import { useUserInfo } from './UserInfo';
import { config } from './Config';

const defaultOptions = {
    options: {
        arrowColor: '#fff',
        backgroundColor: '#fff',
        beaconSize: 36,
        overlayColor: 'rgba(0, 0, 0, 0.5)',
        primaryColor: '#8b89f7',
        textColor: '#000',
        zIndex: 100,
    },
    buttonBase:{
        Cursor: 'None',
    }
  };

// This function returns the new user guide for the home page
export default function HomePageGuide(props) {

    const userInfo = useUserInfo()

    const [run, setRun] = useState(true);
    const [isFirstVisit, setIsFirstVisit] = useState(false);

    const steps: Step[] = [
        {
            target: ".box.featureddataset",
            content: "Explore public datasets from top agent benchmarks.",
            placement: 'top',
            locale: { next: 'Next', skip: 'Skip', back: 'Back' },
        },
        {
            target: ".box.activity",
            content: "Once you annotate a trace the activity shows up here.",
            placement: 'top',
    
        },
    ]

    // Only show guide for dataset box if the user is logged in
    if(userInfo?.loggedIn){
        steps.unshift(
            {
                target: ".box.dataset",
                content: "We created a sample dataset for you to explore.",
                disableBeacon: true,
                placement: 'left',
            }
        )
    }

    useEffect(() => {
        const firstVisitHomeFlag = localStorage.getItem('firstVisitHomeFlag');
        console.log("firstVisitHomeFlag",firstVisitHomeFlag);
        if (!firstVisitHomeFlag || firstVisitHomeFlag === 'true') {
            setIsFirstVisit(true);
            localStorage.setItem('firstVisitHomeFlag', 'false');
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
            {isFirstVisit && config('nux') && 
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