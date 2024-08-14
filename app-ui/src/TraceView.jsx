import { useState, useEffect, useRef, useCallback, act } from 'react'
import './TraceView.scss'
import React from 'react'

import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import Select from 'react-select'
import Editor from '@monaco-editor/react';
import { useStreamingEndpoint, StreamingFetch } from './streaming';
import {useUserInfo} from './UserInfo';

import { BsArrowReturnRight, BsArrowsCollapse, BsArrowsExpand, BsCaretDownFill, BsCaretRightFill, BsChatFill, BsCheck, BsClipboard2, BsClipboard2CheckFill, BsClipboard2Fill, BsCodeSquare, BsCommand, BsDatabase, BsExclamationCircleFill, BsFillGearFill, BsFillPuzzleFill, BsFillTerminalFill, BsGridFill, BsLightbulb, BsLightbulbFill, BsMagic, BsQuestionCircleFill, BsRobot, BsShare, BsSignpost2Fill, BsStop, BsTools, BsTrash, BsViewList, BsWindows } from "react-icons/bs";

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

class RemoteResource {
  constructor(fetchUrl, updateUrl, deleteUrl, createUrl) {
    this.fetchUrl = fetchUrl
    this.updateUrl = updateUrl
    this.deleteUrl = deleteUrl
    this.createUrl = createUrl

    this.status = 'initialized'
    this.data = null

    this.onLoadedPromises = []
    this.onDataChangeListeners = []
    this.errorListeners = [console.error]
  }

  onErrors(listener) {
    this.errorListeners.push(listener)
  }

  offErrors(listener) {
    this.errorListeners = this.errorListeners.filter(l => l !== listener)
  }

  onDataChange(listener) {
    this.onDataChangeListeners.push(listener)
  }

  offDataChange(listener) {
    this.onDataChangeListeners = this.onDataChangeListeners.filter(l => l !== listener)
  }

  refresh() {
    return this.fetch()
      .then(data => { }, error => { })
      .catch(error => this.errorListeners.forEach(listener => listener("Failed to refresh: " + error)))
  }

  fetch() {
    return new Promise((resolve, reject) => {
      // if already loading, just add listener
      if (this.status == 'loading') {
        this.onLoadedListeners.push({ resolve, reject })
        return
      }
      this.status = 'loading'
      this.onLoadedPromises.push({ resolve, reject })

      fetch(endpoint(this.fetchUrl), {
        method: 'GET'
      })
        .then(response => {
          if (response.status != 200) {
            throw new Error('Server responded with status ' + response.status)
          }
          return response.json()
        })
        .then(data => {
          data = this.transform(data)
          this.data = data
          this.status = 'ready'
          this.onLoadedPromises.forEach(({ resolve }) => resolve(data))
          this.onDataChangeListeners.forEach(listener => listener(data))
        })
        .catch((error) => {
          this.errorListeners.forEach(listener => listener(error))
          this.status = 'error'
          this.onLoadedPromises.forEach(({ reject }) => reject(error))
          this.onDataChangeListeners.forEach(listener => listener(null))
        });
    })
  }

  transform(data) {
    return data
  }

  update(elementId, object) {
    if (!this.updateUrl) {
      throw new Error('Update not supported')
    }

    return new Promise((resolve, reject) => {
      fetch(endpoint(this.updateUrl + '/' + elementId), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(object)
      })
        .then(response => {
          if (response.status != 200) {
            throw new Error('Server responded with status ' + response.status)
          }
          return response.json
        })
        .then(data => {
          resolve(data)
        })
        .catch((error) => {
          this.errorListeners.forEach(listener => listener(error))
          reject(error)
        })
    })
  }

  delete(elementId) {
    if (!this.deleteUrl) {
      throw new Error('Delete not supported')
    }

    return new Promise((resolve, reject) => {
      fetch(endpoint(this.deleteUrl + '/' + elementId), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        }
      }).then(response => {
        if (response.status != 200) {
          throw new Error('Server responded with status ' + response.status)
        }
        return response.json()
      }).then(data => {
        resolve(data)
      })
        .catch((error) => {
          this.errorListeners.forEach(listener => listener(error))
          reject(error)
        })
    })
  }

  create(object) {
    if (!this.createUrl) {
      throw new Error('Create not supported')
    }

    return new Promise((resolve, reject) => {
      fetch(endpoint(this.createUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(object)
      })
        .then(response => response.json())
        .then(data => {
          resolve(data)
        })
        .catch((error) => {
          this.errorListeners.forEach(listener => listener(error))
          reject(error)
        })
    })
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
      annotations[annotation.address] = annotation
    })
    return annotations
  }
}

// cached set of data loaders
const RESOURCE_LOADERS = {}

