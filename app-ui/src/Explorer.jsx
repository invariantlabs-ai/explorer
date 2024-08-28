import React, { useEffect, useRef, useState } from 'react';
import './Annotations.scss';
import './Explorer.scss';

import { RemoteResource, useRemoteResource } from './RemoteResource';
import { useUserInfo } from './UserInfo';

import { Time } from './components/Time';
import { Metadata } from './lib/metadata';
import { openInPlayground } from './lib/playground';
import { AnnotatedJSON } from './lib/traceview/annotations';
import { RenderedTrace } from './lib/traceview/traceview';

import { BsArrowsCollapse, BsArrowsExpand, BsCaretLeftFill, BsCheck, BsClipboard2CheckFill, BsClipboard2Fill, BsCommand, BsDownload, BsPencilFill, BsShare, BsTerminal, BsTrash, BsViewList } from "react-icons/bs";

class ObservableDict {
  constructor(initial, local_storage_key) {
    this.observers = []
    this.initial = initial
    this.local_storage_key = local_storage_key
    try {
      if (local_storage_key === null) {
        this.dict = initial
      } else {
        this.dict = local_storage_key ? JSON.parse(localStorage.getItem(local_storage_key)) || initial : initial
      }
    } catch (e) {
      this.dict = initial
    }
  }

  onchange(listener) {
    this.observers.push(listener)
  }

  offchange(listener) {
    this.observers = this.observers.filter(l => l !== listener)
  }

  get(key) {
    return this.dict[key]
  }

  keys() {
    return Object.keys(this.dict)
  }

  update(update_fn) {
    const new_dict = update_fn(this.dict)
    this.dict = new_dict
    if (this.local_storage_key) {
      try {
        localStorage.setItem(this.local_storage_key, JSON.stringify(new_dict))
      } catch (e) {
        console.log('Failed to save to local storage')
        localStorage.setItem(this.local_storage_key, JSON.stringify(this.initial))
      }
    }
    this.observers.forEach(listener => listener(new_dict))
  }
}

class ApplicationState {
  constructor() {
    this.data = new ObservableDict({ sourceId: null, importedFiles: {}, dataLoader: '', dataLoaderState: {}, dataLoaders: {} }, null)
    this.query = new ObservableDict({ query: '', python: '', max_items: -1, activeDataset: null, status: '' }, 'query')
    this.endpointCapabilities = new ObservableDict({ endpointSupportsMultipleDatasets: true }, null)
    this.results = new ObservableDict({ results: [] }, null)
    this.editorFocus = new ObservableDict({ isFocused: false }, 'editorFocus')

    this.trace = new ObservableDict({ id: null }, null)
  }
}

class Annotations extends RemoteResource {
  constructor(traceId) {
    super(`/api/v1/trace/${traceId}/annotations`, `/api/v1/trace/${traceId}/annotation`, `/api/v1/trace/${traceId}/annotation`, `/api/v1/trace/${traceId}/annotate`)
    this.traceId = traceId
  }

  transform(data) {
    let annotations = {}
    data.forEach(annotation => {
      if (!(annotation.address in annotations)) {
        annotations[annotation.address] = []
      }
      annotations[annotation.address].push(annotation)
    })
    // sort by timestamp
    for (let address in annotations) {
      annotations[address].sort((a, b) => a.timestamp - b.timestamp)
    }
    return annotations
  }
}

const APPLICATION_STATE = new ApplicationState()

function useAppStatePath(path) {
  let segments = path.split('.')
  if (segments.length < 2) {
    throw new Error("Path must have at least two segments <bucket>.<key>.[...]")
  }
  const bucket = segments[0]
  const key = segments[1]
  const [localCopy, setLocalCopy] = useState(APPLICATION_STATE[bucket].get(segments[1]))

  // traverse object to follow path
  segments = segments.slice(2)

  while (segments.length > 2) {
    localCopy = localCopy[segments.shift()]
  }

  const setValue = (value) => {
    APPLICATION_STATE[bucket].update((dict) => {
      let copy = { ...dict }
      let current = copy
      segments.forEach(segment => {
        current = current[segment]
      })
      current[key] = value
      return copy
    })
  }

  useEffect(() => {
    const listener = (new_dict) => {
      let copy = new_dict
      segments.forEach(segment => {
        copy = copy[segment]
      })
      setLocalCopy(copy[key])
    }
    APPLICATION_STATE[bucket].onchange(listener)
    return () => {
      APPLICATION_STATE[bucket].offchange(listener)
    }
  }, [])

  return [localCopy, setValue]
}

