import posthog from "posthog-js";
import { usePostHog } from "posthog-js/react";
import { config } from "./Config";

export const SUPPORTS_TELEMETRY = config("telemetry");
export const HAS_CONSENT = window.localStorage.getItem("consent") === "true";

export const telemetryOptions: any = {
  api_host: "https://eu.i.posthog.com",
  person_profiles: "always", // or 'always' to create profiles for anonymous users as well
  autocapture: false,
};

export function useTelemetry() {
  if (!HAS_CONSENT || !SUPPORTS_TELEMETRY) {
    return {
      capture: () => {},
      wrap: (fct: Function) => fct,
    };
  }

  const posthog = usePostHog();

  return {
    capture: (event: string, payload: any | null = null) => {
      capture(event, payload);
    },
    wrap: (fct: Function, event: string) => {
      function wrapped() {
        capture(event, arguments);
        return fct(...arguments);
      }
      return wrapped;
    },
    posthog: posthog,
  };
}

export function capture(event: string, payload: any | null = null) {
  if (!HAS_CONSENT || !SUPPORTS_TELEMETRY) {
    return;
  }
  // enable event logging for debugging
  // console.log("[telemetry] captured " + JSON.stringify({'event': event, 'payload': payload}))
  posthog.capture(event, payload);
}

/**
 * Like useTelemetry, but also identifies the user with the given userInfo.
 *
 * Does nothing if the user has not given consent, telemetry is not supported or the provided userInfo is null.
 *
 * Only runs identify once per page load.
 *
 * @param userInfo the user information to identify the user with
 * @returns the telemetry object
 */
export function useTelemetryWithIdentification(
  userInfo: { id: string; username: string } | null,
) {
  const telemetry = useTelemetry();

  if (!userInfo || !HAS_CONSENT || !SUPPORTS_TELEMETRY) {
    return telemetry;
  }

  // make sure this happens only once per page load
  if (window["telemetry_identified"] == true) {
    return telemetry;
  }

  telemetry.posthog?.identify(userInfo.id, {
    username: userInfo.username,
  });
  window["telemetry_identified"] = true;

  return telemetry;
}
