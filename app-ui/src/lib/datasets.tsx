import React from "react";
import { sharedFetch } from "../SharedFetch";

/** Hook to fetch the list of datasets from the server. */
export function useDatasetList(
  kind: "private" | "public" | "homepage" | "any", // Restrict kind to valid values
  limit: number | null = null,
): [any[] | null, () => void] {
  const [datasets, setDatasets] = React.useState<any[] | null>(null);
  const refresh = React.useCallback(() => {
    const queryParams = new URLSearchParams({
      kind,
      ...(limit !== null && { limit: limit.toString() }),
    }).toString();

    sharedFetch(`/api/v1/dataset/list?${queryParams}`)
      .then((data) => {
        setDatasets(data);
      })
      .catch(() => {
        setDatasets([]);
        alert("Failed to fetch datasets");
      });
  }, [kind, limit]);

  return [datasets, refresh];
}