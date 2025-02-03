import React, { useEffect } from "react";
import { sharedFetch } from "../service/SharedFetch";
import {
  HAS_CONSENT,
  SUPPORTS_TELEMETRY,
  useTelemetryWithIdentification,
} from "./telemetry";

export interface UserInfo {
  id: string;
  username: string;
  name: string;
  email: string;
  loggedIn?: boolean;
  image_url_hash?: string;
  signedUp?: boolean;
}

const ANON = {
  id: "<anonymous>",
  username: "",
  name: "Not Logged In",
  email: "",
  loggedIn: false,
  image_url_hash: "",
  signedUp: false,
};

let USER_INFO_CACHE = {
  lastFetch: 0,
  data: null,
};

export function useUserInfo(cached = true): UserInfo | null {
  const [userInfo, setUserInfo] = React.useState(null as UserInfo | null);
  const telemetry = useTelemetryWithIdentification(userInfo);

  React.useEffect(() => {
    // check if there is a cached value not older than 5 minutes
    if (
      cached == true &&
      USER_INFO_CACHE.data != null &&
      Date.now() - USER_INFO_CACHE.lastFetch < 300000
    ) {
      setUserInfo(USER_INFO_CACHE.data);
      return;
    }

    sharedFetch("/api/v1/user/info")
      .then((data) => {
        if (data.id == null) {
          setUserInfo(ANON);
        } else
          var info = {
            ...data,
            loggedIn: true,
          };
        setUserInfo(info);
        USER_INFO_CACHE = {
          lastFetch: Date.now(),
          data: info,
        };
      })
      .catch(() => setUserInfo(ANON));
  }, []);

  // once logged in, identify the user in posthog
  useEffect(() => {
    // first make sure we set 'consent' in localStorage
    if (!HAS_CONSENT && userInfo?.loggedIn && SUPPORTS_TELEMETRY) {
      window.localStorage.setItem("consent", "true");
      // reload
      window.location.reload();
    }
  }, [userInfo?.id]);

  return userInfo;
}
