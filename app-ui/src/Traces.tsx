/**
 * Page components for displaying single and all dataset traces.
 */

import React, { act, useCallback, useEffect } from 'react';
import { BsBookmark, BsCaretDownFill, BsCaretRightFill, BsExclamationLg, BsExclamationTriangleFill, BsFilterCircle, BsFilterCircleFill, BsInfo, BsLayoutSidebarInset, BsSearch, BsTools, BsTrash } from 'react-icons/bs';
import { Link, useLoaderData, useNavigate, useSearchParams } from "react-router-dom";
import ClockLoader from "react-spinners/ClockLoader";
import { ViewportList } from 'react-viewport-list';
import { AnnotationAugmentedTraceView } from './AnnotationAugmentedTraceView';
import { Modal } from './Modal';
import { sharedFetch } from './SharedFetch';
import { useUserInfo } from './UserInfo';
import logo from './assets/invariant.svg';
import { EmptyDatasetInstructions } from './components/EmptyDataset';
import { useTelemetry } from './telemetry';
import { Time } from './components/Time';
import { DeleteSnippetModal } from './lib/snippets';
import {UserInfo} from './UserInfo';
import { HighlightsNavigator } from './HighlightsNavigator';

// constant used to combine hierarchy paths
const pathSeparator = ' > ';

/**
 * Get the full name including the hierarchy path of a trace.
 */
function getFullDisplayName(trace: Trace|null) {
  return trace ? [...trace.hierarchy_path||[], trace.name].join(pathSeparator) : ''
}

/**
 * Lexicographically compares two traces by their hierarchy path and name. 
 */
function compareTraces(a: Trace|null, b: Trace|null) {
  const lhs = getFullDisplayName(a)
  const rhs = getFullDisplayName(b)
  return lhs.localeCompare(rhs)
}

/**
 * Metadata for a dataset that we receive from the server.
 */
export interface DatasetData {
  id: string
  name: string
  num_traces: number
  extra_metadata: Record<string, any>
  user_id: string
  is_public: boolean
}

/**
 * Hook to load the dataset metadata for a given user and dataset name.
 */