function useRemoteResource(DataLoaderConstructor, ...args) {
  const [dataLoader, setDataLoader] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  useEffect(() => {
    // if args are null
    if (args.some(a => a === null)) {
      setStatus('uninitialized')
      return
    }

    // first, check if we have a data loader for this constructor
    const key = DataLoaderConstructor.name + JSON.stringify(args)
    let _dataLoader = null
    if (RESOURCE_LOADERS[key]) {
      _dataLoader = RESOURCE_LOADERS[key]
      setDataLoader(_dataLoader)

      // register data change listener
      _dataLoader.onDataChange(setData)

      // check if already loaded
      if (_dataLoader.status == 'ready') {
        setStatus('ready')
        setData(_dataLoader.data)
      }

      return () => _dataLoader.offDataChange(setData)
    } else {
      _dataLoader = new DataLoaderConstructor(...args)
      RESOURCE_LOADERS[key] = _dataLoader
      setDataLoader(_dataLoader)

      // check if already loaded
      if (_dataLoader.status == 'ready') {
        setStatus('ready')
        setData(_dataLoader.data)
        return
      }

      // then initialize the data loader
      _dataLoader.fetch().then(data => {
        setStatus('ready')
        setData(data)
      }).catch((error) => {
        setError(error)
        setStatus('error')
        setData(null)
      })

      return () => _dataLoader.offDataChange(setData)
    }
  }, [args])

  return [data, status, error, dataLoader]
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

function endpoint(url) {
  const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
  if (isDev) {
    return "https://localhost" + url;
  }

  return url;
}

class ErrorHandlingComponent extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, errorInfo: null }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error: error, errorInfo: errorInfo })
  }

  render() {
    if (this.state.errorInfo) {
      return (
        <div>
          <h2>Something went wrong.</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo.componentStack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

class HighlightListener {
  constructor(svgElement) {
    let parent = svgElement.parentElement;

    // clear svg
    svgElement.innerHTML = ''

    let parentRect = parent.getBoundingClientRect()

    let listener = []
    let boxes = {}

    parent.querySelectorAll(".highlight").forEach(e => {
      let hoverClass = e.className.split(' ').filter(c => c.startsWith('hover-'))[0]

      let rect = e.getBoundingClientRect()
      let x = rect.x - parentRect.x
      let y = rect.y - parentRect.y + parent.scrollTop;
      let width = rect.width
      let height = rect.height

      if (!boxes[hoverClass]) {
        boxes[hoverClass] = []
      }
      boxes[hoverClass].push({ x, y, width, height })

      const onMouseOver = () => {
        parent.className = parent.className.split(' ').filter(c => !c.startsWith('hover-')).join(' ')
        parent.classList.add(hoverClass)
      }
      e.addEventListener('mouseover', onMouseOver, { passive: true })

      let onClick = null;
      if (!e.classList.contains('shiftclick')) {
        onClick = (event) => {
          parent.classList.toggle('keep-highlight')
          event.stopPropagation()
          this.onChangeListeners.forEach(listener => listener(parent.classList.contains('keep-highlight') ? hoverClass : null))
        }
        e.addEventListener('click', onClick, { passive: true })
      } else {
        onClick = (event) => {
          if (event.shiftKey) {
            parent.classList.toggle('keep-highlight')
            event.stopPropagation()
            event.preventDefault()
            this.onChangeListeners.forEach(listener => listener(parent.classList.contains('keep-highlight') ? hoverClass : null))
          }
        };
        e.addEventListener('click', onClick, { passive: true })
      }

      const onMouseOut = () => {
        if (!parent.classList.contains('keep-highlight')) {
          parent.className = parent.className.split(' ').filter(c => !c.startsWith('hover-')).join(' ')
          parent.classList.remove(hoverClass)
        }
      }
      e.addEventListener('mouseout', onMouseOut, { passive: true })

      listener.push({ element: e, listener: onMouseOver })
      listener.push({ element: e, listener: onMouseOut })
      listener.push({ element: e, listener: onClick })
    })

    this.listener = listener
    this.onChangeListeners = []
    this.parent = parent
  }

  getCurrentHightlightIndex() {
    if (this.parent.classList.contains('keep-highlight')) {
      const names = this.parent.className.split(' ').filter(c => c.startsWith('hover-')).map(c => c.split('-')[1]);
      return names.length > 0 ? names[0] : null
    }
    return null;
  }

  clearHighlights() {
    this.parent.className = this.parent.className.split(' ').filter(c => !c.startsWith('hover-')).join(' ')
    this.parent.classList.remove('keep-highlight')
    this.onChangeListeners.forEach(listener => listener(null))
  }

  clear() {
    this.listener.forEach(({ element, listener }) => {
      element.removeEventListener('mouseover', listener)
      element.removeEventListener('click', listener)
      element.removeEventListener('mouseout', listener)
    })
  }

  onChange(listener) {
    this.onChangeListeners.push(listener)
  }

  offChange(listener) {
    this.onChangeListeners = this.onChangeListeners.filter(l => l !== listener)
  }
}

function updateBackground(svgElement) {
  let parent = svgElement.parentElement;
  // clear svg
  svgElement.innerHTML = ''

  let parentRect = parent.getBoundingClientRect()
  let messages = Array.from(parent.querySelectorAll(".message:last-child"))
  // get max y from last message
  if (messages.length == 0) {
    return
  }
  let lastMessage = messages[messages.length - 1]
  let contentHeight = 100
  if (lastMessage) {
    let lastMessageRect = lastMessage.offsetTop + lastMessage.offsetHeight
    contentHeight = lastMessageRect + 100
  }

  let boxes = {}

  parent.querySelectorAll("span.dot.highlight").forEach(e => {
    let hoverClass = e.className.split(' ').filter(c => c.startsWith('hover-'))[0]

    let rect = e.getBoundingClientRect()
    let x = rect.x - parentRect.x
    let y = rect.y - parentRect.y + parent.scrollTop;
    let width = rect.width
    let height = rect.height

    if (!boxes[hoverClass]) {
      boxes[hoverClass] = []
    }
    boxes[hoverClass].push({ x, y, width, height })
  })

  // big dark rect in the background
  let background = document.createElementNS("http://www.w3.org/2000/svg", "rect")
  background.setAttribute('x', 0)
  background.setAttribute('y', 0)
  background.setAttribute('width', parentRect.width)
  background.setAttribute('height', contentHeight)
  // background.setAttribute('class', 'background')
  background.setAttribute('fill', 'rgba(0, 0, 0, 0.0)')
  svgElement.appendChild(background)

  let rects = []

  Object.keys(boxes).forEach(hoverClass => {
    let lastPoint = { x: -1, y: 0 }
    const members = boxes[hoverClass]
    members.forEach(box => {
      let rect = document.createElementNS("http://www.w3.org/2000/svg", "rect")
      rect.setAttribute('x', box.x)
      rect.setAttribute('y', box.y)
      rect.setAttribute('width', box.width)
      rect.setAttribute('height', box.height)
      rect.setAttribute('class', 'highlight-rect ' + hoverClass)
      // corner radius
      rect.setAttribute('rx', 5)
      rects.push(rect)

      if (lastPoint.x != -1) {
        let line = document.createElementNS("http://www.w3.org/2000/svg", "path")
        line.setAttribute('d', `M ${lastPoint.x} ${lastPoint.y} C ${lastPoint.x} ${(lastPoint.y + box.y + box.height / 2) / 2} ${box.x + box.width / 2} ${(lastPoint.y + box.y + box.height / 2) / 2} ${box.x + box.width / 2} ${box.y + box.height / 2}`)
        line.setAttribute('class', 'highlight ' + hoverClass)

        // no fill
        line.setAttribute('fill', 'none')
        svgElement.appendChild(line)
      }

      lastPoint = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })
  })

  // add all rects
  rects.forEach(rect => svgElement.appendChild(rect))

  // resize to full height
  svgElement.setAttribute('height', contentHeight)
}

function useOnMouseFocus() {
  const element = useRef(null)
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    const current = element.current
    if (!current) {
      return
    }

    const onMouseOver = () => {
      setIsFocused(true)
    }
    const onMouseOut = () => {
      setIsFocused(false)
    }

    current.addEventListener('mouseover', onMouseOver)
    current.addEventListener('mouseout', onMouseOut)

    return () => {
      current.removeEventListener('mouseover', onMouseOver)
      current.removeEventListener('mouseout', onMouseOut)
    }
  }, [element])

  return [element, isFocused]
}

export function Explorer(props) {
  const activeTrace = props.activeTrace || null
  const queryId = props.queryId
  const activeTraceId = props.selectedTraceId || null
  const loading = props.loading

  // keeps track of the selected message
  const [selectedMessageHighlights, setSelectedMessageHighlights] = useState({})
  
  // keeps track of what is collapsed
  const [allCollapsedMessages, setAllCollapsedMessage] = useState({})
  const collapsedMessages = allCollapsedMessages[activeTraceId] || {}
  const setCollapsedMessage = useCallback((value) => {
    setAllCollapsedMessage({ ...allCollapsedMessages, [activeTraceId]: value })
  }, [allCollapsedMessages, activeTraceId])

  const [editorIsFocused, setEditorIsFocused] = useAppStatePath('editorFocus.isFocused')
  
  // keeps track of the scroll position
  const [scrollPositions, setScrollPositions] = useState({})
  const [scrollElement, isMouseFocused] = useOnMouseFocus()
  
  // keeps track of the users focus
  const isFocused = !editorIsFocused && isMouseFocused;
  
  // keeps track of highlighted flows
  const [highlightedFlowIndex, setHighlightedFlowIndex] = useState(null)
  const [clearHighlightedFlowAction, setClearHighlightedFlowAction] = useState(() => { })

  // clear scroll positions when session changes (e.g. different query or category)
  useEffect(() => {
    setScrollPositions({})
  }, [queryId])

  // on scroll update scroll position for selected element
  const onScroll = useCallback((event) => {
    let newScrollPositions = { ...scrollPositions }
    newScrollPositions[activeTraceId] = event.target.scrollTop
    setScrollPositions(newScrollPositions)
  }, [scrollPositions, activeTraceId])

  // whether to autoexpand on focus
  const [autoexpand, setAutoexpand] = useState(true)
  const backgroundElement = useRef(this)

  // clear expanded states when elements change
  useEffect(() => setCollapsedMessage({}), [queryId])

  // collapse all messages
  const onCollapseAll = () => {
    let updatedCollapsedMessages = {}
    activeTrace.messages.forEach((message, index) => {
      updatedCollapsedMessages[index] = true
    })
    setCollapsedMessage(updatedCollapsedMessages)
    window.setTimeout(() => updateBackground(backgroundElement.current), 0)
  }

  // collapse all on C, expand all on E
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!isFocused) {
        return;
      }

      if (event.key === 'w') {
        onCollapseAll()
      } else if (event.key === 'e') {
        onExpandAll()
      } else if (event.key === 's') {
        onFocus(autoexpand)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeTrace, activeTraceId, allCollapsedMessages, autoexpand, isFocused])

  // expand all messages
  const onExpandAll = () => {
    setCollapsedMessage({})
    window.setTimeout(() => updateBackground(backgroundElement.current), 0)
  }

  // whether the 'scroll to match' button is enabled
  const canFocus = Object.keys(selectedMessageHighlights).length > 0

  // scroll to match
  const onFocus = useCallback((expand) => {
    // collapse all messages except the ones with highlights
    let updatedCollapsedMessages = {}
    let firstSelectedMessage = null;

    activeTrace.messages.forEach((message, index) => {
      const hasHighlights = (selectedMessageHighlights[index] && selectedMessageHighlights[index].length > 0) || (message.invariant_highlight >= 0) || (message.tool_calls && message.tool_calls.length > 0 && message.tool_calls[0].invariant_highlight)

      if (hasHighlights) {
        updatedCollapsedMessages[index] = false
        if (firstSelectedMessage === null) {
          firstSelectedMessage = index
        }
      } else {
        updatedCollapsedMessages[index] = true
      }
    })

    if (expand) {
      setCollapsedMessage(updatedCollapsedMessages)
    }
    window.setTimeout(() => updateBackground(backgroundElement.current), 0)
    // scroll to first selected message
    if (firstSelectedMessage !== null) {
      window.setTimeout(() => {
        const messageElement = document.getElementById('msg' + firstSelectedMessage)
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest', inlineTop: 'nearest' })
      }, 20)
    }
  }, [activeTrace, activeTraceId, selectedMessageHighlights])

  // on selected element change, update highlights
  useEffect(() => {
    const messages = activeTrace ? activeTrace.messages : []

    let highlights = {}
    messages.forEach((message, index) => {
      highlights[index] = getHighlights(message)
    })
    setSelectedMessageHighlights(highlights)

    // if not yet opened, autofocus
    if (!scrollPositions[activeTraceId]) {
      window.setTimeout(() => {
        scrollElement.current.scrollTop = 0;
      }, 0)
    } else if (scrollElement.current) {
      window.setTimeout(() => {
        scrollElement.current.scrollTop = scrollPositions[activeTraceId];
        updateBackground(backgroundElement.current);
      }, 0)
    }
  }, [activeTraceId, queryId])

  // clear highlights on element change
  useEffect(() => {
    if (clearHighlightedFlowAction) {
      clearHighlightedFlowAction.fct();
    }
  }, [activeTraceId])

  // // on render of message change, update background
  // useEffect(() => {
  //   let listener = new HighlightListener(backgroundElement.current)
  //   setHighlightedFlowIndex(listener.getCurrentHightlightIndex())
  //   listener.onChange((hoverClass) => {
  //     if (hoverClass) {
  //       setHighlightedFlowIndex(hoverClass.split('-')[1])
  //     } else {
  //       setHighlightedFlowIndex(null)
  //     }
  //   })

  //   setClearHighlightedFlowAction({fct: () => {
  //     console.log("clearing highlights")
  //     listener.clearHighlights();
  //   }})

  //   window.setTimeout(() => updateBackground(backgroundElement.current), 0)

  //   // also on window resize
  //   let resizeListener = () => updateBackground(backgroundElement.current);
  //   window.addEventListener('resize', resizeListener);

  //   return () => {
  //     listener.clear();
  //     window.removeEventListener('resize', resizeListener);
  //   }
  // }, [selectedElement, allCollapsedMessages])

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

  const trace = activeTrace ? activeTrace.trace : null

  return <>
    <header className='toolbar'>
      {props.header}
      <div className='spacer' />
      {props.hasFocusButton && <button className="inline" onClick={() => onFocus(autoexpand)} disabled={!canFocus}>
        <BsViewList /> Scroll To Match (S)</button>}
      <div className='vr' />
      <button className="inline icon" onClick={onCollapseAll}><BsArrowsCollapse /></button>
      <button className="inline icon" onClick={onExpandAll}><BsArrowsExpand /></button>
      <CopyToClipboard object={(activeTrace || {})["messages"]} appearance='toolbar' disabled={activeTrace === undefined} />
      <div className='vr' />
      {props.onShare && <button className={'inline ' + (props.sharingEnabled ? 'primary' : '')} onClick={props.onShare}>
        {!props.sharingEnabled ? <><BsShare/> Share</> : <><BsCheck/> Shared</>}
      </button>}
    </header>
    <div className='explorer panel'>
      {/* hierarchical selector of traces and then messages within traces */}
      <PanelGroup autoSaveId="agentql-layout-explorer" direction="horizontal">
        {/* <Panel defaultSize={10} maxSize={30}>
          <div className='elements'>
            {props.listHeader}
            {elements.map((element, index) => {
              return <div key={index} className={`element ${activeTraceId === element.trace.id ? 'active' : ''}`} onClick={() => {
                props.onSelectTraceId(element.trace.id)
                // console.log("selecting", element.trace.id)
              }}>
                <h3>Run {element.name}</h3>
                <h4>{element.messages.length ? element.messages.length + " Messages" : ""}</h4>
              </div>
            })}
            {elements.length === 0 && <div className='empty'>{loading ? 'Loading...' : 'No Results'}</div>}
          </div>
        </Panel> */}
        {/* <PanelResizeHandle /> */}
        <Panel defaultSize={50} onResize={() => updateBackground(backgroundElement.current)}>
            <MessagesView messages={activeTrace} selectedMessageHighlights={selectedMessageHighlights} collapsedMessages={collapsedMessages} setCollapsedMessage={setCollapsedMessage} activeTraceId={activeTraceId} loading={loading} onScroll={onScroll} scrollElement={scrollElement} backgroundElement={backgroundElement} highlightedFlowIndex={highlightedFlowIndex} clearHighlightedFlowAction={clearHighlightedFlowAction} />
        </Panel>
      </PanelGroup>
    </div>
  </>
}

