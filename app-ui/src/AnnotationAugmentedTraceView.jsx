import React, { useEffect, useRef, useState } from 'react';
import './Annotations.scss';
import './Explorer.scss';

import { RemoteResource, useRemoteResource } from './RemoteResource';
import { useUserInfo } from './UserInfo';

import { Time } from './components/Time';
import { Metadata } from './lib/metadata';
import { AnalysisResult } from './lib/analysis_result';
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
 * 
 * @param {Object} props
 * @param {Object} props.activeTrace - the trace to render
 * @param {string} props.selectedTraceId - the trace ID
 * @param {number} props.selectedTraceIndex - the trace index
 * @param {Object} props.mappings - the mappings to highlight in the traceview
 * @param {Function} props.onShare - callback to share the trace
 * @param {boolean} props.sharingEnabled - whether the trace is shared
 * @param {Function} props.onAnnotationCreate - callback to update annotations count on the Sidebar
 * @param {Function} props.onAnnotationDelete - callback to update annotations count on the Sidebar
 * @param {React.Component} props.header - the header component (e.g. <user>/<dataset>/<trace> links)
 * @param {React.Component} props.actions - the actions component (e.g. share, download, open in playground)
 * @param {React.Component} props.empty - the empty component to show if no trace is selected/specified (default: "No trace selected")
 */
export function AnnotationAugmentedTraceView(props) {
  // the rendered trace
  const activeTrace = props.activeTrace || null
  // the trace ID
  const activeTraceId = props.selectedTraceId || null
  // the trace index
  const activeTraceIndex = props.selectedTraceIndex;
  // event hooks for the traceview to expand/collapse messages
  const [events, setEvents] = useState({})
  // loads and manages annotations as a remote resource (server CRUD)
  const [annotations, annotationStatus, annotationsError, annotator] = useRemoteResource(Annotations, activeTraceId)

  // highlights to show in the traceview (e.g. because of analyzer or search results)
  const [highlights, setHighlights] = useState(HighlightedJSON.empty())
  // filtered annotations (without analyzer annotations)
  const [filtered_annotations, setFilteredAnnotations] = useState({})
  // errors from analyzer annotations
  const [errors, setErrors] = useState([])
  // Callback functions to update annotations count on the Sidebad.
  const { onAnnotationCreate, onAnnotationDelete } = props;

  // record is the trace expanded to decide show "expand all" or "collapse all" button
  const [is_all_expanded,setAllExpand] = useState(true);

  // expand all messages
  const onExpandAll = () => {
    setAllExpand(true);
    events.expandAll?.fire();

  }

  // collapse all messages
  const onCollapseAll = () => {
    setAllExpand(false);
    events.collapseAll?.fire()
  }

  // whenever activeTrace changed, the trace is defaultly expanded, set the button to be collapse
  useEffect(()=>{
    setAllExpand(true);
  },[activeTrace])

  // whenever annotations change, update mappings
  useEffect(() => {
    // collect annotations of a character range format (e.g. "messages.0.content:5-9") into mappings
    const mappings = Object.assign({}, props.mappings) || {}
    // collect errors from analyzer annotations
    const errors = []

    for (let key in annotations) {
      for (let annotation of annotations[key]) {
        if (annotation.extra_metadata && annotation.extra_metadata["source"] == "analyzer") {
          try {
            const contentJson = JSON.parse(annotation.content);
            if (contentJson["errors"]) {
              for (let error of contentJson["errors"]) {
                errors.push({ "type": error["args"][0], "count": error["ranges"].length })
              }
            }
          } catch (error) {
            continue; // Skip if annotation.content is not valid JSON
          }
        }
      }

      // mappings
      let substr = key.substring(key.indexOf(":"))
      if (substr.match(/:\d+-\d+/)) {
        for (let annotation of annotations[key]) { // TODO: what do multiple indices here mean{
          mappings[key] = { "content": annotation.content }
          if (annotation.extra_metadata) {
            mappings[key]["source"] = annotation.extra_metadata.source || "unknown"
          }
        }
      }
    }

    // Filter all annotations with "analyzer" as source from all the keys
    // NOTE: Long term might be good to separate analysis results from the other annotations to avoid this kind of filtering logic
    let filtered_annotations = {}
    for (let key in annotations) {
      let new_annotations = annotations[key].filter(annotation =>
        !(annotation.extra_metadata && annotation.extra_metadata["source"] === "analyzer")
      );
      if (new_annotations.length > 0) {
        filtered_annotations[key] = new_annotations
      }
    }
    setHighlights(HighlightedJSON.from_mappings(mappings))
    setErrors(errors)
    setFilteredAnnotations(filtered_annotations)
  }, [annotations, props.mappings])

  // filter to hide analyzer messages in annotation threads
  const noAnalyzerMessages = (a) => !a.extra_metadata || a.extra_metadata.source !== "analyzer"

  // decorator for the traceview, to show annotations and annotation thread in the traceview
  const decorator = {
    editorComponent: (props) => <div className="comment-insertion-point">
      <AnnotationThread {...props} filter={noAnalyzerMessages} traceId={activeTraceId} traceIndex={activeTraceIndex} onAnnotationCreate={onAnnotationCreate} onAnnotationDelete={onAnnotationDelete} />
    </div>,
    hasHighlight: (address, ...args) => {
      if (filtered_annotations && filtered_annotations[address] !== undefined) {
        return "highlighted num-" + filtered_annotations[address].length
      }
    },
    extraArgs: [activeTraceId]
  }

  return <>
    <header className='toolbar'>
      {props.header}
      <div className='spacer' />
      <div className='vr' />
      {activeTrace && <>
      {is_all_expanded?(
        <button className="inline icon" onClick={onCollapseAll} data-tooltip-id="button-tooltip" data-tooltip-content="collapse all"><BsArrowsCollapse /></button>        
      ) : (
        <button className="inline icon" onClick={onExpandAll} data-tooltip-id="button-tooltip" data-tooltip-content="expand all"><BsArrowsExpand /></button>
      )}
      <a href={'/api/v1/trace/' + activeTraceId + '?annotated=1'} download={activeTraceId + '.json'}>
        <button className='inline icon' onClick={(e) => {
          e.stopPropagation()
        }}
        data-tooltip-id="button-tooltip" 
        data-tooltip-content="download"
        >
          <BsDownload />
        </button>
      </a>
      {props.actions}
      <div className='vr' />
      <button className='inline' onClick={() => openInPlayground(activeTrace?.messages || [])}> <BsTerminal /> Open In Invariant</button>
      {props.onShare && <button className={'inline ' + (props.sharingEnabled ? 'primary' : '')} onClick={props.onShare}>
        {!props.sharingEnabled ? <><BsShare /> Share</> : <><BsCheck /> Shared</>}
      </button>}
      </>}
    </header>
    <div className='explorer panel traceview'>
      <TraceViewContent empty={props.empty} activeTrace={activeTrace} activeTraceId={activeTraceId} highlights={highlights} errors={errors} decorator={decorator} setEvents={setEvents}/>
    </div>
  </>
}