function useDataset(username: string, datasetname: string): [DatasetData | null, string | null] {
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

class FeatureSet {
  constructor(public flags: Record<string, boolean>) { 
    this.flags = flags || {}
  }

  has(flag: string): boolean {
    return this.flags[flag] || true
  }
}

/**
 * Metadata for a trace that we receive from the server.
 */
export interface Trace {
  id: string;
  index: number;
  dataset: string;
  name?: string;
  hierarchy_path?: string[];
  messages: any[];
  extra_metadata: string;
  time_created: string;
  user_id: string;
  // sometimes a trace already comes with the resolved user name (if joined server-side)
  user?: string;
  // true if additional data has already been fetched for this trace
  fetched?: boolean;
  // true if metadata (beyond index and id) has been loaded
  preloaded?: boolean;
  // number of annotations for this trace
  num_annotations?: number;
}

/**
 * Lightweight representation of all traces in a dataset.
 * 
 * This class is used to keep track of all trace indices (+IDs) in a dataset, where additional information
 * on each trace, like the number of annotations, is only loaded on demand.
 * 
 * To learn when more information is available for a specific trace index, register a callback with the `on` method.
 * 
 * If a component no longer needs to know about a trace index, it should call the `off` method to unregister its callback.
 * 
 * Batched fetching is automatically handled by this class, so that when a trace is not yet loaded, but a component registers
 * a callback for it, the trace will be fetched as part of the next batch.
 */
class LightweightTraces {
  data: Record<number, Trace> = {}
  callbacks: Record<number, ((Trace) => void)[]> = {}
  // currently scheduled indices
  scheduledIndices: Set<number> = new Set()
  loadingIndices: Set<number> = new Set()
  // time of last batch run
  lastBatchRun: number = new Date().getTime()
  // batch timeouts
  lastBatchTimeout: any

  constructor(public n: number, public username: string, public datasetname: string, initialData: Record<number, Trace> | null = null) {
    if (initialData) {
      this.data = initialData
    }
  }

  /**
   * Register a callback to be called when the trace at the given index is loaded.
   * 
   * @param index The index of the trace to listen for
   * @param callback The callback to call when the trace is loaded
   * @returns A function that can be called to unregister the callback
   */
  on(index: number, callback: (Trace) => void) {
    // add the callback to the list of callbacks for this index
    if (!this.callbacks[index]) {
      this.callbacks[index] = []
    }
    this.callbacks[index].push(callback)

    // if the trace is already preloaded, call the callback immediately
    if (this.data[index]?.preloaded) {
      callback(this.data[index])
      return
    }

    this.schedule(index)
  }

  /**
   * Schedules the given index to be preloaded. If the index is already scheduled, does nothing.
   * 
   * @param index The index of the trace to preload
   */
  schedule(index: number) {
    // if the index is already scheduled, do nothing
    if (this.scheduledIndices.has(index) || this.loadingIndices.has(index)) {
      return
    }
    if (this.data[index]?.preloaded) {
      return
    }
    // otherwise, add it to the list of scheduled indices (scheduled to be preloaded)
    this.scheduledIndices.add(index)
    if (this.scheduledIndices.size > 64) {
      const indices = Array.from(this.scheduledIndices)
      this.scheduledIndices.clear()
      this.lastBatchRun = new Date().getTime()
      this.batchFetch(indices)
    } else {
      // otherwise, make sure it run at the latest in 400ms
      window.clearTimeout(this.lastBatchTimeout)
      this.lastBatchTimeout = window.setTimeout(() => {
        const indices = Array.from(this.scheduledIndices)
        this.scheduledIndices.clear()
        this.lastBatchRun = new Date().getTime()
        this.batchFetch(indices)
      }, 100)
    }
  }

  /**
   * Asyncronously fetches the traces with the given indices.
   * 
   * Automatically notifies all registered callbacks when each trace is loaded and 
   * removes the index from the list of loading indices.
   * 
   * @param indices The indices to fetch
   */
  async batchFetch(indices: number[]) {
    if (indices.length === 0) return; // nothing to do
    indices.forEach(i => this.loadingIndices.add(i))

    sharedFetch(`/api/v1/dataset/byuser/${this.username}/${this.datasetname}/traces?indices=${indices.join(',')}`).then(traces => {
      // update fetched traces 
      traces.forEach(t => {
        this.data[t.index] = { ...t, fetched: false, preloaded: true }
        this.callbacks[t.index]?.forEach(c => c(this.data[t.index]))
        this.loadingIndices.delete(t.index)
      })
    }).catch(e => {
      console.error(e)
      alert("Error loading traces")
    })
  }

  /** Unschedule the given index from being preloaded */
  unschedule(index: number) {
    this.scheduledIndices.delete(index)
  }

  /** Unregister a callback for the given trace index */
  off(index: number, callback: (Trace) => void) {
    if (this.callbacks[index]) {
      this.callbacks[index] = this.callbacks[index].filter(c => c !== callback)
      if (this.callbacks[index].length === 0) {
        this.unschedule(index)
      }
    }
  }

  /** Returns the index of the first trace in the dataset */
  first(): number {
    return Math.min(...this.indices())
  }

  /** Updates the trace at the given index with the new trace data (e.g. when loading the messages of a trace) */
  update(index: number, trace: Trace) {
    this.data[index] = Object.assign({}, this.data[index], trace)
    // notify all callbacks for this index
    this.callbacks[index]?.forEach(c => c(this.data[index]))
  }

  /** Returns all non-null indices */
  indices() {
    // returns all non-null indices
    return Object.keys(this.data).map(i => parseInt(i)).sort((a, b) => a - b)
  }

  /** Returns whether the given index is in the dataset */
  has(traceIndex: number): boolean {
    return traceIndex < this.n;
  }

  /** Returns the trace at the given index, or null if it is not in the dataset. */
  get(index: number): Trace | null {
    return this.data[index] || null
  }

  /** Returns the list of traces matching the predicate. */
  filter(predicate: (Trace) => boolean): Trace[] {
    return this.indices().map(i => this.data[i]).filter(predicate)
  }
}

/**
 * Data structure to represent a hierarchy level represented as a group in the sidebar.
 */
interface HierarchyPath {
  path: string[]
  slug: string
  indices: number[]
}

// hook to load all traces in a dataset, represented as a LightweightTraces object
function useTraces(username: string, datasetname: string): [LightweightTraces | null, Record<string, HierarchyPath>, () => void] {
  const [traces, setTraces] = React.useState<LightweightTraces | null>(null)
  const [hierarchyPaths, setHierarchyPaths] = React.useState<Record<string, HierarchyPath>>({})

  React.useEffect(() => refresh(), [username, datasetname])
  const refresh = () => {
    sharedFetch(`/api/v1/dataset/byuser/${username}/${datasetname}/indices`).then(traces => {
      const n = traces.reduce((max, t) => Math.max(max, t.index), 0) + 1
      const traceMap: Record<number, Trace> = {}
      const pathMap: Record<string, HierarchyPath> = {} // maps hierarchy paths to indices
      traces.forEach(t => {
        traceMap[t.index] = { ...t, fetched: false }
        const path = t.hierarchy_path?.join(pathSeparator) || ''
        if (!pathMap.hasOwnProperty(path)) {
          pathMap[path] = { path: t.hierarchy_path || [], slug: path, indices: [] }
        }
        pathMap[path].indices.push(t.index)
      })
      setTraces(new LightweightTraces(n, username, datasetname, traceMap))
      setHierarchyPaths(pathMap)
    }).catch(e => {
      console.error(e)
      alert("Error loading traces")
    })
  }

  return [traces, hierarchyPaths, refresh]
}

// makes sure the provided trace has its .messages field populated, by loading the 
// trace content from the server if necessary
function fetchTrace(trace: Trace): Promise<{ updated: boolean, trace: Trace }> {
  if (trace.messages.length != 0) {
    return Promise.resolve({
      updated: false,
      trace: trace
    })
  }
  trace.messages = [{ "role": "system", "content": "Loading..." }]

  return new Promise((resolve, reject) => {
    fetch(`/api/v1/trace/${trace.id}`).then(response => {
      if (response.ok) {
        return response.json()
      }
      return null
    }).then(data => {
      // load the full trace data into the trace object
      trace = Object.assign({}, trace, data)
      resolve({
        updated: true,
        trace: trace
      })
    }).catch(e => {
      trace.messages = [{ "role": "system", "content": "Error loading trace" }]
      reject({
        updated: false,
        trace: trace
      })
    })
  });
}

// content of the share modal to enable/disable link sharing for a trace
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

  return <div className='form' style={{ maxWidth: '500pt' }}>
    {/* <h2>By sharing a trace you can allow others to view the trace and its annotations. Anyone with the generated link will be able to view the trace.</h2> */}
    <h2>Share this trace with others, so they can view the trace and its annotations.</h2>
    <h2>Only the selected trace <span className='traceid'>{props.traceName}</span> will be shared with others.</h2>
    <label>Link Sharing</label>
    <input type='text' value={props.sharingEnabled ? link : 'Not Enabled'} className='link' onClick={onClick} disabled={!props.sharingEnabled} />
    <span className='description' style={{ color: justCopied ? 'inherit' : 'transparent' }}>{justCopied ? 'Link Copied!' : 'no'}</span>
    <button className={'share inline ' + (!props.sharingEnabled ? 'primary' : '')} onClick={() => props.setSharingEnabled(!props.sharingEnabled)}>{props.sharingEnabled ? 'Disable' : 'Enable'} Sharing</button>
  </div>
}

