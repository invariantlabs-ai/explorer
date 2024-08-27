import React from 'react'
import { sharedFetch } from '../SharedFetch'

export function useDatasetList(): [any[], () => void] {
    const [datasets, setDatasets] = React.useState<any[]>([])

    const refresh = () => {
        sharedFetch('/api/v1/dataset/list').then(data => {
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