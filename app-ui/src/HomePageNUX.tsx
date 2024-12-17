import Joyride, { CallBackProps, STATUS, Step, Placement } from "react-joyride";
import { useEffect, useState } from "react";
import { useUserInfo } from "./UserInfo";
import { config } from "./Config";

const defaultOptions = {
  options: {
    arrowColor: "#fff",
    backgroundColor: "#fff",
    beaconSize: 36,
    overlayColor: "rgba(0, 0, 0, 0.5)",
    primaryColor: "#8b89f7",
    textColor: "#000",
    zIndex: 100,
  },
  buttonBase: {
    Cursor: "None",
  },
};

// This function returns the new user guide for the home page
export default function HomePageNUX(props) {
  const userInfo = useUserInfo();

  const [run, setRun] = useState(true);
  const [enableNUX, setEnableNUX] = useState(false);
  const HAS_SEEN_NUX_HOME = "invariant.explorer.enable.guide.home";

  const steps: Step[] = [];

  // Only show guide for dataset box if the user is logged in
  if (userInfo?.loggedIn) {
    steps.push({
      target: ".box.dataset",
      content: "We created a sample dataset for you to explore.",
      disableBeacon: true,
      placement: "left",
    });
  }
  // Activity box and public dataset only shows up in production
  if (config("instance_name") == "prod") {
    steps.push(
      {
        target: ".box.featureddataset",
        content: "Explore public datasets from top agent benchmarks.",
        placement: "top",
        disableBeacon: true,
        locale: { next: "Next", skip: "Skip", back: "Back" },
      }
    );
    steps.push({
      target: ".box.activity",
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
          styles={defaultOptions}
          callback={handleJoyrideCallback}
        ></Joyride>
      )}
    </div>
  );
}