export function Explorer(props) {
  const activeTrace = props.activeTrace || null
  const activeTraceId = props.selectedTraceId || null
  const [events, setEvents] = useState({})
  const [annotations, annotationStatus, annotationsError, annotator] = useRemoteResource(Annotations, activeTraceId)

  // expand all messages
  const onExpandAll = () => {
    events.expandAll?.fire()
  }

  // collapse all messages
  const onCollapseAll = () => {
    events.collapseAll?.fire()
  }

  // when elements change, load trace
  useEffect(() => {
    const trace = activeTrace ? activeTrace.trace : null
    if (trace) {
      props.loadTrace(trace)
    }

  }, [activeTrace])

  // if not trace ID set
  if (activeTraceId === null) {
    return <div className='explorer panel'>
      <div className='empty'>No Trace Selected</div>
    </div>
  }

  const decorator = {
    editorComponent: (props) => <div className="comment-insertion-point">
      <AnnotationThread {...props}
        traceId={activeTraceId} />
    </div>,
    hasHighlight: (address, ...args) => {
      if (annotations && annotations[address] !== undefined) {
        return "highlighted num-" + annotations[address].length
      }
    },
    extraArgs: [activeTraceId]
  }

  return <>
    <header className='toolbar'>
      {props.header}
      <div className='spacer' />
      {props.hasFocusButton && <button className="inline" onClick={() => onFocus(autoexpand)} disabled={!canFocus}>
        <BsViewList /> Scroll To Match (S)</button>}
      <div className='vr' />
      <button className="inline icon" onClick={onCollapseAll}><BsArrowsCollapse /></button>
      <button className="inline icon" onClick={onExpandAll}><BsArrowsExpand /></button>
      <a href={'/api/v1/trace/' + activeTraceId + '?annotated=1'} download={activeTraceId + '.json'}>
        <button className='inline icon' onClick={(e) => {
          e.stopPropagation()
        }}>
          <BsDownload />
        </button>
      </a>
      {props.actions}
      <div className='vr' />
      <button className='inline' onClick={() => openInPlayground(activeTrace?.messages || [])}> <BsTerminal /> Open In Invariant</button>
      {props.onShare && <button className={'inline ' + (props.sharingEnabled ? 'primary' : '')} onClick={props.onShare}>
        {!props.sharingEnabled ? <><BsShare /> Share</> : <><BsCheck /> Shared</>}
      </button>}
    </header>
    <div className='explorer panel traceview'>
      <RenderedTrace
        trace={JSON.stringify(activeTrace?.messages || [], null, 2)}
        // no highlights
        annotations={AnnotatedJSON.from_mappings([])}
        onMount={(events) => setEvents(events)}
        decorator={decorator}
        prelude={<Metadata extra_metadata={activeTrace?.trace?.extra_metadata} header={<div className='role'>Trace Information</div>} />}
      />
    </div>
  </>
}

function CopyToClipboard(props) {
  const { value } = props;
  const title = props.title || 'JSON';
  const appearance = props.appearance || 'compact'
  const [recentlyCopied, setRecentlyCopied] = useState(false)

  useEffect(() => {
    if (recentlyCopied) {
      const timeout = setTimeout(() => setRecentlyCopied(false), 1000)
      return () => clearTimeout(timeout)
    }
  }, [recentlyCopied])

  const { object } = props;
  const onCopy = () => {
    const v = value || JSON.stringify(object, null, 2)
    navigator.clipboard.writeText(v).then(() => setRecentlyCopied(true))
  }

  if (appearance === 'compact') {
    return <button className={'copy ' + (recentlyCopied ? 'recently-copied' : '')} onClick={onCopy} disabled={props.disabled || false}>
      {recentlyCopied ? <BsClipboard2CheckFill /> : <BsClipboard2Fill />}
    </button>
  } else {
    // like a regular button.inline
    return <button className='inline' onClick={onCopy} disabled={props.disabled || false}>
      {recentlyCopied ? <BsClipboard2CheckFill /> : <BsClipboard2Fill />}
      {recentlyCopied ? 'Copied!' : title}
    </button>
  }
}