function MessagesView(props) {
  const { messages, selectedMessageHighlights, collapsedMessages, setCollapsedMessage, activeTraceId, loading, onScroll, scrollElement, backgroundElement, highlightedFlowIndex, clearHighlightedFlowAction } = props

  return <>
    <div className={'messages'} onScroll={onScroll} ref={scrollElement}>
    <svg className='background' ref={backgroundElement} />
    {messages && <>
      {/* <label>{messages.name}</label> */}
      {messages.messages.map((message, index) => {
        return <Message key={index} highlights={selectedMessageHighlights[index] || []} id={'msg' + index} message={message} expanded={!collapsedMessages[index]} setExpanded={(value) => {
          setCollapsedMessage({ ...collapsedMessages, [index]: !value })
        }} traceId={activeTraceId} />
      })}
    </>}
    {!messages && <div className='empty'>{loading ? 'Loading...' : 'No Results (' + props.activeTraceId + ')'}</div>}
  </div>
  {highlightedFlowIndex && <div className={`flow-highlight-controls`}>
    <b> <BsLightbulbFill /> Highlighting Match {highlightedFlowIndex}</b>
    <button className="blue" onClick={clearHighlightedFlowAction ? clearHighlightedFlowAction.fct : null}>Clear</button>
  </div>}
  </>
}

