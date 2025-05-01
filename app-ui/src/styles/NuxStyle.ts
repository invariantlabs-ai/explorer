import { Styles } from "react-joyride";

export const NuxStyle: Partial<Styles> | any = {
    options: {
      arrowColor: "#fff",
      backgroundColor: "#fff",
      beaconSize: 36,
      overlayColor: "rgba(0, 0, 0, 0.5)",
      primaryColor: "#3a3e60",
      textAlign: "left",
      textColor: "#000",
      zIndex: 100,
      Cursor: "None",
    },
    tooltip: {
      borderRadius: 25,
    },
    tooltipTitle: {
      margin: "0px 0px 10px 0px",
      padding: "10px",
      marginTop: "5px",
      lineHeight: "1.0",
      height: "auto",
      textAlign: "left",
      fontWeight: "bold",
      fontSize: "16px",
    },
    tooltipContent: {
      textAlign: "left",
      fontWeight: "normal",
      marginTop: "-20px",
      marginBottom: "-20px",
    },
    buttonNext: {
      borderRadius: 30,
      fontSize: 14,
      padding: "2px 20px",
    },
    buttonBack: {
      borderRadius: 30,
      fontSize: 14,
      padding: "2px 20px",
    },
  };