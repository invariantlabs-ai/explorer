import React, { useCallback, useEffect, useRef } from "react";
import { Tooltip } from "react-tooltip";

import logo from "./assets/invariant.svg";
import { useUserInfo } from "./UserInfo";
import UserIcon from "./lib/UserIcon";
import { Link, useNavigate } from "react-router-dom";
import {
  BsCodeSlash,
  BsDatabase,
  BsGear,
  BsHouse,
  BsList,
  BsPerson,
  BsUpload,
  BsX,
} from "react-icons/bs";
import { useDatasetList } from "./lib/datasets";
import { CompactSnippetList } from "./Snippets";
import { DatasetLinkList } from "./pages/User/DatasetList";
import { SignUp } from "./SignUp";
import { DeploymentCommit, DeploymentInfo } from "./components/DeploymentInfo";
import { config } from "./Config";
import { ConsentBanner, RevokeConsent } from "./ConsentBanner";
import { SignUpModal } from "./SignUpModal";

/**
 * Hook to manage a state that transitions between two states with a delay (for animations via CSS classes).
 */
function useAnimatedClassState(initialState: boolean) {
  // delayed state
  const [state, _setState] = React.useState(initialState);
  // immediate state
  const [immState, setImmState] = React.useState(initialState);

  const setState = useCallback(
    (newState: boolean) => {
      // cannot change state during transition
      if (state !== immState) {
        return;
      }
      if (newState) {
        // setting true is immediate
        setImmState(true);
        setTimeout(() => {
          _setState(true);
        }, 100);
      } else {
        setImmState(false);
        // setting false is delayed to allow for off animation
        setTimeout(() => {
          _setState(false);
        }, 100);
      }
    },
    [state, immState],
  );

  if (state) {
    return [state, immState, setState] as const;
  } else {
    return [immState, state, setState] as const;
  }
}

/**
 * Content of the site-wide sidebar (navigation, user info, etc).
 */
function SidebarContent(props: {
  userInfo?: any;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const { userInfo, sidebarOpen, setSidebarOpen } = props;

  const [datasets, refresh] = useDatasetList("private", 4);

  useEffect(() => {
    if (userInfo?.loggedIn) {
      refresh();
    }
  }, [userInfo?.loggedIn, refresh]);

  return (
    <div className={"sidebar " + (sidebarOpen ? "open" : "")}>
      <div
        className="sidebar-background"
        onClick={() => setSidebarOpen(false)}
      />
      <ul
        className="sidebar-content"
        onClick={(e) => setTimeout(() => setSidebarOpen(false), 0)}
      >
        <button className="top close" onClick={() => setSidebarOpen(false)}>
          <BsX />
        </button>
        {props.children}
        {userInfo?.loggedIn && (
          <>
            <h2>
              <Link to={`/u/${userInfo.username}`}>Recent Datasets</Link>
            </h2>
            <DatasetLinkList datasets={datasets} />
            <h2>
              <Link to="/snippets">Recent Snippets</Link>
            </h2>
            <CompactSnippetList limit={4} />
            <h2></h2>
          </>
        )}
        {/* unicode copyright */}
        <p className="secondary">
          &copy; 2025 Invariant Labs <DeploymentCommit />
        </p>
        <p className="footer-links">
          <a href="https://invariantlabs.ai" target="_blank">
            About
          </a>
          <a href="/terms" target="_blank">
            Terms of Use
          </a>
          <RevokeConsent />
        </p>
      </ul>
    </div>
  );
}

/**
 * Site-wide sidebar (navigation, user info, etc), wraps around the main screen components to provide a consistent layout
 * like the header and sidebar.
 */
function Sidebar(props) {
  const [sidebarDomIncluded, sidebarOpen, setSidebarOpen] =
    useAnimatedClassState(false);
  const userInfo = useUserInfo();

  // on open, register escape key listener
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = "hidden";
      window.scrollTo(0, 0);

      const listener = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setSidebarOpen(false);
        }
      };
      document.addEventListener("keydown", listener);
      return () => document.removeEventListener("keydown", listener);
    } else {
      document.body.style.overflow = "auto";
    }
  }, [sidebarOpen, setSidebarOpen]);

  return (
    <>
      <button className="top" onClick={() => setSidebarOpen(!sidebarOpen)}>
        <BsList />
      </button>
      {sidebarDomIncluded && (
        <SidebarContent
          userInfo={userInfo}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
        >
          {props.children}
        </SidebarContent>
      )}
    </>
  );
}