function isFlatJSON(object) {
  /** returns true iff the given JSON object contains only primitive value values */
  if (typeof object !== 'object') {
    return false;
  }
  if (object === null) {
    return false;
  }

  for (const key in object) {
    if (typeof object[key] === 'object' || Array.isArray(object[key])) {
      if (Array.isArray(object[key])) {
        // check if all elements are just {token, address} objects
        for (const element of object[key]) {
          if (typeof element !== 'object' || element === null || !element.hasOwnProperty('token') || !element.hasOwnProperty('address')) {
            return false;
          }
        }
        return true;
      }
    }
    return true;
  }
}

function guessContentType(content) {
  try {
    let object = JSON.parse(content)
    if (isFlatJSON(object)) {
      return { component: HighlightedValueTable, object: object }
    }

    return null;
  } catch (e) {
    // not JSON
    console.log("not json", content, e)
  }

  return null;
}

function CopyToClipboard(props) {
  const { value } = props;
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
      {recentlyCopied ? 'Copied!' : 'JSON'}
    </button>
  }
}

function HighlightedValueTable(props) {
  const { object } = props;

  return <table className='highlighted-value-table'>
    <tbody>
      {Object.keys(object).map((key, index) => {
        return <tr key={index}>
          <td className='key'>{key}</td>
          <td className='value'>
            <HighlightedCode traceId={props.traceId}>{object[key]}</HighlightedCode>
            <CopyToClipboard value={object[key]} />
          </td>
        </tr>
      })}
    </tbody>
  </table>
}