// returns whether the given trace has link sharing enabled (true for shared, false for not shared, null for when
// the current user does not have permission to view sharing status)
function useTraceShared(traceId: string | null | undefined, userInfo: UserInfo | null): [boolean | null, (shared: boolean) => void] {
  const [shared, setShared] = React.useState(false as boolean | null)
  const telemetry = useTelemetry()
  const isUserLoggedIn = userInfo?.loggedIn;

  React.useEffect(() => {
    if (!traceId || !isUserLoggedIn) { return }
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
  }, [traceId, isUserLoggedIn])

  const setRemoteShared = useCallback((shared: boolean) => {
    if (!traceId) { return }

    // PUT to share, DELETE to unshare
    if (shared) {
      fetch(`/api/v1/trace/${traceId}/shared`, {
        method: 'PUT'
      }).then(() => {
        setShared(true)
        telemetry?.capture('traceview.shared')
      }).catch(e => alert("Error sharing trace"))
    } else {
      fetch(`/api/v1/trace/${traceId}/shared`, {
        method: 'DELETE'
      }).then(() => {
        setShared(false)
        telemetry?.capture('traceview.unshared')
      }).catch(e => alert("Error unsharing trace"))
    }
  }, [traceId])

  if (!traceId || !isUserLoggedIn) {
    return [false, () => { }]
  }

  return [shared, setRemoteShared]
}

// returns the ID of the trace that comes before the given trace in the list of traces (or null if there is no such trace)
function findPreviousTrace(traceId, traces) {
  for (let i = 0; i < traces.length; i++) {
    if (traces[i] && traces[i].id === traceId) {
      i = i - 1;
      while (i > 0 && !traces[i]) {
        i -= 1
      }
      return traces[i].index
    }
  }
  return null
}

// type for the set of traces returned by search
interface DisplayedTracesRHS {
  'traces': number[]
  'description'?: string
  'severity'?: number
  'icon'?: string
}
type DisplayedTracesT = Record<string, DisplayedTracesRHS>

// flattens the displayed indices into a single list of trace indices
// MAY contain duplicates
function flattenDisplayedIndices(displayedIndices: DisplayedTracesT|null): number[] {
  const flattenedDisplayedIndices : number[] = [];
  if (displayedIndices) {
    const keys = Object.keys(displayedIndices).sort((a, b) => (displayedIndices[b].severity||0)-(displayedIndices[a].severity||0) )
    keys.forEach(key => {
      displayedIndices[key].traces.forEach(index => {
        flattenedDisplayedIndices.push(index)
      })
    })
  }
  return flattenedDisplayedIndices;
}



