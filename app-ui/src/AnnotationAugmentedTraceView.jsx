import React, { useEffect, useRef, useState } from 'react';
import './Annotations.scss';
import './Explorer.scss';

import { RemoteResource, useRemoteResource } from './RemoteResource';
import { useUserInfo } from './UserInfo';

import { Time } from './components/Time';
import { Metadata } from './lib/metadata';
import { openInPlayground } from './lib/playground';
import { HighlightedJSON } from './lib/traceview/highlights';
import { RenderedTrace } from './lib/traceview/traceview';

import { BsArrowsCollapse, BsArrowsExpand, BsCaretLeftFill, BsCheck, BsClipboard2CheckFill, BsClipboard2Fill, BsCommand, BsDownload, BsPencilFill, BsShare, BsTerminal, BsTrash, BsViewList } from "react-icons/bs";

/**
 * CRUD manager (RemoteResource) for trace annotations.
 */
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

/**
 * Components that renders agent traces with the ability for user's to add comments ("annotation").
 */
export function AnnotationAugmentedTraceView(props) {
  // the rendered trace
  const activeTrace = props.activeTrace || null
  // the trace ID
  const activeTraceId = props.selectedTraceId || null
  // event hooks for the traceview to expand/collapse messages
  const [events, setEvents] = useState({})
  // loads and manages annotations as a remote resource (server CRUD)
  const [annotations, annotationStatus, annotationsError, annotator] = useRemoteResource(Annotations, activeTraceId)

  // expand all messages
  const onExpandAll = () => {
    events.expandAll?.fire()
  }

  // collapse all messages
  const onCollapseAll = () => {
    events.collapseAll?.fire()
  }

  // if no trace ID set
  if (activeTraceId === null) {
    return <div className='explorer panel'>
      <div className='empty'>No Trace Selected</div>
    </div>
  }

  // decorator for the traceview, to show annotations and annotation thread in the traceview
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

  // add annotations of a character range format (e.g. "messages.0.content:5-9") into mappings
  let mappings = props.mappings || {}
  for (let key in annotations) {
    let substr = key.substring(key.indexOf(":"))
    if (substr.match(/:\d+-\d+/)) {
      for (let index in annotations[key]) { // TODO: what do multiple indices here mean{
        mappings[key] = {"content": annotations[key][index].content}
        if (annotations[key][index].extra_metadata) {
          mappings[key]["source"] = annotations[key][index].extra_metadata.source || "unknown"
        }
      }
    }
  }

  return <>
    <header className='toolbar'>
      {props.header}
      <div className='spacer' />
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
        // the trace events
        trace={JSON.stringify(activeTrace?.messages || [], null, 2)}
        // ranges to highlight (e.g. because of analyzer or search results)
        highlights={HighlightedJSON.from_mappings(mappings)}
        // callback to register events for collapsing/expanding all messages
        onMount={(events) => setEvents(events)}
        // extra UI decoration (inline annotation editor)
        decorator={decorator}
        // extra UI to show at the top of the traceview like metadata
        prelude={<Metadata extra_metadata={activeTrace?.extra_metadata || activeTrace?.trace?.extra_metadata} header={<div className='role'>Trace Information</div>} />}
      />
    </div>
  </>
}

// AnnotationThread renders a thread of annotations for a given address in a trace (shown inline)
function AnnotationThread(props) {
  // let [annotations, annotationStatus, annotationsError, annotator] = props.annotations
  const [annotations, annotationStatus, annotationsError, annotator] = useRemoteResource(Annotations, props.traceId)
  let threadAnnotations = (annotations || {})[props.address] || []

  return <div className='annotation-thread'>
    {threadAnnotations.map(annotation => <Annotation {...annotation} annotator={annotator} key={annotation.id} />)}
    <AnnotationEditor address={props.address} traceId={props.traceId} onClose={props.onClose} annotations={[annotations, annotationStatus, annotationsError, annotator]} />
  </div>
}

// Annotation renders an annotation bubble with the ability to edit and delete
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

// AnnotationEditor renders an inline annotation editor for a given address in a trace (for creating a new annotation).
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