/**
 * Show the rendered trace or an `props.empty` component if no trace is selected.
 */
function TraceViewContent(props) {
  const { activeTrace, activeTraceId, highlights, errors, decorator, setEvents } = props
  const EmptyComponent = props.empty || (() => <div className='empty'>No trace selected</div>)
  
  // if no trace ID set
  if (activeTraceId === null) {
    return <div className='explorer panel'>
      <EmptyComponent/>
    </div>
  }
  return <RenderedTrace
      // the trace events
      trace={JSON.stringify(activeTrace?.messages || [], null, 2)}
      // ranges to highlight (e.g. because of analyzer or search results)
      highlights={highlights}
      // callback to register events for collapsing/expanding all messages
      onMount={(events) => setEvents(events)}
      // extra UI decoration (inline annotation editor)
      decorator={decorator}
      // extra UI to show at the top of the traceview like metadata
      prelude={
        <>
          <Metadata extra_metadata={activeTrace?.extra_metadata || activeTrace?.trace?.extra_metadata} header={<div className='role'>Trace Information</div>} />
          {errors.length > 0 && <AnalysisResult errors={errors} />}
        </>
      }
    />
}

// AnnotationThread renders a thread of annotations for a given address in a trace (shown inline)
function AnnotationThread(props) {
  // let [annotations, annotationStatus, annotationsError, annotator] = props.annotations
  const [annotations, annotationStatus, annotationsError, annotator] = useRemoteResource(Annotations, props.traceId)
  const { onAnnotationCreate, onAnnotationDelete } = props
  let threadAnnotations = (annotations || {})[props.address] || []

  return <div className='annotation-thread'>
    {threadAnnotations.filter(a => props.filter ? props.filter(a) : true).map(annotation => <Annotation {...annotation} annotator={annotator} key={annotation.id} traceIndex={props.traceIndex} onAnnotationDelete={onAnnotationDelete} />)}
    <AnnotationEditor address={props.address} traceId={props.traceId} traceIndex={props.traceIndex} onClose={props.onClose} annotations={[annotations, annotationStatus, annotationsError, annotator]} onAnnotationCreate={onAnnotationCreate} />
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
      if (props.onAnnotationDelete) {
        props.onAnnotationDelete(props.traceIndex);
      }
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
      if (props.onAnnotationCreate) {
        props.onAnnotationCreate(props.traceIndex);
      }
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