function CommentComposer(props) {
  const [editorFocus, setEditorFocus] = useAppStatePath('editorFocus.isFocused')
  const textarea = useRef(null)
  const userInfo = useUserInfo()
  let [annotations, annotationStatus, annotationsError, annotator] = useRemoteResource(Annotations, props.traceId)
  annotations = annotations || {}

  const [submitting, setSubmitting] = useState(false)
  const [comment, setComment] = useState(annotations[props.address] ? annotations[props.address].content : '')
  const edited = annotations[props.address] ? annotations[props.address].content !== comment : comment.length > 0

  useEffect(() => {
    setComment(annotations[props.address] ? annotations[props.address].content : '')
  }, [annotations, props.address])

  const alreadyExists = annotations[props.address] !== undefined

  const address = props.address

  const onFocus = () => {
    setEditorFocus(true)
  }

  const onBlur = () => {
    setEditorFocus(false)
  }

  const onClose = (event) => {
    setEditorFocus(false)
    event.stopPropagation()
    props.onClose()
  }

  // on first render, try to catch focus
  useEffect(() => {
    if (textarea.current) {
      window.setTimeout(() => {
        textarea.current.focus()
        // set cursor to end
        let content = annotations[props.address] ? annotations[props.address].content : ''
        textarea.current.setSelectionRange(content.length, content.length)
      }, 100)
    }
  }, [textarea, annotations[props.address]])

  const onSubmit = useCallback((event) => {
    if (!userInfo?.loggedIn) return

    event.preventDefault()
    event.stopPropagation()
    setSubmitting(true)

    if (!alreadyExists) {
      annotator.create({ address, content: comment }).then(() => {
        setEditorFocus(false)
        setSubmitting(false)
        annotator.refresh()
        props.onClose()
      }).catch((error) => {
        alert('Failed to save annotation: ' + error)
        setSubmitting(false)
      })
    } else {
      const trace = annotations[address]
      if (!trace) {
        alert('Failed to find trace for annotation')
        return
      }

      annotator.update(trace.id, { content: comment }).then(() => {
        setEditorFocus(false)
        setSubmitting(false)
        annotations[props.address].content = comment
        props.onClose()
      }).catch((error) => {
        alert('Failed to save annotation: ' + error)
        setSubmitting(false)
      })
    }
  }, [annotations, address, comment, alreadyExists])

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && event.metaKey) {
      onSubmit(event)
    }
  }

  const onDelete = (event) => {
    if (!userInfo?.loggedIn) return
    
    const annotation = annotations[address]
    if (annotation) {
      annotator.delete(annotation.id).then(() => {
        setComment('')
        setEditorFocus(false)
        annotator.refresh()
        props.onClose()
      }).catch((error) => {
        alert('Failed to delete annotation: ' + error)
      })
    }
  }

  
  
  return <div className='comment-composer'>
    <div className='comment-embed'>
      <span className='comment-embed-address'>{address}</span>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} onFocus={onFocus} onBlur={onBlur} placeholder='Add an annotation...' ref={textarea} onKeyDown={onKeyDown} />
      <footer>
        {/* <span className='description'>Use <code>[BUCKET]</code> to categorize this trace in a given bucket.</span> */}
        <div className='spacer' />
        <div>asdf: {(annotations[props.address] || {}).user}</div>
        {!userInfo?.loggedIn && <>
          <button className="inline" onClick={(e) => onClose(e)}>Cancel</button>
          <button className="inline primary" onClick={(e) => window.location.href = '/login'}>Sign In To Annote</button>
        </>}
        {userInfo?.loggedIn && <>
        {alreadyExists && <button className='inline icon danger' onClick={(e) => onDelete(e)}><BsTrash /></button>}
        <button className="inline" onClick={(e) => onClose(e)}>Cancel</button>
        <button className="inline primary" onClick={(e) => onSubmit(e)} disabled={submitting || !edited}>
          {!submitting ? <>Save <span className='shortcut'><BsMeta /> + <BsArrowReturnRight /></span></> : 'Saving...'}
        </button>
        </>}
      </footer>
    </div>
  </div>
}