/**
 * Site-wide layout (header, sidebar, content).
 *
 * @param props.children The main content of the page.
 * @param props.fullscreen Whether the content should take up the full screen width.
 * @param props.needsLogin Whether the page requires the user to be logged in. If you
 *                         specify 'false', the page will never require login. If you
 *                         specify 'true', the page will always require login. If you
 *                         don't specify, the page will require login if the instance is private.
 *                         This is not a security feature, as the API will still enforce
 *                         permissions, but it is a convenience feature to prevent users
 *                         from seeing empty UI for inaccessible content.
 * @param props.withTabs Whether the content has a separate set of tabs.
 */
function Layout(props: {
  children: React.ReactNode;
  fullscreen?: boolean;
  needsLogin?: boolean;
  withTabs?: boolean;
}) {
  const userInfo = useUserInfo();
  const [userPopoverVisible, setUserPopoverVisible] = React.useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null); // Create a reference to the dropdown
  const navigate = useNavigate();

  const isPrivateInstance = config("private");
  const needsLoginNotSet = typeof props.needsLogin === "undefined";
  const pageRequiresLogin =
    props.needsLogin || (needsLoginNotSet && isPrivateInstance);
  const userIsLoggedIn = userInfo && userInfo.loggedIn;

  const pageShouldRedirectToSignup =
    userInfo && userInfo?.loggedIn && !userInfo?.signedUp;
  const pageShouldRedirectToLogin = pageRequiresLogin && !userIsLoggedIn;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setUserPopoverVisible(false); // Close the dropdown if clicked outside
      }
    };

    // Add event listener for clicks
    document.addEventListener("click", handleClickOutside);

    // Cleanup the event listener on component unmount
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, []);

  return (
    <>
      <header className="top">
        <Sidebar>
          <li className="logo">
            <h1>
              <img src={logo} alt="Invariant logo" className="logo" />
              Invariant Explorer
            </h1>
          </li>
          {!userInfo?.loggedIn && (
            <>
              <li>
                <a href="/login">
                  <BsPerson />
                  Sign In
                </a>
              </li>
            </>
          )}
          <li>
            <a href="/">
              <BsHouse />
              Home
            </a>
          </li>
          {userInfo?.loggedIn && (
            <>
              <li>
                <a href={`/u/${userInfo.username}`}>
                  <BsDatabase />
                  Datasets
                </a>
              </li>
              <li>
                <a href="/snippets">
                  <BsCodeSlash />
                  Snippets
                </a>
              </li>
              <li>
                <a href="/settings">
                  <BsGear />
                  Settings
                </a>
              </li>
            </>
          )}
        </Sidebar>
        <h1
          onClick={() => navigate("/")}
          className="title"
          title="Invariant Explorer"
        >
          <img
            src={logo}
            alt="Invariant logo"
            className="logo"
            onClick={() => navigate("/")}
          />
          Invariant Explorer
        </h1>
        <DeploymentInfo />
        <div className="spacer" />
        {!userInfo?.loggedIn && (
          <button
            className="inline"
            onClick={() => (window.location.href = "/login")}
          >
            Sign In
          </button>
        )}
        <div
          ref={dropdownRef}
          className={"user-info " + (userPopoverVisible ? "open" : "")}
          onClick={() => setUserPopoverVisible(!userPopoverVisible)}
        >
          {userInfo?.loggedIn && (
            <>
              <UserIcon username={userInfo?.username} />
              {userInfo ? <p>{userInfo?.username}</p> : <p>Loading...</p>}
              <div className="popover">
                <ul>
                  <li className="disabled">{userInfo?.email}</li>
                  <li>
                    <a href="/settings">Account</a>
                  </li>
                  <li>
                    <a
                      target="_blank"
                      href="https://explorer.invariantlabs.ai/docs"
                    >
                      Documentation
                    </a>
                  </li>
                  {config("instance_name") != "local" && (
                    <li>
                      <a href="/logout">Log Out</a>
                    </li>
                  )}
                </ul>
              </div>
            </>
          )}
        </div>
      </header>
      <div
        className={
          "content " +
          (props.fullscreen ? "fullscreen" : "") +
          (props.withTabs ? " with-tabs" : "")
        }
      >
        {pageShouldRedirectToLogin && (
          <div className="empty">
            <p>Please sign in to view this page.</p>
          </div>
        )}
        {pageShouldRedirectToSignup && <SignUp />}
        {!pageShouldRedirectToSignup &&
          !pageShouldRedirectToLogin &&
          props.children}
      </div>
      <ConsentBanner />
      <SignUpModal />
      <Tooltip id="button-tooltip" place="bottom" />
    </>
  );
}

export default Layout;