function AnnotationThread(props) {
  // let [annotations, annotationStatus, annotationsError, annotator] = props.annotations
  const [annotations, annotationStatus, annotationsError, annotator] = useRemoteResource(Annotations, props.traceId)
  let threadAnnotations = (annotations || {})[props.address] || []

  return <div className='annotation-thread'>
    {threadAnnotations.map(annotation => <Annotation {...annotation} annotator={annotator} key={annotation.id} />)}
    <AnnotationEditor address={props.address} traceId={props.traceId} onClose={props.onClose} annotations={[annotations, annotationStatus, annotationsError, annotator]} />
  </div>
}

function Annotation(props) {
  const annotator = props.annotator
  const [comment, setComment] = useState(props.content)
  const [editing, setEditing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const user = props?.user
  const userInfo = useUserInfo()

  const onDelete = () => {
    annotator.delete(props.id).then(() => {
      setComment('')
      annotator.refresh()
    }).catch((error) => {
      alert('Failed to delete annotation: ' + error)
    })
  }

  const onUpdate = () => {
    annotator.update(props.id, { content: comment }).then(() => {
      setSubmitting(false)
      annotator.refresh()
      setEditing(false)
    }).catch((error) => {
      alert('Failed to save annotation: ' + error)
      setSubmitting(false)
    })
  }

  return <div className='annotation'>
    <div className='user'>
      {/* gravat */}
      <img src={"https://www.gravatar.com/avatar/" + user.image_url_hash} />
    </div>
    <div className='bubble'>
      <header className='username'>
        <BsCaretLeftFill className='caret' />
        <div><b>{props.user.username}</b> annotated <span className='time'> <Time>{props.time_created}</Time> </span></div>
        <div className='spacer' />
        <div className='actions'>
          {userInfo?.id == props.user.id && !editing && <button onClick={() => setEditing(!editing)}><BsPencilFill /></button>}
          {userInfo?.id == props.user.id && <button onClick={onDelete}><BsTrash /></button>}
        </div>
      </header>
      {!editing && <div className='content'>{props.content}</div>}
      {editing && <textarea value={comment} onChange={(e) => setComment(e.target.value)} />}
      {editing && <div className='actions'>
        <button onClick={() => setEditing(!editing)}>Cancel</button>
        <button className='primary' disabled={submitting && comment != ''} onClick={onUpdate}>Save</button>
      </div>}
    </div>
  </div>
}

function AnnotationEditor(props) {
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [annotations, annotationStatus, annotationsError, annotator] = props.annotations
  const textareaRef = useRef(null)
  const userInfo = useUserInfo()

  const onSave = () => {
    if (!userInfo?.loggedIn) {
      window.location.href = '/login'
    }

    if (content == '') {
      return
    }

    annotator.create({ address: props.address, content: content }).then(() => {
      setSubmitting(false)
      annotator.refresh()
      setContent('')
    }).catch((error) => {
      alert('Failed to save annotation: ' + error)
      setSubmitting(false)
    })
  }

  // on mount grab focus
  useEffect(() => {
    window.setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
      }
    }, 100)
  }, [textareaRef])

  const onKeyDown = (e) => {
    // on mac cmd+enter, on windows ctrl+enter to save
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      onSave()
    }
    // escape closes
    if (e.key === 'Escape') {
      props.onClose()
    }
  }

  return <div className='annotation'>
    <div className='user'>
      {/* gravat */}
      <img src={"https://www.gravatar.com/avatar/" + "abc"} />
    </div>
    <div className='bubble'>
      <header className='username'>
        <BsCaretLeftFill className='caret' />
        Add Annotation
        <div className='spacer' />
        <div className='actions'>
          <pre style={{ opacity: 0.4 }}>{props.address}</pre>
        </div>
      </header>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} ref={textareaRef} onKeyDown={onKeyDown} />
      <div className='actions'>
        <button className='secondary' onClick={props.onClose}>Close</button>
        <button className='primary' disabled={submitting || content == ''} onClick={onSave}>
          {!userInfo?.loggedIn ? 'Sign Up To Annotate' : (submitting ? 'Saving...' : <>
            Save <span className='shortcut'><BsCommand /> + Enter</span>
          </>)}
        </button>
      </div>
    </div>
  </div>
}