function BsMeta() {
  return window.navigator.platform.includes('Win') ? <BsWindows /> : <BsCommand />
}

function useRendered(renderer, dependencies) {
  const [rendered, setRendered] = useState(null)
  useEffect(() => {
    setRendered(renderer())
  }, dependencies)
  return rendered
}

function HighlightedCode(props) {
  const [commentComposerOffset, _setCommentComposerOffset] = useState(null)
  const annotations = useRemoteResource(Annotations, props.traceId || null)[0]

  const setCommentComposerOffset = (offset) => {
    _setCommentComposerOffset(offset)
  }

  // const {children, className} = props;
  let children = props.children
  let className = props.className
  let paragraph = props.paragraph || false

  if (props.fancy || false) {
    let contentType = guessContentType(children)
    if (contentType) {
      return <contentType.component object={contentType.object} traceId={props.traceId} />
    }
  }

  // parse all <invariant_highlight:NUM>...</invariant_highlight:NUM> tags and wrap them as <span class='highlight'>...</span>, otherwise render as code
  const renderedElements = useRendered(() => {
    let elements = []

    function appendText(text) {
      if (text.length > 0) {
        // check for list of [{token, address}] objects
        let words = []
        if (Array.isArray(text) && text.length > 0 && typeof text[0].token === 'string' && text[0].address) {
          words = text.map(obj => obj)
        } else {
          words = [{ token: text, address: null }]
        }

        for (let i = 0; i < words.length; i++) {
          let content = words[i].token;
          // make sure content is a string
          if (typeof content !== 'string') {
            content = "" + content
          }

          try {
            let key = words[i].address || ('word-' + elements.length)
            const hasComment = words[i].address && annotations && annotations[words[i].address] && annotations[words[i].address].content.length > 0
            elements.push(<span className={'comment-insertion-point ' + (hasComment ? 'has-comment' : '')} key={key} onClick={(event) => {
              if (words[i].address) {
                setCommentComposerOffset(key)
                event.stopPropagation()
              }
            }}>
              {content}
              {hasComment && <div className='comment-indicator' />}
              {commentComposerOffset === key && <CommentComposer onClose={() => setCommentComposerOffset(null)} address={key} traceId={props.traceId} />}
            </span>)
          } catch (e) {
            elements.push(<span key={elements.length} style={{ opacity: 0.1 }}>{JSON.stringify(content)}</span>)
          }
        }
        // elements.push(<span dangerouslySetInnerHTML={{__html: text}} key={elements.length}></span>)
        // elements.push(text)
      }
    }

    let text = children;

    // let part_num = 0
    // while (text.includes('<invariant_highlight:')) {
    //   let start = text.indexOf('<invariant_highlight:')
    //   let num = text.substring(start + '<invariant_highlight:'.length, text.indexOf('>', start))
    //   let end = text.indexOf('</invariant_highlight:' + num + '>')
    //   appendText(text.substring(0, start))
    //   elements.push(<span key={num + '.' + part_num} className={'highlight hover-' + num}>{text.substring(start + '<invariant_highlight:'.length + num.length + 1, end)}</span>)
    //   text = text.substring(end + ('</invariant_highlight:' + num + '>').length)
    //   part_num += 1
    // }
    appendText(text)

    return elements
  }, [children, commentComposerOffset, annotations])


  if (paragraph) {
    return <div className='paragraph text'>{renderedElements}</div>
  }

  return <code className={className}>{renderedElements}</code>
}

