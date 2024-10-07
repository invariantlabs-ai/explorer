import { useState } from "react";
import { Modal } from "../Modal";

/**
 * Shows a clickable "PREVIEW" badge that opens a modal dialog explaining the user is browsing a preview deployment.
 * 
 * Shows nothing if the VITE_PREVIEW environment variable is not set to '1' (e.g. in local dev or production).
 */
export function DeploymentInfo() {
    const [userPopoverVisible, setUserPopoverVisible] = useState(false);

    if (import.meta.env.VITE_PREVIEW != '1') {
        return null;
    }

    return <>
        <div className="deployment-info" onClick={() => setUserPopoverVisible(true)}>PREVIEW</div>
        {userPopoverVisible && <Modal title="Preview Deployment" open={true} onClose={() => setUserPopoverVisible(false)}>
            <div className="form">
                <p>
                    You are browsing a preview deployment of this application.<br/><br/>
                    All changes made here will be lost on the next deployment.
                </p><br/>
                <button className='primary' onClick={() => setUserPopoverVisible(false)}>Close</button>
            </div>
        </Modal>}
    </>
}