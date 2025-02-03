import React, { useState, useEffect, useCallback } from "react";
import { EntityList } from "../../EntityList";
import { useUserInfo } from "../../UserInfo";
import { BsUpload } from "react-icons/bs";
import { Link, useNavigate } from "react-router-dom";
import { Time } from "../../components/Time";
import { DeleteSnippetModal, useSnippetsList } from "../../lib/snippets";

/**
 * Component to show the list of snippets of the current user.
 */
export function Snippets() {
  // remote call to get the list of snippets
  const [snippets, refreshSnippets] = useSnippetsList();
  // tracks whether we are currently showing a delete modal for a particular snippet (null if none)
  const [selectedSnippetForDelete, setSelectedSnippetForDelete] =
    React.useState(null);
  // currently signed-in user info
  const userInfo = useUserInfo();
  // used to navigate to a new page
  const navigate = useNavigate();

  return (
    <>
      {/* delete snippet modal */}
      {selectedSnippetForDelete && (
        <DeleteSnippetModal
          snippet={selectedSnippetForDelete}
          setSnippet={setSelectedSnippetForDelete}
          onSuccess={refreshSnippets}
        />
      )}
      <EntityList
        title="Snippets"
        actions={
          <>
            {userInfo?.loggedIn && (
              <button className="primary" onClick={() => navigate("/new")}>
                <BsUpload />
                Upload Trace
              </button>
            )}
          </>
        }
      >
        {!snippets ? (
          <div className="empty">Loading snippets...</div>
        ) : (
          snippets.map((snippet, i) => (
            <Link className="item" to={`/trace/${snippet.id}`} key={i}>
              <li>
                <h3>
                  Snippet{" "}
                  <span className="traceid">#{snippet.id.slice(0, 6)}</span>
                </h3>
                <span className="description">
                  <Time>{snippet.time_created}</Time>
                </span>
                <div className="spacer" />
              </li>
            </Link>
          ))
        )}
        {snippets && snippets.length === 0 && (
          <div className="empty">No snippets</div>
        )}
      </EntityList>
    </>
  );
}

/**
 * Compact version of the snippet list (e.g. to use on the home page).
 */
export function CompactSnippetList(props) {
  // remote call to get the list of snippets
  const [snippets, refreshSnippets] = useSnippetsList(props.limit || null);

  return (
    <>
      <EntityList>
        {snippets === null ? (
          <div className="empty">Loading snippets...</div>
        ) : (
          snippets.map((snippet, i) => (
            <Link className="item" to={`/trace/${snippet.id}`} key={i}>
              <li>
                <h3>
                  {props.icon} Snippet{" "}
                  <span className="traceid">#{snippet.id.slice(0, 6)}</span>
                </h3>
                <span className="description">
                  <Time>{snippet.time_created}</Time>
                </span>
              </li>
            </Link>
          ))
        )}
        {snippets !== null && snippets.length === 0 && (
          <div className="empty">No snippets</div>
        )}
      </EntityList>
    </>
  );
}
