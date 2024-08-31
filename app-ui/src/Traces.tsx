import React, { useCallback, useEffect } from 'react'
import { useNavigate, useSearchParams } from "react-router-dom";
import {UserInfo, useUserInfo} from './UserInfo'
import { BsArrowClockwise, BsCheckCircleFill, BsDatabaseFill, BsExclamationCircleFill, BsFileBinaryFill, BsLayoutSidebarInset, BsMoonStarsFill, BsPencilFill, BsQuestionCircleFill, BsTerminal, BsTrash, BsUpload } from 'react-icons/bs'
import { Link, useLoaderData } from 'react-router-dom'
import { TraceView } from './lib/traceview/traceview';
import Search from './lib/Search';

import { Explorer } from './Explorer'
import { sharedFetch } from './SharedFetch';

import { ViewportList } from 'react-viewport-list';
import { Modal } from './Modal';
import { Time } from './components/Time';
import { DeleteSnippetModal } from './lib/snippets';

export interface DatasetData {
  id: string
  name: string
  num_traces: number
  extra_metadata: string
  user_id: string
}

function useDataset(username:string, datasetname: string): [DatasetData | null, string | null] {
  const [dataset, setDataset] = React.useState(null)
  const [error, setError] = React.useState(null as string | null);

  React.useEffect(() => {
    sharedFetch(`/api/v1/dataset/byuser/${username}/${datasetname}`)
      .then(data => setDataset(data))
      .catch(e => {
        alert("Error loading dataset")
        setError(e)
      })
  }, [username, datasetname])

  return [dataset, error]
}

export interface Trace {
  id: string;
  index: number;
  dataset: string;
  messages: any[];
  extra_metadata: string;
  time_created: string;
  user_id: string;
  // sometimes a trace already comes with the resolved user name (if joined server-side)
  user?: string;
}

