import { useEffect, useState } from "react";
import { Modal } from "../../Modal";

window["promptModelAccess"] = function (action: string) {
  // nothing by default
};

export function alertModelAccess(action: string) {
  window["promptModelAccess"](action);
}

export function ModelAccessModal() {
  const [action, setAction] = useState(null as string | null);

  useEffect(() => {
    window["promptModelAccess"] = setAction;
    return () => {
      window["promptModelAccess"] = function () {
        // nothing by default
      };
    };
  }, []);

  if (!action) {
    return null;
  }

  return (
    <Modal>
      <div className="form analysis">
        <h1 className="big">Analysis Models</h1>
        <p>
          Invariant builds reward and analysis models for agentic applications,
          helping you understand and optimize your agent systems.
        </p>
        <p>
          Contact us to join the exclusive preview program for our analysis
          models and get access to our latest research.
        </p>
        <a href="mailto:model@invariantlabs.ai" className="button primary">
          Contact Us for Access
        </a>
        <button onClick={() => setAction(null)}>Dismiss</button>
      </div>
    </Modal>
  );
}
