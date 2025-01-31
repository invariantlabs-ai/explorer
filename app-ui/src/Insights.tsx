import {useEffect, useState} from 'react'
import { Link } from 'react-router-dom'
import { Time } from './components/Time'

function useJSONParse<T>(json: string | null): T | null {
    const [data, setData] = useState<T | null>(null)
    useEffect(() => {
        if (json) {
            try {
                setData(JSON.parse(json))
            }
            catch(e) {
                console.error('Failed to parse JSON', e)
            }
        }
    }, [json])
    return data
}

interface ReportFormat {
    last_updated?: string
}

export function Insights(props: {dataset: any, datasetLoadingError: any, username: string, datasetname: string}) {
    const rawReport = props.dataset?.extra_metadata?.analysis_report
    const report = useJSONParse(rawReport) as ReportFormat | null

    const last_updated = report?.last_updated

    return <>
        <div className="panel">
        <header className="toolbar">
            <h1>
            <Link to="/"> /</Link>
            <Link to={`/u/${props.username}`}>{props.username}</Link>/
            {props.datasetname}
            <span>  </span>
            {last_updated && <span className='traceid status'>
                Last Analyzed <Time>{last_updated}</Time>
            </span>}
            </h1>
        </header>
        {report && <div className="insights">
            <div className='tiles'>
                <div className='tile'>
                    <h1>Top Issues</h1>
                    <ul>
                        <li>
                            <div>
                                <b>Issue 1</b>
                                <span className='description'>Description of the issue</span>
                            </div>
                            <span className='count'>10</span>
                        </li>
                        <li>
                            <div>
                                <b>Issue 1</b>
                                <span className='description'>Description of the issue</span>
                            </div>
                            <span className='count'>10</span>
                        </li>
                        <li>
                            <div>
                                <b>Issue 1</b>
                                <span className='description'>Description of the issue</span>
                            </div>
                            <span className='count'>10</span>
                        </li>
                    </ul>
                </div>
                <div className='tile'>
                    <h1>Raw Report</h1>
                    <pre>{rawReport}</pre>
                </div>
            </div>
        </div>}
        {!report && <div className='insights'>
            <div className='empty'>Analysis Not Available</div>
        </div>}
        </div>
    </>
}