function useTraces(username: string, datasetname: string, bucket: string): [any | null, (traces: any) => void, () => void] {
  const [traces, setTraces] = React.useState(null)

  React.useEffect(() => refresh(), [username, datasetname, bucket])
  const refresh = () => {
    sharedFetch(`/api/v1/dataset/byuser/${username}/${datasetname}/${bucket}`).then(data => {
        data = transformTraces(data)
        setTraces(data)
    }).catch(e => alert("Error loading traces"))
  }

  return [traces, setTraces, refresh]
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

// returns whether the given trace has link sharing enabled (true for shared, false for not shared, null for when
// the current user does not have permission to view sharing status)
function useTraceShared(traceId: string | null): [boolean | null, (shared: boolean) => void] {
  const [shared, setShared] = React.useState(false as boolean | null)

  React.useEffect(() => {
    if (!traceId) { return }
    sharedFetch(`/api/v1/trace/${traceId}/shared`).then(data => {
      setShared(data.shared)
    }).catch(e => {
      if (e.status === 401) {
        // the current user does not have permission to view sharing status
        setShared(null)
      } else {
        alert("Error checking sharing status")
      }
    })
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

// returns the ID of the trace that comes before the given trace in the list of traces
function findPreviousTrace(traceId, traces) {
  const index = traces.indices.indexOf(traceId)
  if (index > 0) {
    return traces.indices[index - 1]
  }
  return null
}

export function Traces() {
  const props: {username: string, datasetname: string, bucketId: string, traceId: string|null} = useLoaderData() as any
  const navigate = useNavigate()
  
  const [dataset, datasetLoadingError] = useDataset(props.username, props.datasetname)
  const [traces, setTraces, refresh] = useTraces(props.username, props.datasetname, props.bucketId)
  const [sharingEnabled, setSharingEnabled] = useTraceShared(props.traceId)
  const [showShareModal, setShowShareModal] = React.useState(false)
  const [showDeleteModal, setShowDeleteModal] = React.useState(false)

  const userInfo = useUserInfo()
  
  // if trace ID is null, select first from 'elements'
  useEffect(() => {
    if (props.traceId === null && traces && traces.indices.length > 0) {
      navigate(`/user/${props.username}/dataset/${props.datasetname}/${props.bucketId}/${traces.indices[0]}`)
    }
  }, [props.traceId, traces])

  // navigates to the given trace ID and refreshes the list of traces
  const navigateToTrace = useCallback((traceId: string | null) => {
    navigate(`/user/${props.username}/dataset/${props.datasetname}/${props.bucketId}/${traceId || ''}`)
    refresh()
  }, [props.username, props.datasetname, props.bucketId])

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

  if (datasetLoadingError) {
    return <div className='empty'>
      <h3>Failed to Load Dataset</h3>
    </div>
  } else if (!dataset) {
    return <div className='empty'>
      <h3>Loading...</h3>
    </div>
  }

  const isUserOwned = userInfo?.id && userInfo?.id == dataset?.user_id

  return <div className="panel fullscreen app">
    {sharingEnabled != null && showShareModal && <Modal title="Link Sharing" onClose={() => setShowShareModal(false)} hasWindowControls cancelText="Close">
      <ShareModalContent sharingEnabled={sharingEnabled} setSharingEnabled={setSharingEnabled} traceId={props.traceId} />
    </Modal>}
    {isUserOwned && showDeleteModal && <DeleteSnippetModal entityName='trace' snippet={{id: props.traceId}} setSnippet={(state) => setShowDeleteModal(!!state)} onSuccess={() => navigateToTrace(findPreviousTrace(props.traceId, traces))} />}
    <div className='sidebyside'>
    <Sidebar 
      traces={traces} 
      username={props.username}
      datasetname={props.datasetname} 
      activeTraceId={props.traceId} 
      bucketId={props.bucketId}
      onRefresh={refresh}
    />
    {activeTrace && <Explorer
      // {...(transformedTraces || {})}
      activeTrace={activeTrace}
      loadTrace={loadTrace} 
      loading={!traces}
      header={
        <h1><Link to='/'>Datasets</Link> / <Link to={`/user/${props.username}/dataset/${props.datasetname}`}>{dataset?.name}</Link> / {props.bucketId}<span className='traceid'>#{activeTrace?.trace.index} {props.traceId}</span></h1> 
      }
      queryId={"<queryId>"}
      selectedTraceId={props.traceId}
      hasFocusButton={false}
      onShare={sharingEnabled != null ? () => setShowShareModal(true) : null}
      sharingEnabled={sharingEnabled}
      actions={<>
        {isUserOwned && <button className='danger icon inline' onClick={() => setShowDeleteModal(true)}><BsTrash /></button>}
      </>}
    />}
    </div>
  </div>
}

function Sidebar(props) {
  const {username, datasetname, activeTraceId} = props
  const [visible, setVisible] = React.useState(true)
  const viewportRef = React.useRef(null)
  const [activeIndices, setActiveIndices] = React.useState([])
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, _setSearchQuery] = React.useState(searchParams.get('query') || '')
  const [searchResult, setSearchResult] = React.useState(null)
  const setSearchQuery = (value) => {
    if (value) {
      setSearchParams({...searchParams, query: value})
    } else {
      searchParams.delete('query')
      setSearchParams(searchParams)
    }
    _setSearchQuery(value)
  };
  
  useEffect(() => {
    if (searchResult) {
      setActiveIndices(searchResult)
    } else {
      setActiveIndices(props.traces ? props.traces.indices : [])    
      // no search result, but search query is set -> perform search
      // triggers upon initial load
      if (searchQuery) {
        search(searchQuery)
      }
    }
  }, [props.traces, searchResult, searchQuery])

  const search = (query) => {
    return sharedFetch(`/api/v1/dataset/byuser/${username}/${datasetname}/s?query=${query}`)
      .then(data => {
        if (props.traces) {
          const ids = new Set(data.map(d => d.id))
          setSearchResult(props.traces.indices.filter(t => ids.has(t)))
        }
        return data
      })
      .catch(e => {
        alert("Error searching traces: " + e)
        throw e
      })
  }

  const onRefresh = (e) => {
    setSearchQuery('')
    props.onRefresh(e)
  };

  return <div className={'sidebar ' + (visible ? 'visible' : 'collapsed')}>
    <Search search={search} query={searchQuery} setQuery={setSearchQuery} />
    <header>
      {props.traces && <h1>{(props.traces.indices.length != activeIndices.length ? activeIndices.length + " of " : "") + props.traces.indices.length + " Traces"}</h1>}
      {!props.traces && <h1>Loading...</h1>}
      <div className='spacer'></div>
      <button className='toggle icon' onClick={onRefresh}><BsArrowClockwise /></button>
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
        items={activeIndices}
        viewportRef={viewportRef}
        overscan={10}
      >
        {(id: string) => {
          const trace = props.traces.elements[id]
          return <li key={id} className={'trace ' + (id === activeTraceId ? 'active' : '')}>
            <Link to={`/user/${username}/dataset/${datasetname}/${props.bucketId}/${id}` + (searchQuery ? '?query=' + encodeURIComponent(searchQuery) : '')} className={id === activeTraceId ? 'active' : ''}>
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
  const [dataset, setDataset] = React.useState(null as {name: string} | null)
  const [error, setError] = React.useState(null as string | null)
  const [sharingEnabled, setSharingEnabled] = useTraceShared(props.traceId)
  const [showShareModal, setShowShareModal] = React.useState(false)
  // set if we are showing a snippet trace (a trace without dataset)
  const [snippetData, setSnippetData] = React.useState({isSnippet: false, user: null} as {isSnippet: boolean, user: string | null})
  const [showDeleteModal, setShowDeleteModal] = React.useState(false)
  
  const userInfo = useUserInfo()
  const navigate = useNavigate()
  const isUserOwned = userInfo?.id && userInfo?.id == trace?.user_id

  // fetch trace
  React.useEffect(() => {
    if (!props.traceId) {
      return
    }
    sharedFetch(`/api/v1/trace/${props.traceId}`).then(data => {
      setTrace(data)
    }).catch(e => {
      if (e.status === 401) {
        setError("You do not have permission to view this trace")
        return
      } else {
        setError("Error loading trace")
      }
    })
  }, [props.traceId])

  // fetch dataset
  React.useEffect(() => {
    if (!trace) {
      return
    }
    
    if (trace.dataset) {
      // depending on permissions, this may not be available
      sharedFetch(`/api/v1/dataset/byid/${trace?.dataset}`).then(data => {
        setDataset(data)
      }).catch(e => {})
    } else {
      // otherwise use trace.user, if available and hide index
      setDataset({name: trace?.user || ''})
      setSnippetData({isSnippet: true, user: trace?.user || ''})
    }
  }, [trace])

  let header = <></>
  if (dataset) {
    header = snippetData.isSnippet ? 
      <h1><Link to={`/user/${snippetData.user}`}>{snippetData.user}</Link> <span className='traceid'># {props.traceId}</span><Time className='time'>{trace?.time_created || ''}</Time>
      </h1> :
      <h1>{dataset ? <Link to={`/dataset/${trace?.dataset}`}>{dataset.name}</Link> : ""}/<span className='traceid'>#{trace?.index} {props.traceId}</span></h1>
  }

  return <div className="panel fullscreen app">
    {error && <div className='empty'>
      <h3>{error}</h3>
    </div>}
    {isUserOwned && sharingEnabled != null && showShareModal && <Modal title="Link Sharing" onClose={() => setShowShareModal(false)} hasWindowControls cancelText="Close">
      <ShareModalContent sharingEnabled={sharingEnabled} setSharingEnabled={setSharingEnabled} traceId={props.traceId} />
    </Modal>}
    {isUserOwned && showDeleteModal && <DeleteSnippetModal snippet={{id: props.traceId}} setSnippet={(state) => setShowDeleteModal(!!state)} onSuccess={() => navigate('/')} />}
    {!error && <div className='sidebyside'>
    <Explorer
      // {...(transformedTraces || {})}
      activeTrace={trace}
      loadTrace={() => {}}
      loading={!trace}
      header={header}
      queryId={"<queryId>"}
      selectedTraceId={props.traceId}
      hasFocusButton={false}
      onShare={sharingEnabled != null && trace?.user_id == userInfo?.id ? () => setShowShareModal(true) : null}
      sharingEnabled={sharingEnabled}
      actions={<>
        {isUserOwned && <button className='danger icon inline' onClick={() => setShowDeleteModal(true)}><BsTrash /></button>}
      </>}
    />
    </div>}
  </div>
}


// interface ExplorerProps {
//   activeTrace: any
//   loadTrace: (trace: Trace) => void
//   loading: boolean
//   header: any
//   queryId: string
//   selectedTraceId: string
//   hasFocusButton: boolean
//   onShare: () => void
//   sharingEnabled: boolean
// }

// function Explorer(props: ExplorerProps) {
//   return <div className="panel fullscreen app new" style={{width: "100%"}}>
//     <TraceView 
//       sideBySide={true} 
//       inputData={JSON.stringify(props.activeTrace?.messages, null, 2)} 
//       handleInputChange={() => {}} 
//       annotations={{}} 
//       editor={false}
//       header={props.header}
//     />
//   </div>
// }