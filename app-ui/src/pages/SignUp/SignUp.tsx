import React, { useState, useEffect } from "react";
import { useTelemetry } from "../../telemetry";

/**
 * Simple screen component for user sign up.
 */
export function SignUp() {
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const telemetry = useTelemetry();

  // on effect, log connected with SSO
  useEffect(() => {
    telemetry.capture("signed-up");
  }, []);

  // calls signup endpoint for the current user
  const onSignUp = () => {
    setIsLoading(true);

    fetch("/api/v1/user/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agree: true,
      }),
    })
      .then((response) => {
        setIsLoading(false);
        telemetry.capture("accepted-terms");

        if (response.status === 200) {
          window.location.href = "/";
        } else {
          setError("Failed to sign up");
        }
      })
      .catch((error) => {
        setIsLoading(false);
        setError("Failed to sign up");
      });
  };

  return (
    <div className="panel fullscreen app">
      <div className="signup">
        <h2>Sign Up for Explorer</h2>
        <p>
          By signing up, you agree to our{" "}
          <a
            href="https://invariantlabs.ai/privacy-policy"
            target="_blank"
            rel="noreferrer"
          >
            Privacy Policy
          </a>{" "}
          and{" "}
          <a
            href="https://invariantlabs.ai/terms-and-conditions"
            target="_blank"
            rel="noreferrer"
          >
            Terms of Service
          </a>
          .<br />
          <br />
          Please note that this is an early preview of this application and that
          we may store your data for research purposes.
        </p>
        {error && <div className="error">Error: {error}</div>}
        <div className="signup-actions">
          <a href="/logout" className="button secondary">
            Cancel
          </a>
          <button className="primary" onClick={onSignUp}>
            Agree and Continue
          </button>
        </div>
      </div>
    </div>
  );
}
