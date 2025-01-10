import React from "react";
import ReactDOM from "react-dom/client";
import "./index.scss";
import "./invariant.scss";
import "./App.scss";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { routes } from "./Routes";

import { PostHogProvider } from "posthog-js/react";
import { posthog } from "posthog-js";
import {
  telemetryOptions,
  HAS_CONSENT,
  capture,
  SUPPORTS_TELEMETRY,
} from "./telemetry";

import { install } from "./lib/permalink-navigator";

// create browser router
const router = createBrowserRouter(routes);

// on route change
let last_route = "";
router.subscribe(() => {
  // alert('Route changed to ' + router.state.location.pathname);
  if (last_route !== router.state.location.pathname) {
    last_route = router.state.location.pathname;
    capture("$pageview", {
      path:
        router.state.location.pathname +
        router.state.location.search +
        router.state.location.hash,
    });
  }
});

/** override window.alert to show errors in a nice way without blocking the UI */
window.alert = (message: string) => {
  // if message starts with 'info:', show it as an info message
  let isInfo = message.startsWith("info:");
  if (isInfo) message = message.substring(5);

  // get #alert-error-list element
  const alertErrorList = document.getElementById("alert-error-list");
  // create a li element
  const li = document.createElement("li");

  // set the text of the li element to the message
  li.textContent = message;

  // if it's an info message, add the info class
  if (isInfo) li.classList.add("info");

  // append the li element to the alertErrorList
  alertErrorList?.appendChild(li);
  // add appearance animation
  li.classList.add("appear");

  // after 5 seconds remove the li element
  setTimeout(() => {
    alertErrorList?.removeChild(li);
  }, 5000);
};

install();

ReactDOM.createRoot(document.getElementById("app-root")!).render(
  <React.StrictMode>
    {HAS_CONSENT && SUPPORTS_TELEMETRY ? (
      <PostHogProvider
        apiKey="phc_fG5QwXaLBOPZgtjnHR4UP9kcnLdY2cD1JUwGBw06YjT"
        options={telemetryOptions}
      >
        <RouterProvider router={router} />
      </PostHogProvider>
    ) : (
      <RouterProvider router={router} />
    )}
  </React.StrictMode>,
);
