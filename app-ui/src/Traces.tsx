import React, { useCallback, useEffect } from 'react'
import { useNavigate, useSearchParams } from "react-router-dom";
import {UserInfo, useUserInfo} from './UserInfo'
import { BsArrowClockwise, BsCheckCircleFill, BsDatabaseFill, BsExclamationCircleFill, BsFileBinaryFill, BsLayoutSidebarInset, BsMoonStarsFill, BsPencilFill, BsQuestionCircleFill, BsTerminal, BsTrash, BsUpload, BsSave } from 'react-icons/bs'
import { Link, useLoaderData } from 'react-router-dom'
import { TraceView } from './lib/traceview/traceview';
import { Explorer } from './Explorer'
import { sharedFetch } from './SharedFetch';
import { ViewportList } from 'react-viewport-list';
import { Modal } from './Modal';
import { Time } from './components/Time';
import { DeleteSnippetModal } from './lib/snippets';
import ClockLoader from "react-spinners/ClockLoader";
import { BsSearch, BsCaretDownFill } from "react-icons/bs";
import { CgDisplaySpacing } from 'react-icons/cg';
import { clear } from 'localforage';

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
  fetched?: boolean;
}

function useTraces(username: string, datasetname: string): [any | null, (traces: any) => void, () => void] {
  const [traces, setTraces] = React.useState(null)

  React.useEffect(() => refresh(), [username, datasetname])
  const refresh = () => {
    sharedFetch(`/api/v1/dataset/byuser/${username}/${datasetname}/traces`).then(traces => {
        setTraces(traces.sort((a, b) => a.id - b.id).map(t => {return {...t, name: '#'+t.index, fetched: false}}))
    }).catch(e => alert("Error loading traces"))
  }
  
  return [traces, setTraces, refresh]
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
function useTraceShared(traceId: string | null | undefined): [boolean | null, (shared: boolean) => void] {
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

function useSearch() {
  const props: {username: string, datasetname: string, traceIndex: number|null} = useLoaderData() as any
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, _setSearchQuery] = React.useState<string|null>(searchParams.get('query') || null)
  const [displayedIndices, setDisplayedIndices] = React.useState<number[]|null>(null)
  const [highlightMappings, setHighlightMappings] = React.useState({} as {[key: number]: any})
  interface SearchQuery {
    query: string,
    status: 'waiting'|'searching'|'completed',
    date: Date
  }
  const searchQueue = React.useRef<SearchQuery[]>([])
  const searchTimeout = React.useRef<number|null|undefined>(null)
  const searching = searchQueue.current.filter(q => q.status === 'searching').length > 0 || searchTimeout.current !== null
  
  const search = (query) => {
    if (query.status !== 'waiting') return;
    query.status = 'searching'
    return sharedFetch(`/api/v1/dataset/byuser/${props.username}/${props.datasetname}/s?query=${query.query}`)
      .then(data => {
        const new_displayed_indices = data.map(d => d.index).sort()
        const mappings = {}
        data.forEach(d => {
          mappings[d.index] = d.mapping
        })
        query.status = 'completed'
        // check that this is still the newest query to complete
        if (searchQueue.current.filter(q => q.status === 'completed' && q.date > query.date).length === 0)
        {
          setDisplayedIndices(new_displayed_indices)
          setHighlightMappings(mappings)
          // remove all queries that are older than this
          searchQueue.current = searchQueue.current.filter(q => q.date > query.date)
        }
        return data
      })
      .catch(e => {
        alert("Error searching traces: " + JSON.stringify(e))
        throw e
      })
  }
  
  const dispatchSearch = (value) => {
    console.log('dispatching search', value)
    if (!value || value === '') {
      setDisplayedIndices(null)
      setSearchQuery('')
      searchQueue.current = [{query: '', status: 'completed', date: new Date()}]
      return
    }
    // add current search objective to the queue
    searchQueue.current.push({query: value,
                              status: 'waiting',
                              date: new Date()})
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current)
      searchTimeout.current = null 
    }
    const st = setTimeout(() => {
      // get latest (rightmost) query that is waiting & search it
      const query = searchQueue.current.filter(q => q.status === 'waiting').pop()
      search(query)
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current)
        searchTimeout.current = null
      }
    }, 50)
    searchTimeout.current = st
  }

  const setSearchQuery = (value: string|null) => {
    _setSearchQuery(value)
    if (value === null || value === '') {
      searchParams.delete('query')
      setSearchParams(searchParams)
    } else {
      setSearchParams({...searchParams, query: value})
    }
  };
  
  const searchNow = () => {
    dispatchSearch(searchQuery)
  }
  
  useEffect(() => {
    dispatchSearch(searchQuery)
  }, [searchQuery])

  return [displayedIndices, highlightMappings, searchQuery, setSearchQuery, searchNow, searching] as const;
}

