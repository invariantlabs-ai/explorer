import React from 'react'
import { sharedFetch } from '../SharedFetch'

/** Hook to fetch the list of datasets from the server. */
export function useDatasetList(
    kind: 'private' | 'public' | 'homepage' | 'any', // Restrict kind to valid values
    limit: number | null = null
): [any[], () => void] {
        const [datasets, setDatasets] = React.useState<any[]>([])
    const refresh = () => {
        // Build the query string with kind and limit
        const queryParams = new URLSearchParams({
            kind: kind, // Required parameter
            ...(limit !== null && { limit: limit.toString() }) // Optional parameter
        }).toString();

        // Fetch from the backend using the constructed query string
        sharedFetch(`/api/v1/dataset/list?${queryParams}`)
            .then((data) => {
                setDatasets(data);
            })
            .catch(() => {
                setDatasets([]);
                alert('Failed to fetch datasets');
            });
    }

    React.useEffect(() => refresh(), [])

    return [
        datasets,
        refresh
    ]
}