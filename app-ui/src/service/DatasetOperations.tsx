import React from "react";
import { sharedFetch } from "./SharedFetch";

/** Hook to fetch the list of datasets from the server. */
export function useDatasetList(
  kind: "private" | "public" | "homepage" | "any",
  limit: number | null = null,
  query: string = ""
): [any[] | null, () => void] {
  const [datasets, setDatasets] = React.useState<any[] | null>(null);
  const refresh = React.useCallback(() => {
    const queryParams = new URLSearchParams({
      kind,
      ...(limit !== null && { limit: limit.toString() }),
      ...(query && { q: query }),
    }).toString();

    sharedFetch(`/api/v1/dataset/list?${queryParams}`)
      .then((data) => {
        setDatasets(data);
      })
      .catch(() => {
        setDatasets([]);
        alert("Failed to fetch datasets");
      });
  }, [kind, limit, query]);

  return [datasets, refresh];
}

/**
 * Creates a new dataset with the given name, with no data.
 */
export function createDataset(name: string, isPublic: boolean = false) {
  const promise = new Promise((resolve, reject) => {
    fetch("/api/v1/dataset/create", {
      method: "POST",
      body: JSON.stringify({
        name: name,
        is_public: isPublic,
      }),
    })
      .then((response) => {
        if (response.ok) {
          resolve({ success: true });
        } else {
          response
            .json()
            .then((data) => {
              reject(data);
            })
            .catch(() => {
              reject({ error: "Unknown error" });
            });
        }
      })
      .catch(() => {
        reject({ error: "Network error" });
      });
  });

  return promise;
}

/**
 * Uploads a new dataset to the current user's account.
 */
export function uploadDataset(
  name: string,
  file: File,
  isPublic: boolean = false
) {
  const promise = new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("file", file);
    formData.append("is_public", isPublic.toString());

    fetch("/api/v1/dataset/upload", {
      method: "POST",
      body: formData,
    })
      .then((response) => {
        if (response.ok) {
          resolve({ success: true });
        } else {
          response
            .json()
            .then((data) => {
              reject(data);
            })
            .catch(() => {
              reject({ error: "Unknown error" });
            });
        }
      })
      .catch(() => {
        reject({ error: "Network error" });
      });
  });

  return promise;
}
