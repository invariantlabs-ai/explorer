import React, { useCallback, useEffect, useRef } from "react";
import { useUserInfo } from "../utils/UserInfo";
import useWindowSize from "../lib/size";

/**
 * Layout for embeds (iframes).
 *
 * @param props.children The main content of the page.
 */
function Embed(props: {
  children: React.ReactNode;
}) {

  const { height } = useWindowSize();
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id") || "";
    window.parent.postMessage({ type: 'resize', height, id}, "*");
  }, [height])

  return (
    <>
      <div className="fullscreen app plain embed">
        {props.children}
      </div>
    </>
  );
}

export default Embed;
