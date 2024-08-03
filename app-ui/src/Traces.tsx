import React, { useCallback, useEffect } from 'react'
import { useNavigate } from "react-router-dom";
import {UserInfo, useUserInfo} from './UserInfo'
import { BsCheckCircleFill, BsDatabaseFill, BsFileBinaryFill, BsLayoutSidebarInset, BsMoonStarsFill, BsPencilFill, BsQuestionCircleFill, BsTerminal, BsTrash, BsUpload } from 'react-icons/bs'
import { Link, useLoaderData } from 'react-router-dom'

import { Explorer } from './TraceView'
import { sharedFetch } from './SharedFetch';

import { ViewportList } from 'react-viewport-list';

interface DatasetData {
  id: string
  name: string
  num_traces: number
  extra_metadata: string
}

function useDataset(datasetId: string): DatasetData | null {
  const [dataset, setDataset] = React.useState(null)

  React.useEffect(() => {
    sharedFetch(`/api/v1/dataset/${datasetId}`)
      .then(data => setDataset(data))
      .catch(e => alert("Error loading dataset"))
  }, [datasetId])

  return dataset
}

interface Trace {   
  id: string;
  index: number;
  messages: any[];
  extra_metadata: string;
}

function useTraces(datasetId: string, bucket: string): [any | null, any] {
  const [traces, setTraces] = React.useState(null)

  React.useEffect(() => {
    sharedFetch(`/api/v1/dataset/${datasetId}/${bucket}`).then(data => {
        data = transformTraces(data)
        setTraces(data)
    }).catch(e => alert("Error loading traces"))
  }, [datasetId, bucket])

  return [traces, setTraces]
}

function transformTraces(traces: Trace[]): any {
  const elements = {}

  traces.forEach(t => {
    elements[t.id] = {
      "name": "#" + t.index,
      "messages": t.messages,
      "trace": t
    }
  })

  return {
    elements: elements,
    indices: traces.map(t => t.id),
    queryId: "<queryId>"
  }
}

function fetchTrace(trace: Trace): Promise<{updated: boolean, trace: Trace}> {
  if (trace.messages.length != 0) {
    return Promise.resolve({
      updated: false,
      trace: trace
    })
  }
  trace.messages = [{"role": "system", "content": "Loading..."}]

  return new Promise((resolve, reject) => {
    fetch(`/api/v1/trace/${trace.id}`).then(response => {
      if (response.ok) {
        return response.json()
      }
      return null
    }).then(data => {
      trace.messages = data.messages
      resolve({
        updated: true,
        trace: trace
      })
    }).catch(e => {
      trace.messages = [{"role": "system", "content": "Error loading trace"}]
      reject({
        updated: false,
        trace: trace
      })
    })
  });
}

function Traces() {
  const props: {datasetId: string, bucketId: string, traceId: string|null} = useLoaderData() as any
  const dataset = useDataset(props.datasetId)
  // for link navigation with router
  const navigate = useNavigate()

  const [traces, setTraces] = useTraces(props.datasetId, props.bucketId)
  
  // if trace ID is null, select first from 'elements'
  useEffect(() => {
    if (props.traceId === null && traces && traces.indices.length > 0) {
      navigate(`/dataset/${props.datasetId}/${props.bucketId}/${traces.indices[0]}`)
    }
  }, [props.traceId, traces])

  const loadTrace = useCallback((trace: Trace) => {
    fetchTrace(trace).then(change => {
      if (!change.updated) return;
      
      const t = change.trace;
      if (!t) return;
      setTraces(traces => {
        traces.elements[t.id] = {
          "name": "#" + t.index,
          "messages": t.messages,
          "trace": t
        }
        return {
          elements: traces.elements,
          indices: traces.indices,
          queryId: "<queryId>"
        }
      })
    })
  }, [setTraces])

  const activeTrace = props.traceId ? traces?.elements[props.traceId] : null

  if (!dataset) {
    return <div className='empty'>
      <h3>Loading...</h3>
    </div>
  }

  return <div className="panel fullscreen app">
    <header>
      <h1><Link to='/'>Datasets</Link> / <Link to={`/dataset/${props.datasetId}`}>{dataset?.name}</Link> / {props.bucketId}<span className='traceid'>#{activeTrace?.trace.index} {props.traceId}</span></h1> 
    </header>
    <div className='sidebyside'>
    <Sidebar 
      traces={traces} 
      datasetId={props.datasetId} 
      activeTraceId={props.traceId} 
      bucketId={props.bucketId}
    />
    <Explorer
      // {...(transformedTraces || {})}
      activeTrace={activeTrace}
      loadTrace={loadTrace} 
      loading={!traces}
      queryId={"<queryId>"}
      selectedTraceId={props.traceId}
      hasFocusButton={false}
    />
    </div>
  </div>
}

function Sidebar(props) {
  const {datasetId, activeTraceId} = props
  const [visible, setVisible] = React.useState(true)
  const viewportRef = React.useRef(null)

  return <div className={'sidebar ' + (visible ? 'visible' : 'collapsed')}>
    <header>
      <h1>{props.traces ? props.traces.indices.length + " Traces" : "Loading..."}</h1>
      <div className='spacer'></div>
      <button className='toggle icon' onClick={() => setVisible(!visible)}><BsLayoutSidebarInset /></button>
    </header>
    <ul ref={viewportRef}>
      {/* {props.traces ? props.traces.indices.map(id => {
        const trace = props.traces.elements[id]
        return <li key={id} className={'trace ' + (id === activeTraceId ? 'active' : '')}>
          <Link to={'/dataset/' + datasetId + '/' + props.bucketId + '/' + id} className={id === activeTraceId ? 'active' : ''}>
            Run {trace.name} {trace.trace.num_annotations > 0 ? <span className='badge'>{trace.trace.num_annotations}</span> : null}
          </Link>
        </li>
      }) : null} */}
      <ViewportList
        items={props.traces ? props.traces.indices : []}
        viewportRef={viewportRef}
        overscan={10}
      >
        {(id: string) => {
          const trace = props.traces.elements[id]
          return <li key={id} className={'trace ' + (id === activeTraceId ? 'active' : '')}>
            <Link to={'/dataset/' + datasetId + '/' + props.bucketId + '/' + id} className={id === activeTraceId ? 'active' : ''}>
              Run {trace.name} {trace.trace.num_annotations > 0 ? <span className='badge'>{trace.trace.num_annotations}</span> : null}
            </Link>
          </li>
        }}
      </ViewportList>

    </ul>
  </div>
}

export default Traces
