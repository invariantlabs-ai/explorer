import React from 'react'
import { sharedFetch } from '../SharedFetch'

export function useDatasetList(limit: number | null = null): [any[], () => void] {
    const [datasets, setDatasets] = React.useState<any[]>([])

    const refresh = () => {
        sharedFetch('/api/v1/dataset/list?limit=' + (limit || '')).then(data => {
            setDatasets(data)
        }).catch(() => {
            setDatasets([])
            alert('Failed to fetch datasets')
        })
    }

    React.useEffect(() => refresh(), [])

    return [
        datasets,
        refresh
    ]
}