export function Traces() {
  const props: {username: string, datasetname: string, traceIndex: number|null} = useLoaderData() as any
  const navigate = useNavigate()
  const [dataset, datasetLoadingError] = useDataset(props.username, props.datasetname)
  const [traces, setTraces, refresh] = useTraces(props.username, props.datasetname)
  const [showShareModal, setShowShareModal] = React.useState(false)
  const [showDeleteModal, setShowDeleteModal] = React.useState(false)
  const [sharingEnabled, setSharingEnabled] = useTraceShared(traces && props.traceIndex ? traces[props.traceIndex]?.id : null)
  const userInfo = useUserInfo()
  const [displayedIndices, highlightMappings, searchQuery, setSearchQuery, searchNow, searching] = useSearch();
  const isUserOwned = userInfo?.id && userInfo?.id == dataset?.user_id
  const [activeTrace, setActiveTrace] = React.useState(null as Trace | null)
  
  useEffect(() => {
    if (traces
        && props.traceIndex !== null
        && props.traceIndex !== undefined
        && traces.map(t => t.index).includes(+props.traceIndex)
        && (displayedIndices === null || displayedIndices.includes(+props.traceIndex))) {
      setActiveTrace(traces[props.traceIndex])
    } else if (!traces) {
      setActiveTrace(null)
    } else {
      let new_index = 0
      if (traces) new_index = Math.min(...traces.map(t => t.index))
      if (displayedIndices) new_index = Math.min(...displayedIndices)
      navigate(`/u/${props.username}/${props.datasetname}/t/${new_index}`)
    }
  }, [props.traceIndex, traces, displayedIndices])
  
  useEffect(() => {
    // if we switch to a different active trace, update the active trace to fetch the messages
    if (traces && activeTrace && !activeTrace.fetched) {
      fetchTrace(activeTrace).then(change => {
        if (!change.updated) return;
        const t = change.trace;
        if (!t) return;
        console.log('updating trace', t.id, t.messages.length)
        setTraces(traces => {
          traces[t.index] = {...t, fetched: true, name: '#'+t.index} 
          return traces
        })
        setActiveTrace(traces[t.index])
      })
    }
  }, [traces, activeTrace])

  // navigates to the given trace index and refreshes the list of traces
  const navigateToTrace = useCallback((traceIndex: number | null) => {
    navigate(`/u/${props.username}/${props.datasetname}/t/${traceIndex || ''}`)
    refresh()
  }, [props.username, props.datasetname])

  if (datasetLoadingError) {
    return <div className='empty'>
      <h3>Failed to Load Dataset</h3>
    </div>
  } else if (!dataset) {
    return <div className='empty'>
      <h3>Loading...</h3>
    </div>
  }
 
  return <div className="panel fullscreen app">
    {sharingEnabled != null && showShareModal && <Modal title="Link Sharing" onClose={() => setShowShareModal(false)} hasWindowControls cancelText="Close">
      <ShareModalContent sharingEnabled={sharingEnabled} setSharingEnabled={setSharingEnabled} traceId={activeTrace?.id} />
    </Modal>}
    {isUserOwned && showDeleteModal && <DeleteSnippetModal entityName='trace' snippet={{id: activeTrace?.id}} setSnippet={(state) => setShowDeleteModal(!!state)} onSuccess={() => navigateToTrace(findPreviousTrace(activeTrace?.id, traces))} />}
    <div className='sidebyside'>
    <Sidebar 
      traces={traces} 
      username={props.username}
      datasetname={props.datasetname} 
      activeTraceIndex={activeTrace?.index} 
      onRefresh={refresh}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      displayedIndices={displayedIndices}
      searchNow={searchNow}
      searching={searching}
    />
    {activeTrace && <Explorer
      activeTrace={ activeTrace }
      selectedTraceId={activeTrace?.id}
      mappings={highlightMappings[activeTrace.index]}
      loadTrace={() => {}} 
      loading={!traces}
      header={
        <h1>
          <Link to='/'>/</Link>
          <Link to={`/u/${props.username}`}>{props.username}</Link>/
          <Link to={`/u/${props.username}/${props.datasetname}`}>{props.datasetname}</Link>/
          <Link to={`/u/${props.username}/${props.datasetname}/t/${activeTrace.index}`}><span className='traceid'>{activeTrace.index}</span></Link>
        </h1>
      }
      queryId={"<queryId>"}
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

function SearchBox(props) {
    const searchQuery=props.searchQuery
    const setSearchQuery=props.setSearchQuery

    const update = (e) => {
        if (e.key === 'Enter') {
            props.searchNow()
        } else if (e.key === 'Escape') {
            //reset()
            e.target.value = ''
            setSearchQuery('')
        } else {
            setSearchQuery(e.target.value)
        }
    }
    
    const clickSelect = (e) => {
        const dropdown = e.target.parentElement.parentElement.parentElement.querySelector('.search-select-dropdown')
        if (dropdown) {
            dropdown.classList.toggle('search-select-dropdown-show')
        }
    }
    
    const addFilter = (e, filter) => {
        setSearchQuery(filter + ' ' + searchQuery)
        const dropdown = e.target.parentElement.parentElement.parentElement.parentElement.querySelector('.search-select-dropdown')
        if (dropdown) {
            dropdown.classList.toggle('search-select-dropdown-show')
        }
    }

    return <>
     <div className='search'>
        <button className='search-select' onClick={clickSelect}>
            <BsCaretDownFill />
        </button>
         <div className='search-select-dropdown'>
         <ul>
            <li onClick={(e)=>{addFilter(e, 'is:annotated')}} >Has annotation</li>
            <li onClick={(e)=>{addFilter(e, 'not:annotated')}} >No annotation</li>
            <li onClick={(e)=>{addFilter(e, 'num_messages>10')}} >At least 10 messages</li>
         </ul>
         </div>
        <input className='search-text' type="text" onChange={update} value={searchQuery} placeholder="Search" />
        <button className='search-submit' onClick={()=>{ props.searchNow() }}>
            {!props.searching && <BsSearch />}
            {props.searching && <ClockLoader size={'15'} />}
        </button>
    </div>
    </>
}

function Sidebar(props) {
  const searchQuery=props.searchQuery
  const setSearchQuery=props.setSearchQuery
  const displayedIndices=props.displayedIndices
  const {username, datasetname, activeTraceId} = props
  const [visible, setVisible] = React.useState(true)
  const viewportRef = React.useRef(null)
  const [activeIndices, setActiveIndices] = React.useState<number[]>([]);

  useEffect(() => {
    if (displayedIndices) {
      setActiveIndices(displayedIndices.sort((a, b) => a - b))
    } else {
      setActiveIndices(props.traces.map((_, i) => i).sort((a, b) => a - b))
    }
  }, [displayedIndices, props.traces])

  const onRefresh = (e) => {
    setSearchQuery('')
    props.onRefresh(e)
  };
  
  const onSave = (e) => {
    fetch(`/api/v1/dataset/byuser/${username}/${datasetname}/s`, {
      'method': 'PUT',
      'body': JSON.stringify({query: searchQuery,
                              name: 'Search: ' + searchQuery
      })
    }).then(() => {
      alert("Saved search")
    })
  }

  return <div className={'sidebar ' + (visible ? 'visible' : 'collapsed')}>
    <header>
      <SearchBox setSearchQuery={props.setSearchQuery} searchQuery={props.searchQuery} searchNow={props.searchNow} searching={props.searching} />
      { searchQuery && 
        <button className='header-short toggle icon' onClick={onSave}><BsSave/></button>
      }
      <button className='header-short toggle icon' onClick={onRefresh}><BsArrowClockwise /></button>
      {props.traces && <h1 className='header-long'>{(props.traces.length != activeIndices.length ? activeIndices.length + " of " : "") + props.traces.length + " Traces"}</h1>}
      {!props.traces && <h1 className='header-long'>Loading...</h1>}
      <button className='header-short toggle icon' onClick={() => setVisible(!visible)}><BsLayoutSidebarInset /></button>
    </header>
    <ul ref={viewportRef}>
      <ViewportList
        items={activeIndices}
        viewportRef={viewportRef}
        overscan={10}
      >
        {(index: number) => {
          const trace = props.traces[index]
          const active = trace.index === props.activeTraceIndex
          return <li key={index} className={'trace ' + (active ? 'active' : '')}>
            <Link to={`/u/${username}/${datasetname}/t/${index}` + (searchQuery ? '?query=' + encodeURIComponent(searchQuery) : '')} className={active ? 'active' : ''}>
              Run {trace.name} {trace.num_annotations > 0 ? <span className='badge'>{trace.num_annotations}</span> : null}
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
      <h1><Link to={`/u/${snippetData.user}`}>{snippetData.user}</Link> <span className='traceid'># {props.traceId}</span><Time className='time'>{trace?.time_created || ''}</Time>
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