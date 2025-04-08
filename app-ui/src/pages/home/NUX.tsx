import Joyride, { CallBackProps, STATUS, Step, Placement } from "react-joyride";
import { useEffect, useState } from "react";
import { useUserInfo } from "../../utils/UserInfo";
import { config } from "../../utils/Config";
import { NuxStyle } from "../../styles/NuxStyle";

// This function returns the new user guide for the home page
export default function HomePageNUX(props) {
  const userInfo = useUserInfo();

  const [run, setRun] = useState(true);
  const [enableNUX, setEnableNUX] = useState(false);
  const HAS_SEEN_NUX_HOME = "invariant.explorer.disable.guide.home";

  const steps: Step[] = [];

  // Only show guide for dataset box if the user is logged in
  if (userInfo?.loggedIn) {
    steps.push({
      target: ".box.dataset",
      title: "Welcome to Invariant",
      content: "We created a sample project for you to explore.",
      disableBeacon: true,
      placement: "left",
    });
  }
  // Activity box and public dataset only shows up in production
  if (config("instance_name") != "local") {
    steps.push({
      target: ".box.featureddataset",
      title: "Check Out a Public Dataset",
      content: "Explore public datasets from top agent benchmarks.",
      placement: "top",
      disableBeacon: true,
    });
    steps.push({
      target: ".box.activity",
      title: "See What's Happening",
      content: "Once you annotate a trace the activity shows up here.",
      placement: "top",
    });
  }

  useEffect(() => {
    if (!localStorage.getItem(HAS_SEEN_NUX_HOME)) {
      // This code should be deleted after some time
      localStorage.removeItem("firstVisitHomeFlag");
      setEnableNUX(true);
      localStorage.setItem(HAS_SEEN_NUX_HOME, "true");
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
      {enableNUX && config("nux") && (
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
            last: "Finish Tour",
          }}
        ></Joyride>
      )}
    </div>
  );
}
