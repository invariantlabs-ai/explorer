import React from "react";
import { Modal } from "../components/Modal";
import { sharedFetch } from "../service/SharedFetch";
import { useUserInfo } from "../utils/UserInfo";

/**
 * Calls the Delete Trace endpoint to delete a trace.
 */
export function traceDelete(id: string): Promise<Response> {
  return fetch(`/api/v1/trace/${id}`, {
    method: "DELETE",
  });
}

/**
 * Modal content to show when deleting a snippet or trace.
 */
export function DeleteSnippetModalContent(props: {
  snippet: any;
  onClose: () => void;
  onSuccess?: () => void;
  entityName: string;
}) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const id = props.snippet.id;

  const onDelete = () => {
    setLoading(true);
    traceDelete(id).then((response) => {
      if (response.ok) {
        setLoading(false);
        if (props.onSuccess) props.onSuccess();
        props.onClose();
      } else {
        response
          .json()
          .then((data) => {
            setLoading(false);
            setError(
              data.detail || "An unknown error occurred, please try again.",
            );
          })
          .catch(() => {
            setLoading(false);
            setError("An unknown error occurred, please try again.");
          });
      }
    });
  };

  return (
    <div className="form">
      <h2>
        Are you sure you want to delete this {props.entityName}?<br />
        <br />
        Note that this action is irreversible. All associated data and
        annotations will be lost.
      </h2>
      {error ? <span className="error">{error}</span> : <br />}
      <button className="danger" disabled={loading} onClick={onDelete}>
        {loading ? "Deleting..." : "Delete"}
      </button>
    </div>
  );
}

/**
 * Modal to confirm deletion of a snippet or trace.
 */
export function DeleteSnippetModal(props: {
  snippet: any;
  setSnippet: (snippet: any) => void;
  onSuccess?: () => void;
  entityName?: string;
}) {
  const capitalized =
    (props.entityName || "snippet").charAt(0).toUpperCase() +
    (props.entityName || "snippet").slice(1);
  return (
    <Modal
      title={"Delete " + capitalized}
      onClose={() => props.setSnippet(null)}
      hasWindowControls
    >
      <DeleteSnippetModalContent
        snippet={props.snippet}
        onClose={() => props.setSnippet(null)}
        onSuccess={props.onSuccess}
        entityName={props.entityName || "snippet"}
      />
    </Modal>
  );
}

/**
 * Fetches the list of snippets for the current user.
 */
export function useSnippetsList(
  limit: number | null = null,
): [any[] | null, () => void] {
  const [snippets, setSnippets] = React.useState<any[] | null>(null);
  const userInfo = useUserInfo();

  // fetch the list of snippets from the server
  const refresh = () => {
    sharedFetch("/api/v1/trace/snippets?limit=" + (limit || ""))
      .then((response) => {
        setSnippets(response);
      })
      .catch(() => {
        setSnippets([]);
        alert("Failed to fetch user snippets");
      });
  };

  // refresh the list of snippets when the user logs in
  React.useEffect(() => {
    if (userInfo?.loggedIn) {
      refresh();
    }
  }, [userInfo]);

  return [snippets, refresh];
}
