import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Link } from "react-router-dom";

window["promptSignup"] = function (action: string) {
  // nothing by default
};

export function alertSignup(action: string) {
  window["promptSignup"](action);
}

/**
 * A modal that is shown whenever a user action requires a sign-up.
 *
 * Use `alertSignup` to trigger this modal from anywhere in the app.
 */
export function SignUpModal() {
  const [action, setAction] = useState(null as string | null);

  useEffect(() => {
    window["promptSignup"] = setAction;
    return () => {
      window["promptSignup"] = function () {
        // nothing by default
      };
    };
  }, []);

  if (!action) {
    return null;
  }

  return (
    <Modal>
      <div className="form">
        <h1>Sign Up for Explorer</h1>
        To {action} you need to sign up for an account.
        <br />
        <br />
        <Link
          reloadDocument
          to={"/login"}
          className="button primary"
          style={{ lineHeight: "35pt" }}
          onClick={() => setAction(null)}
        >
          Sign Up
        </Link>
        <button onClick={() => setAction(null)}>Cancel</button>
      </div>
    </Modal>
  );
}