function HighlightedParagraph(props) {
  return <HighlightedCode paragraph={true} {...props} traceId={props.traceId} />
}

function HighlightDot(props) {
  const { x, y, num } = props;
  return <span className={'dot highlight hover-' + num}></span>
}

function getHighlights(message) {
  let text = JSON.stringify(message)
  let highlights = []
  while (text.includes('<invariant_highlight:')) {
    let start = text.indexOf('<invariant_highlight:')
    let num = text.substring(start + '<invariant_highlight:'.length, text.indexOf('>', start))
    let end = text.indexOf('</invariant_highlight:' + num + '>')
    highlights.push({ num: num, start: start, end: end })
    text = text.substring(end + ('</invariant_highlight:' + num + '>').length)
  }
  return highlights
}

function decode(tokenized) {
  return tokenized.map(obj => obj.token).join('')
}

function CategoricalBadge(props) {
  // badge-N with N in [1,8] gives different colors. Decide on text hash of the children text
  const { children, id } = props;
  const name = decode(id)
  const text = children.toString()

  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const color = hash % 8 + 1

  return <span className={`badge badge-${color}`}>{children}</span>
}

function CompactDescription(props) {
  const { message, expanded } = props

  const to_compact = (message) => {
    var output = decode(message.tool_calls[0].function.name)
    output += " ("
    output += Object.entries(message.tool_calls[0].function.arguments).map(([key, value]) => {
      value = JSON.stringify(value)
      let max_length = 20
      if (value.length > max_length) {
        value = value.slice(0, max_length) + "…"
      }
      return key + ": " + value
    }).join(', ')
    output += ")"
    return output
  };

  // check for tool call
  if (message.role == "assistant" && message.tool_calls && message.tool_calls.length > 0) {
    return <span className='compact-description'>
      <CategoricalBadge id={message.tool_calls[0].function.name}>{to_compact(message)}</CategoricalBadge>
    </span>
  } else if (message.role == "tool" && !expanded) {
    return <span className='compact-description'>
      {/* show content but truncated and at most 100 characters. */}
      <span className='dimmed'>
        {message.content && message.content.length > 100 && !expanded ? message.content.substring(0, 100) + '...' : message.content}
      </span>
    </span>
  }
  return null;
}

function Role(props) {
  const { message } = props;
  const role = message.role

  if (role == "tool") {
    return <><BsTools className='role' /> Tool</>
  } else if (role == "assistant") {
    // // check if tool call is present
    // if (message.tool_calls && message.tool_calls.length > 0) {
    //   return <><BsTools/> Tool Call</>
    // }
    return <><BsRobot className='role' /> Assistant</>
  } else if (role == "system") {
    return <><BsSignpost2Fill className='role' /> System</>
  } else {
    return <><BsChatFill className='role' /> {role}</>
  }
}

