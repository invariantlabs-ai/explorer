import React, { useCallback, useEffect } from 'react'
import { useNavigate } from "react-router-dom";
import {UserInfo, useUserInfo} from './UserInfo'
import { BsCheckCircleFill, BsDatabaseFill, BsFileBinaryFill, BsLayoutSidebarInset, BsMoonStarsFill, BsPencilFill, BsQuestionCircleFill, BsTerminal, BsTrash, BsUpload } from 'react-icons/bs'
import { Link, useLoaderData } from 'react-router-dom'

import { Explorer } from './TraceView'
import { sharedFetch } from './SharedFetch';

import { ViewportList } from 'react-viewport-list';
import { Modal } from './Modal';

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
  dataset: string;
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

function ShareModalContent(props) {
  const [justCopied, setJustCopied] = React.useState(false)

  useEffect(() => {
    if (justCopied) {
      let timeout = setTimeout(() => setJustCopied(false), 2000)
      return () => clearTimeout(timeout)
    }
  }, [justCopied])
  
  const onClick = (e) => {
    e.currentTarget.select()
    navigator.clipboard.writeText(e.currentTarget.value)
    setJustCopied(true)
  }

  const link = window.location.origin + "/trace/" + props.traceId

  return <div className='form' style={{maxWidth: '500pt'}}>
    {/* <h2>By sharing a trace you can allow others to view the trace and its annotations. Anyone with the generated link will be able to view the trace.</h2> */}
    <h2>Share this trace with others, so they can view the trace and its annotations.</h2>
    <h2>Only the selected trace <span className='traceid'>#{props.traceId}</span> will be shared with others.</h2>
    <label>Link Sharing</label>
    <input type='text' value={props.sharingEnabled ? link : 'Not Enabled'} className='link' onClick={onClick} disabled={!props.sharingEnabled}/>
    <span className='description' style={{color: justCopied ? 'inherit' : 'transparent'}}>{justCopied ? 'Link Copied!' : 'no'}</span>
    <button className={'share inline ' + (!props.sharingEnabled ? 'primary' : '')} onClick={() => props.setSharingEnabled(!props.sharingEnabled)}>{props.sharingEnabled ? 'Disable' : 'Enable'} Sharing</button>
  </div>
}

function useTraceShared(traceId: string | null): [boolean, (shared: boolean) => void] {
  const [shared, setShared] = React.useState(false)

  React.useEffect(() => {
    if (!traceId) { return }
    sharedFetch(`/api/v1/trace/${traceId}/shared`).then(data => {
      setShared(data.shared)
    }).catch(e => alert("Error checking sharing status"))
  }, [traceId])

  const setRemoteShared = useCallback((shared: boolean) => {
    if (!traceId) { return }

    // PUT to share, DELETE to unshare
    if (shared) {
      fetch(`/api/v1/trace/${traceId}/shared`, {
        method: 'PUT'
      }).then(() => setShared(true)).catch(e => alert("Error sharing trace"))
    } else {
      fetch(`/api/v1/trace/${traceId}/shared`, {
        method: 'DELETE'
      }).then(() => setShared(false)).catch(e => alert("Error unsharing trace"))
    }
  }, [traceId])

  if (!traceId) {
    return [false, () => {}]
  }

  return [shared, setRemoteShared]
}


export function Traces() {
  const props: {datasetId: string, bucketId: string, traceId: string|null} = useLoaderData() as any
  const navigate = useNavigate()
  
  const dataset = useDataset(props.datasetId)
  const [traces, setTraces] = useTraces(props.datasetId, props.bucketId)
  const [sharingEnabled, setSharingEnabled] = useTraceShared(props.traceId)
  const [showShareModal, setShowShareModal] = React.useState(false)
  
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
    {showShareModal && <Modal title="Link Sharing" onClose={() => setShowShareModal(false)} hasWindowControls cancelText="Close">
      <ShareModalContent sharingEnabled={sharingEnabled} setSharingEnabled={setSharingEnabled} traceId={props.traceId} />
    </Modal>}
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
      header={
        <h1><Link to='/'>Datasets</Link> / <Link to={`/dataset/${props.datasetId}`}>{dataset?.name}</Link> / {props.bucketId}<span className='traceid'>#{activeTrace?.trace.index} {props.traceId}</span></h1> 
      }
      queryId={"<queryId>"}
      selectedTraceId={props.traceId}
      hasFocusButton={false}
      onShare={() => setShowShareModal(true)}
      sharingEnabled={sharingEnabled}
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

export function SingleTrace() {
  const props: {traceId: string} = useLoaderData() as any
  const [trace, setTrace] = React.useState(null as Trace | null)
  const [dataset, setDataset] = React.useState(null as DatasetData | null)

  // fetch trace
  React.useEffect(() => {
    if (!props.traceId) {
      return
    }
    sharedFetch(`/api/v1/trace/${props.traceId}`).then(data => {
      setTrace(data)
    }).catch(e => {
      if (e.status === 401) {
        alert("You do not have permission to view this trace")
        return
      }
      alert("Error loading trace")
    })
  }, [props.traceId])

  // fetch dataset
  React.useEffect(() => {
    if (!trace) {
      return
    }
    // depending on permissions, this may not be available
    sharedFetch(`/api/v1/dataset/${trace?.dataset}`).then(data => {
      setDataset(data)
    }).catch(e => {})
  }, [trace])


  return <div className="panel fullscreen app">
    <div className='sidebyside'>
    <Explorer
      // {...(transformedTraces || {})}
      activeTrace={trace}
      loadTrace={() => {}}
      loading={!trace}
      header={
        <h1>{dataset ? <Link to={`/dataset/${trace?.dataset}`}>{dataset.name}</Link> : ""} / <span className='traceid'>#{trace?.index} {props.traceId}</span></h1> 
      }
      queryId={"<queryId>"}
      selectedTraceId={props.traceId}
      hasFocusButton={false}
      onShare={null}
      sharingEnabled={false}
    />
    </div>
  </div>
}
