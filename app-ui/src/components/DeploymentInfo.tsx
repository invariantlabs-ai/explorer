import { useState } from "react";
import { Modal } from "../Modal";
import { config } from "../Config";
import { BsLockFill } from "react-icons/bs";

const DEPLOYMENT_COLORS = {
  local: "#f0ad4e",
  preview: "auto",
  replit: "#ed4f01",
};

export function DeploymentName() {
  const isPrivateInstance = config("private");
  let name = config("instance_name");
  if (name == "prod") {
    return <></>;
  }
  return (
    <div
      className="deployment-info"
      style={{ backgroundColor: DEPLOYMENT_COLORS[name] }}
    >
      {isPrivateInstance && <BsLockFill />}
      {name.toUpperCase()}
    </div>
  );
}

/**
 * Shows a clickable "PREVIEW" badge that opens a modal dialog explaining the user is browsing a preview deployment.
 *
 * Shows nothing if the VITE_PREVIEW environment variable is not set to '1' (e.g. in local dev or production).
 */
export function DeploymentInfo() {
  const [userPopoverVisible, setUserPopoverVisible] = useState(false);

  if (import.meta.env.VITE_PREVIEW != "1") {
    return <DeploymentName />;
  }

  return (
    <>
      <div
        className="deployment-info"
        onClick={() => setUserPopoverVisible(true)}
      >
        PREVIEW
      </div>
      {userPopoverVisible && (
        <Modal
          title="Preview Deployment"
          open={true}
          onClose={() => setUserPopoverVisible(false)}
        >
          <div className="form">
            <p>
              You are browsing a preview deployment of this application.
              <br />
              <br />
              All changes made here will be lost on the next deployment.
            </p>
            <br />
            <button
              className="primary"
              onClick={() => setUserPopoverVisible(false)}
            >
              Close
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function DeploymentCommit() {
  if (import.meta.env.VITE_GIT_COMMIT) {
    return (
      <span className="deployment-commit">
        {import.meta.env.VITE_GIT_COMMIT.slice(0, 7)}
      </span>
    );
  }

  return <span className="deployment-commit">dev</span>;
}