function Message(props) {
  const { message, id, highlights } = props
  const [expanded, setExpanded] = useState(false)
  const [fancyRendering, setFancyRendering] = useState(true)
  // const [messageExpanded, setMessageExpanded] = useState(true)
  const messageExpanded = props.expanded || false
  const setMessageExpanded = props.setExpanded
  const messageHighlight = highlights.length == 0 ? (message.invariant_highlight || -1) : highlights[0].num
  const toolCallHighlight = message.tool_calls && message.tool_calls.length > 0 && message.tool_calls[0].invariant_highlight ? message.tool_calls[0].invariant_highlight : null

  if (!messageExpanded) {
    return <div id={id} className={`message collapsed ${message.role} ${messageHighlight >= 0 ? 'highlight shiftclick hover-' + messageHighlight : ''}`} onClick={() => setMessageExpanded(true)}>
      <label>
        <BsCaretRightFill />
        {!toolCallHighlight && messageHighlight >= 0 && <HighlightDot x={messageHighlight} y={messageHighlight} num={messageHighlight} />}
        {toolCallHighlight && <HighlightDot x={toolCallHighlight} y={toolCallHighlight} num={toolCallHighlight} />}
        <Role message={message} />
        {/* <CompactDescription message={message} expanded={false}/> */}
      </label>
    </div>
  }

  return <div id={id} className={`message ${message.role} ${messageHighlight >= 0 ? 'highlight shiftclick hover-' + messageHighlight : ''}`}>
    <MessageToolbar message={message}/>
    <MessageTitle message={message} setMessageExpanded={setMessageExpanded} messageHighlight={messageHighlight} />
    <MessageToolCallId message={message} />
    <MessageContent message={message} key={'message-content' - id} traceId={props.traceId} />
    <MessageToolCallContent message={message} expanded={expanded} fancyRendering={fancyRendering} traceId={props.traceId} />
  </div>
}

function MessageToolCallId(props) {
  const { message } = props
  if (message.tool_call_id) {
    return <code className='id'>{message.tool_call_id}</code>
  }
  return null
}

function MessageContent(props) {
  const { message } = props;

  if (!message.content) {
    return null;
  }

  if (!props.traceId) {
    return null;
  }

  if (message.role == "tool") {
    return <HighlightedCode className='tool' traceId={props.traceId}>{message.content}</HighlightedCode>
  } else {
    return <HighlightedParagraph traceId={props.traceId}>{message.content}</HighlightedParagraph>
  }
}

function MessageToolCallContent(props) {
  const { message, expanded, fancyRendering } = props
  const tool_calls = (message.tool_calls || []);

  if (tool_calls.length == 0) {
    return null;
  }

  return tool_calls.map((tool_call, index) => {
    return <div key={index} className={`tool-call ${tool_call.invariant_highlight >= 0 ? 'highlight shiftclick hover-' + tool_call.invariant_highlight : ''}`}>
      {tool_call.invariant_highlight >= 0 && <HighlightDot x={tool_call.invariant_highlight} y={tool_call.invariant_highlight} num={tool_call.invariant_highlight} />}
      <HighlightedCode className='name' traceId={props.traceId}>
        {tool_call.function.name}
      </HighlightedCode>
      <code className='id'>{tool_call.id}</code>
      {expanded && <HighlightedCode className='arguments' fancy={fancyRendering} traceId={props.traceId}>
        {JSON.stringify(tool_call.function.arguments, null, 2)}
      </HighlightedCode>}
      {!expanded && <HighlightedCode className='arguments short' fancy={fancyRendering} traceId={props.traceId}>
        {JSON.stringify(tool_call.function.arguments)}
      </HighlightedCode>}
    </div>
  })
}

function MessageTitle(props) {
  const { message, setMessageExpanded, messageHighlight } = props

  return <label onClick={() => setMessageExpanded(false)}><BsCaretDownFill />
    {messageHighlight >= 0 && <HighlightDot x={messageHighlight} y={messageHighlight} num={messageHighlight} />}
    {/* {message.role} */}
    <Role message={message} />
    <CompactDescription message={message} expanded={true} />
  </label>
}

function MessageToolbar(props) {
  const { message, setFancyRendering, fancyRendering } = props

  // for tool calls, there is the option to toggle fancy rendering ("Basic Rendering")
  if (message.tool_calls) {
    return <>
      <div className='buttons'>
        {/* <button className={'inline ' + (expanded ? 'active' : '')} onClick={() => setExpanded(!expanded)}><BsArrowsExpand /></button> */}
        {/* <button className={'icon inline ' + (!fancyRendering ? 'active' : '')} onClick={() => setFancyRendering(!fancyRendering)}><BsCodeSquare /></button> */}
      </div>
    </>
  }

  return null
}