// hook for interacting with the search functionality
function useSearch() {
  const props: { username: string, datasetname: string, traceIndex: number | null } = useLoaderData() as any
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, _setSearchQuery] = React.useState<string|null>(searchParams.get('query') || null)
  const [displayedIndices, setDisplayedIndices] = React.useState<DisplayedTracesT>({'all': {'traces': []}})
  const [highlightMappings, setHighlightMappings] = React.useState({} as {[key: number]: any})
  interface SearchQuery {
    query: string,
    status: 'waiting' | 'searching' | 'completed',
    date: Date
  }
  const searchQueue = React.useRef<SearchQuery[]>([])
  const searchTimeout = React.useRef<number | null | undefined>(null)
  const searching = searchQueue.current.filter(q => q.status === 'searching').length > 0 || searchTimeout.current !== null

  const search = (query) => {
    if (query.status !== 'waiting') return;
    query.status = 'searching'
    const encodedQuery = encodeURIComponent(query.query);
    return sharedFetch(`/api/v1/dataset/byuser/${props.username}/${props.datasetname}/s?query=${encodedQuery}`)
      .then(data => {
        query.status = 'completed'
        // check that this is still the newest query to complete
        if (searchQueue.current.filter(q => q.status === 'completed' && q.date > query.date).length === 0)
        {
          setHighlightMappings(data.mappings)
          setDisplayedIndices(data.result)
          // remove all queries that are older than this
          searchQueue.current = searchQueue.current.filter(q => q.date >= query.date)
        } else {
          // console.log('discarding result for', query)
        }
        return data
      })
      .catch(e => {
        alert("Error searching traces: " + JSON.stringify(e))
        throw e
      })
  }

  const dispatchSearch = (value) => {
    if (!value || value === '') {
      setDisplayedIndices({'all': {'traces': []}})
      setSearchQuery('')
      searchQueue.current = [{ query: '', status: 'completed', date: new Date() }]
      return
    }
    // add current search objective to the queue
    searchQueue.current.push({
      query: value,
      status: 'waiting',
      date: new Date()
    })
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
    }, 500)
    searchTimeout.current = st
  }

  const setSearchQuery = (value: string | null) => {
    _setSearchQuery(value)
    if (value === null || value === '') {
      searchParams.delete('query')
      setSearchParams(searchParams)
    } else {
      setSearchParams({ ...searchParams, query: value })
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

/**
 * Component for displaying the list of traces in a dataset.
 * 
 * Consists of a Sidebar with a list of traces and an Explorer component for viewing the currently selected trace.
 */
export function Traces() {
  // extract user and dataset name from loader data (populated by site router)
  const props: { username: string, datasetname: string, traceIndex: number | null } = useLoaderData() as any
  // used to navigate to a different trace
  const navigate = useNavigate()
  // load the dataset metadata
  const [dataset, datasetLoadingError] = useDataset(props.username, props.datasetname)
  // feature set enabled for this dataset
  const featureSet = new FeatureSet(dataset?.extra_metadata ? dataset.extra_metadata?.featureset : {})
  // load information about the traces in the dataset
  const [traces, hierarchyPaths, refresh] = useTraces(props.username, props.datasetname)
  // trigger whether share modal is shown
  const [showShareModal, setShowShareModal] = React.useState(false)
  // trigger whether trace deletion modal is shown
  const [showDeleteModal, setShowDeleteModal] = React.useState(false)

  // load the logged in user's information
  const userInfo = useUserInfo()
  // load the sharing status of the active trace (link sharing enabled/disabled)
  const [sharingEnabled, setSharingEnabled] = useTraceShared((traces && props.traceIndex != null) ? traces.get(props.traceIndex)?.id : null, userInfo)
  // load the search state (filtered indices, highlights in shown traces, search query, search setter, search trigger, search status)
  const [displayedIndices, highlightMappings, searchQuery, setSearchQuery, searchNow, searching] = useSearch();
  // tracks whether the current user owns the dataset/trace
  const isUserOwned = userInfo?.id && userInfo?.id == dataset?.user_id
  // tracks the currently selected trace
  const [activeTrace, setActiveTrace] = React.useState(null as Trace | null)

  // when the trace index changes, update the activeTrace
  useEffect(() => {
    // if search or analyzer was run, get the flattened list of results
    const flattenedDisplayedIndices : number[] = flattenDisplayedIndices(displayedIndices);

    if (traces
        && props.traceIndex !== null
        && props.traceIndex !== undefined
        && traces.has(props.traceIndex)
        && (flattenedDisplayedIndices.length == 0 || flattenedDisplayedIndices.includes(props.traceIndex) )
        ) {
      setActiveTrace(traces.get(props.traceIndex))
    } else if (!traces) {
      setActiveTrace(null)
    } else {
      let new_index = 0
      // if the trace index is not in the list of traces, navigate to the first trace
      if (traces && traces.first() != Infinity) new_index = traces.first()
      // if the trace index is not in the list of displayed traces, navigate to the first displayed trace
      if (flattenedDisplayedIndices.length > 0) new_index = flattenedDisplayedIndices[0];
      navigate(`/u/${props.username}/${props.datasetname}/t/${new_index}` + window.location.search + window.location.hash)
    }
  }, [props.traceIndex, traces, displayedIndices])

  // if we switch to a different active trace, update the active trace and actually fetch the selected trace data
  useEffect(() => {
    if (traces && activeTrace && !activeTrace.fetched) {
      fetchTrace(activeTrace).then(change => {
        if (!change.updated) return;
        const t = change.trace;
        if (!t) return;
        // if the trace was updated, replace its spot in the 'traces' object, 
        // to trigger a re-render
        traces.update(t.index, { ...t, fetched: true})
        setActiveTrace({ ...t, fetched: true})
      })
    }
  }, [traces, activeTrace])

  // navigates to the given trace index and refreshes the list of traces
  const navigateToTrace = useCallback((traceIndex: number | null) => {
    navigate(`/u/${props.username}/${props.datasetname}/t/${traceIndex || ''}` + window.location.search + window.location.hash)
    refresh()
  }, [props.username, props.datasetname])

  // error state of this view
  if (datasetLoadingError) {
    return <div className='empty'>
      <h3>Failed to Load Dataset</h3>
    </div>
  } else if (!dataset) {
    return <div className='empty'>
      <h3>Loading...</h3>
    </div>
  }

  const onAnnotationCreate = (traceIndex: number) => {
    const trace = traces?.get(traceIndex);
    if (trace) {
      trace.num_annotations = (trace.num_annotations ?? 0) + 1;
      traces?.update(traceIndex, trace);
    }
  }

  const onAnnotationDelete = (traceIndex: number) => {
    const trace = traces?.get(traceIndex);
    if (trace) {
      if (trace.num_annotations === undefined || trace.num_annotations === 0) return;
      trace.num_annotations = trace.num_annotations - 1;
      traces?.update(traceIndex, trace);
    }
  }

  // whether the trace view shows any trace
  const traceVisible = !searching && (displayedIndices != null)

  // whether there are any traces to show
  const hasTraces = (traces?.indices().length || 0) > 0

  // derive correct empty view to use
  let emptyView: any | null = null
  if (!(hasTraces || !isUserOwned)) {
    if (!traces) {
      emptyView = () => <div className='empty'>Loading...</div>
    } else {
      emptyView = EmptyDatasetInstructions
    }
  }

  // derive whether this is a testing trace
  const isTest = activeTrace?.extra_metadata && typeof activeTrace?.extra_metadata['invariant.num-failures'] === 'number'

  return <div className="panel fullscreen app">
    {/* controls for link sharing */}
    {sharingEnabled != null && showShareModal && <Modal title="Link Sharing" onClose={() => setShowShareModal(false)} hasWindowControls cancelText="Close">
      <ShareModalContent sharingEnabled={sharingEnabled} setSharingEnabled={setSharingEnabled} traceId={activeTrace?.id} traceName={getFullDisplayName(activeTrace)} />
    </Modal>}
    {/* shown when the user confirms deletion of a trace */}
    {isUserOwned && showDeleteModal && <DeleteSnippetModal entityName='trace' snippet={{ id: activeTrace?.id }} setSnippet={(state) => setShowDeleteModal(!!state)} onSuccess={() => navigateToTrace(findPreviousTrace(activeTrace?.id, traces))} />}
    <div className='sidebyside'>
      {/* trace explorer sidebar */}
      {hasTraces && <Sidebar // only show the sidebar if there are traces to show
        traces={traces}
        hierarchyPaths={hierarchyPaths}
        username={props.username}
        datasetname={props.datasetname}
        activeTraceIndex={activeTrace != null ? activeTrace.index : null}
        onRefresh={refresh}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        displayedIndices={displayedIndices}
        searchNow={searchNow}
        searching={searching}
      />}
      {/* actual trace viewer */}
      {<AnnotationAugmentedTraceView
        // information on the currently selected trace
        activeTrace={traceVisible ? activeTrace : null}
        selectedTraceId={activeTrace?.id}
        selectedTraceIndex={activeTrace?.index}
        // shown when no trace is selected
        empty={emptyView}
        collapsed={isTest}
        // current search highlights
        mappings={activeTrace ? highlightMappings[activeTrace.index] : null}
        // whether we are still loading the dataset's trace data
        loading={!traces}
        // header components to show in the explorer
        header={
          <h1>
            <Link to='/'> /</Link>
            <Link to={`/u/${props.username}`}>{props.username}</Link>/
            <Link to={`/u/${props.username}/${props.datasetname}`}>{props.datasetname}</Link>
            {activeTrace && <>/ <Link to={`/u/${props.username}/${props.datasetname}/t/${activeTrace.index}`}><span className='traceid'>{getFullDisplayName(activeTrace)}</span></Link></>}
          </h1>
        }
        is_public={dataset.is_public}
        // callback for when the user presses the 'Share' button
        onShare={sharingEnabled != null ? () => setShowShareModal(true) : null}
        // whether link sharing is enabled for the current trace
        sharingEnabled={sharingEnabled}
        // extra trace action buttons to show
        actions={<>
          {isUserOwned && <button className='danger icon inline' onClick={() => setShowDeleteModal(true)} data-tooltip-id="button-tooltip" data-tooltip-content="Delete Trace"><BsTrash /></button>}
        </>}
        onAnnotationCreate={onAnnotationCreate}
        onAnnotationDelete={onAnnotationDelete}
      />}
    </div>
  </div>
}

/**
 * Displays a search box and search filters.
 */
function SearchBox(props) {
  const searchQuery = props.searchQuery
  const setSearchQuery = props.setSearchQuery

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

  const hasSearch = !props.searching && props.searchQuery != ''

  return <>
    <div className='search'>
      <input className='search-text' type="text" onChange={update} value={searchQuery} placeholder="Search" />
      <button className='search-submit' onClick={hasSearch ? props.onSave : props.searchNow} data-tooltip-id="button-tooltip" data-tooltip-content={hasSearch ? "Save Search" : ""}>
        {!props.searching ? 
          (props.searchQuery == '' ? 
            <BsSearch /> : 
            <BsBookmark />
          ) : null}
        {props.searching && <ClockLoader size={'15px'} className='spinner' />}
      </button>
    </div>
  </>
}

/**
 * Displays the list of traces in a dataset.
 */

function Sidebar(props: { traces: LightweightTraces | null, username: string, datasetname: string, activeTraceIndex: number | null, onRefresh: () => void, searchQuery: string | null, setSearchQuery: (value: string) => void, displayedIndices: DisplayedTracesT | null, searchNow: () => void, searching: boolean, hierarchyPaths: Record<string, HierarchyPath> }) {
  const searchQuery = props.searchQuery
  const setSearchQuery = props.setSearchQuery
  const displayedIndices = props.displayedIndices
  const hierarchyPaths = props.hierarchyPaths
  const { username, datasetname, traces } = props
  const [visible, setVisible] = React.useState(true)
  const [activeIndices, setActiveIndices] = React.useState<DisplayedTracesT>({});

  // ref to HTML element that contains the ViewportList
  const viewportContainerRef = React.useRef(null)
  // ref to ViewportRef instance itself
  const viewport = React.useRef(null as any)

  // initial scroll to active trace completed
  const [scrolled, setScrolled] = React.useState(false)

  // get telemetry instance
  const telemetry = useTelemetry()

  // tracks which hierarchy panels are collapsed
  const [hierarchyCollapsed, setHierarchyCollapsed] = React.useState({} as Record<string, boolean>)

  useEffect(() => {
    if (!traces) {
      setActiveIndices({'all': {'traces': [], 'description': 'all traces'}})
      return;
    }
    
    let chs = hierarchyCollapsed
    Object.keys(hierarchyPaths).forEach(key => {
      if (!chs.hasOwnProperty(key)) {
        chs[key] = false
      }
    })
    setHierarchyCollapsed(chs)

    if (displayedIndices) {      
      if (Object.keys(displayedIndices).length === 1 && 'all' in displayedIndices && displayedIndices['all']['traces'].length == 0) {
        setActiveIndices({'all': {'traces': traces.indices(), 'description': 'all traces'}})
      } else {
        setActiveIndices(displayedIndices)
      }
    }
  }, [displayedIndices, traces])

  const onRefresh = (e) => {
    setSearchQuery('')
    props.onRefresh()
  };

  const onSave = (e) => {
    fetch(`/api/v1/dataset/byuser/${username}/${datasetname}/s`, {
      'method': 'PUT',
      'body': JSON.stringify({
        query: searchQuery,
        name: 'Search: ' + searchQuery
      })
    }).then(() => {
      alert("Saved search")
    })
  }

  const isInvariantGrouping = searchQuery === 'is:invariant';
  const onTriggerInvariantGrouping = (e) => {
    if (!isInvariantGrouping) {
      setSearchQuery('is:invariant');
      telemetry.capture('traceview.search-invariant-grouping', { query: 'is:invariant' })
    } else {
      setSearchQuery('');
    }
  }
  
  const viewItems : React.ReactNode[] = [];

  // maps trace index to its position in the viewItems array
  // which is rendered in the sidebar
  const indexToRenderPosition = new Map<number, number>();

  if (traces) {
    Object.keys(activeIndices).sort((a, b) => (activeIndices[b].severity||0)-(activeIndices[a].severity||0) ).forEach((key) => {
      if (key !== 'all' && activeIndices[key].traces.length > 0) {
        // filtered result (e.g. search of analyzer)
        let icon : React.ReactNode = {'info': <><BsInfo/></>,
                      'tools': <><BsTools/></>,
                      'exclamation': <><BsExclamationLg/></>,
                      'exclamation-large': <><BsExclamationTriangleFill/></>,
                      'search': <><BsSearch/></>,
                      'none': null
        }[activeIndices[key].icon||'none']
        if (activeIndices[key].severity||0 <= 2) {icon = null;}

        viewItems.push(<TraceSearchGroupHeader name={key} count={activeIndices[key].traces.length} description={activeIndices[key].description||''} icon={icon||null} severity={activeIndices[key].severity||0} />);

        const indices = (activeIndices[key].traces || []).sort((a, b) => compareTraces(traces.get(a), traces.get(b)))
        indices.forEach(index => {
          const trace = traces.get(index) || null;
          const path = hierarchyPaths[trace?.hierarchy_path?.join(pathSeparator) || '']
          indexToRenderPosition.set(index, viewItems.length)
          viewItems.push(<TraceRow key={index} path={path} traces={traces} trace={trace} index={index} active={index === props.activeTraceIndex} username={username} datasetname={datasetname} searchQuery={searchQuery} activeTraceIndex={props.activeTraceIndex} level={0} />)
        })
      } else {
        // not-filtered result (default)
        // e.g. key === 'all'
       
        // if we have hierarchy paths, show them first
        const paths = Object.keys(hierarchyPaths).sort().map(key => hierarchyPaths[key])
        paths.forEach(path => {
          if (path.path.length === 0) return; // skip empty paths
          const indices = path.indices.filter(index => activeIndices[key].traces.includes(index)).sort((a, b) => a-b);
          if (indices.length === 0) return; // skip empty paths
          const toggleVisibility = () => {
            setHierarchyCollapsed({...hierarchyCollapsed, [path.slug]: !hierarchyCollapsed[path.slug]})
          }
          // show the hierarchy path
          viewItems.push(<TraceHierarchy key={'hierarchy-'+path.slug} path={path} className={viewItems.length>0 ? 'spacer' : ''} onToggle={toggleVisibility} collapsed={hierarchyCollapsed[path.slug]} />);
          // show the traces in the hierarchy path
          indices.forEach(index => {
            const trace = traces.get(index) || null;
            indexToRenderPosition.set(index, viewItems.length)
            viewItems.push(<TraceRow display={!hierarchyCollapsed[path.slug]} key={index} traces={traces} trace={trace} index={index} active={index === props.activeTraceIndex} username={username} datasetname={datasetname} searchQuery={searchQuery} activeTraceIndex={props.activeTraceIndex} level={1} />)
          })
        })
       
        // show the rest of the traces
        // default path slug is empty string
        if (hierarchyPaths['']?.indices) {
          const indices = hierarchyPaths[''].indices.filter(index => activeIndices[key].traces.includes(index)).sort((a, b) => a-b);
          let first = true;
          indices.forEach(index => {
            const trace = traces.get(index) || null;
            viewItems.push(<TraceRow className={viewItems.length > 0 && first ? 'spacer' : ''} key={index} traces={traces} trace={trace} index={index} active={index === props.activeTraceIndex} username={username} datasetname={datasetname} searchQuery={searchQuery} activeTraceIndex={props.activeTraceIndex} level={0} />)
            first = false
          })
        }
      }
    })
  }
  
  // when the active indices change, scroll to the active trace
  useEffect(() => {
    if (props.activeTraceIndex != null && indexToRenderPosition.has(props.activeTraceIndex)) {
      if (viewport.current && !scrolled) {
        const position = indexToRenderPosition.get(props.activeTraceIndex);
        (viewport.current as any).scrollToIndex({ index: position, offset: 0 })
        setScrolled(true)
      }
    }
  }, [props.activeTraceIndex, activeIndices, viewport, viewItems])


  return <div className={'sidebar ' + (visible ? 'visible' : 'collapsed')}>
    <header>
      <SearchBox setSearchQuery={props.setSearchQuery} searchQuery={props.searchQuery} searchNow={props.searchNow} searching={props.searching} onSave={onSave} />
      {/* <button className='header-short toggle icon' onClick={onRefresh}
        data-tooltip-id="button-tooltip" data-tooltip-content="Refresh">
        <BsArrowClockwise />
      </button> */}
      {!isInvariantGrouping && <button className='header-short toggle icon' onClick={onTriggerInvariantGrouping}
         data-tooltip-id="button-tooltip" data-tooltip-content="Group Traces by Analysis Result">
        <BsFilterCircle/>
      </button>}
      {isInvariantGrouping && <button className='header-short toggle icon' onClick={onTriggerInvariantGrouping}
          data-tooltip-id="button-tooltip" data-tooltip-content="Group Traces by Analysis Result">
          <BsFilterCircleFill/>
      </button>}
      <button className='header-short toggle icon' onClick={() => setVisible(!visible)}
         data-tooltip-id="button-tooltip" data-tooltip-content="Fold Sidebar">
        <BsLayoutSidebarInset />
      </button>
      <SidebarStatus traces={traces} searching={props.searching} activeIndices={activeIndices} />
    </header>
    <ul ref={viewportContainerRef}>
      <ViewportList
        items={!props.searching ? [...viewItems.keys()] : []}
        ref={viewport}
        viewportRef={viewportContainerRef}
        overscan={10}
      >
        {(index: number) => {
          return viewItems[index]
          }
        }
      </ViewportList>

    </ul>
  </div>
}

/** Status message on top of the sidebar list of traces */
function SidebarStatus(props: { traces: LightweightTraces | null, searching: boolean, activeIndices: DisplayedTracesT }) {
  const { traces, searching, activeIndices } = props
  if (traces && !searching) {
    return <h1 className='header-long'>{Object.values(activeIndices).reduce((acc, group) => acc + group.traces.length, 0) + " Traces"}</h1>
  } else {
    return <h1 className='header-long'>{searching ? 'Searching...' : 'Loading...'}</h1>
  }
}

/** A single row in the sidebar list of traces */
function TraceRow(props: { trace: Trace | null, index: number, active: boolean, username: string, datasetname: string, searchQuery: string | null, activeTraceIndex: number | null, traces: LightweightTraces | null, level: number | null, path?: HierarchyPath, className?: string, display?: boolean }) {
  const {index, username, datasetname, searchQuery, traces} = props
  const level = props.level || 0 // indentation level; 0 is no indentation
  const display = (props.display === undefined ? true : props.display) || props.active
  // keep reference to trace
  const [trace, setTrace] = React.useState(props.trace)
  // use the telemetry hook to log user interactions
  const telemetry = useTelemetry()
  
  // load full trace via LightweightTraces object
  useEffect(() => {
    const listener = (trace: Trace) => {
      setTrace(trace)
    }
    traces?.on(index, listener)
    return () => {
      traces?.off(index, listener)
    }
  });

  if (!trace) return <span>...</span>
    
  // if there is a hierarchy path, show it
  let path = (props?.path?.path || []).join(pathSeparator)
  if (path.length > 0) path = path + pathSeparator
  const pathElement = path.length > 0 ? <span className='path'>{path}</span> : null 
  
  const active = trace.index === props.activeTraceIndex
  return <li className={'trace ' + (active ? 'active ' : '') + `level-${level} ` + (props.className||'') + (!display ? ' hidden' : '') }>
    <Link onClick={() => telemetry?.capture('select-trace', { name: trace.name })} to={`/u/${username}/${datasetname}/t/${index}` + (searchQuery ? '?query=' + encodeURIComponent(searchQuery) : '')} className={active ? 'active' : ''}>
      {pathElement}<TraceRowContents trace={trace} />
    </Link>
  </li>
}

/**
 * Contents of an individual trace row in the sidebar list of traces.
 */
function TraceRowContents(props: { trace: Trace }) {
  const trace = props.trace
  const isTest = trace?.extra_metadata && trace?.extra_metadata['invariant.num-failures'] !== undefined
  // check if name is <something>[<params>]
  let name = <span className='name'>{trace.name}</span>
  if (trace.name?.match(/.*\[.*\]$/)) {
    const [test_name, params] = trace.name.split('[')
    name = <><span className='name'>{test_name}</span><span className='params'>[{params}</span></>
  }
  
  if (isTest) {
    const num_warnings = trace?.extra_metadata['invariant.num-warnings'] || 0
    const num_failures = trace?.extra_metadata['invariant.num-failures'] || 0
    const fail = num_failures > 0

    return <>
      {name}
      {/* don't show the annotations badge for test cases */}
      <div className='spacer'/>
      {num_warnings > 0 && <span className='warnings'>{num_warnings} warnings</span>}
      <span className={'test-result ' + (fail ? 'fail' : 'pass')}>{fail ? "FAIL" : "PASS"}</span>
    </>
  } else {
    return <>
      {name}
      {(trace.num_annotations || 0) > 0 ? <span className='badge'>{trace?.num_annotations}</span> : null}
      <div className='spacer'/>
    </>
  }
}

/**
 * Shows a hierarchy path in the sidebar list of traces.
 */
function TraceHierarchy(props: { path: HierarchyPath, className?: string, onToggle: () => void, collapsed: boolean }) {
  const { path, collapsed, onToggle, className } = props;
  return <li className={'trace-hierarchy level-0 ' + className||''} onClick={onToggle}>
      { !collapsed && <BsCaretDownFill onClick={onToggle} />}
      {  collapsed && <BsCaretRightFill onClick={onToggle} /> }
      <span>{path.slug}</span>
  </li>
}


function TraceSearchGroupHeader(props: {name: string, count: number, description: string, icon: React.ReactNode|null, severity: number}) {
  const {name, count, description, icon, severity} = props
  return <li key={name} className={`seperator seperator-severity-${severity||0}`}>
    {icon && <span className='icon'>{icon}</span>}
    <div className='details'>
      <h1>{name} ({count})</h1>
      {description && <h2>{description}</h2>} 
    </div>
    </li>
}

/**
 * Like Traces, but only shows a single trace and thus no sidebar.
 */
export function SingleTrace() {
  // extract the trace ID from the loader data (populated by site router)
  const props: { traceId: string } = useLoaderData() as any
  // the loaded trace data
  const [trace, setTrace] = React.useState(null as Trace | null)
  // the loaded dataset data
  const [dataset, setDataset] = React.useState(null as { name: string } | null)
  // if an error occurs, this will be set to the error message
  const [error, setError] = React.useState(null as string | null)
  // load the logged in user's information
  const userInfo = useUserInfo()
  // whether link sharing is enabled for the current trace
  const [sharingEnabled, setSharingEnabled] = useTraceShared(props.traceId, userInfo)
  const [showShareModal, setShowShareModal] = React.useState(false)
  // only set if we are showing a snippet trace (a trace without dataset)
  const [snippetData, setSnippetData] = React.useState({ isSnippet: false, user: null } as { isSnippet: boolean, user: string | null })
  // trigger whether trace deletion modal is shown
  const [showDeleteModal, setShowDeleteModal] = React.useState(false)
  // used to navigate to a different trace
  const navigate = useNavigate()
  // tracks whether the current user owns this dataset/trace
  const isUserOwned = userInfo?.id && userInfo?.id == trace?.user_id

  // fetch trace data
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

  // fetch dataset metadata
  React.useEffect(() => {
    if (!trace) {
      return
    }

    if (trace.dataset) {
      // depending on permissions, this may not be available
      sharedFetch(`/api/v1/dataset/byid/${trace?.dataset}`).then(data => {
        setDataset(data)
      }).catch(e => { })
    } else {
      // otherwise use trace.user, if available and hide index
      setDataset({ name: trace?.user || '' })
      setSnippetData({ isSnippet: true, user: trace?.user || '' })
    }
  }, [trace])

  // construct header depending on whether we are showing a dataset trace or a snippet trace
  let header = <></>
  if (dataset) {
    header = snippetData.isSnippet ?
      <h1>
        <Link aria-label='path-user'
          to={`/u/${snippetData.user}`}>{snippetData.user}
        </Link>
        <span className='traceid'># {props.traceId}</span>
        <Time className='time'>{trace?.time_created || ''}</Time>
      </h1> :
      <h1>{dataset ? <>
        <Link aria-label='path-user' to={`/u/${trace?.user}`}>{trace?.user} / </Link>
        <Link aria-label='path-dataset' to={`/u/${trace?.user}/${dataset.name}`}>{dataset.name}</Link></> : ""} / <span className='traceid'>{getFullDisplayName(trace)} {props.traceId}</span></h1>
  }

  return <div className="panel fullscreen app">
    {error && <div className='empty'>
      <h3>{error}</h3>
    </div>}
    {isUserOwned && sharingEnabled != null && showShareModal && <Modal title="Link Sharing" onClose={() => setShowShareModal(false)} hasWindowControls cancelText="Close">
      <ShareModalContent sharingEnabled={sharingEnabled} setSharingEnabled={setSharingEnabled} traceId={props.traceId} traceName={getFullDisplayName(trace)} />
    </Modal>}
    {isUserOwned && showDeleteModal && <DeleteSnippetModal snippet={{ id: props.traceId }} setSnippet={(state) => setShowDeleteModal(!!state)} onSuccess={() => navigate('/')} />}
    {!error && <div className='sidebyside'>
      <AnnotationAugmentedTraceView
        activeTrace={trace}
        loading={!trace}
        header={header}
        selectedTraceId={props.traceId}
        onShare={sharingEnabled != null && trace?.user_id == userInfo?.id ? () => setShowShareModal(true) : null}
        sharingEnabled={sharingEnabled}
        actions={<>
          {isUserOwned && <button className='danger icon inline' onClick={() => setShowDeleteModal(true) }><BsTrash /></button>}
        </>}
      />

    </div>}
  </div>
}
