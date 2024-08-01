import { useState, useEffect, useRef, useCallback } from 'react'
import './TraceView.scss'
import React from 'react'

import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import Select from 'react-select'
import Editor from '@monaco-editor/react';
import { useStreamingEndpoint, StreamingFetch } from './streaming';

import { BsArrowsCollapse, BsArrowsExpand, BsCaretDownFill, BsCaretRightFill, BsChatFill, BsClipboard2, BsClipboard2CheckFill, BsClipboard2Fill, BsCodeSquare, BsDatabase, BsExclamationCircleFill, BsFillGearFill, BsFillPuzzleFill, BsFillTerminalFill, BsGridFill, BsLightbulb, BsLightbulbFill, BsMagic, BsQuestionCircleFill, BsRobot, BsSignpost2Fill, BsTools, BsViewList } from "react-icons/bs";

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
    this.data = new ObservableDict({sourceId: null, importedFiles: {}, dataLoader: '', dataLoaderState: {}, dataLoaders: {}}, 'data')
    this.query = new ObservableDict({query: '', python: '', max_items: -1, activeDataset: null, status: ''}, 'query')
    this.endpointCapabilities = new ObservableDict({endpointSupportsMultipleDatasets: true}, null)
    this.results = new ObservableDict({results: []}, 'results')
    this.editorFocus = new ObservableDict({isFocused: false}, 'editorFocus')
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
      let copy = {...dict}
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

function QueryEditor(props) {
  const options = {
    // theme
    theme: 'vs-dark',
    // line numbers
    lineNumbers: 'on',
    fontSize: 18,
    // disable error markers
    minimap: {enabled: false},
    // disable line wrapping
    wordWrap: 'on'
  }
  const setResults = useAppStatePath('results.results')[1]
  const [query, setQuery] = useAppStatePath('query.query')
  const [python, setPython] = useAppStatePath('query.python')
  const [maxItems, setMaxItems] = useAppStatePath('query.max_items')
  const [isFocused, setIsFocused] = useAppStatePath('editorFocus.isFocused')
  const [activeDataset, setActiveDataset] = useAppStatePath('query.activeDataset')
  const [globalStatus, setGlobalStatus] = useAppStatePath('query.status')
  
  const [showSettings, setShowSettings] = useState(false)
  const [showExamples, setShowExamples] = useState(false)
  const [showDatasetSelector, setShowDatasetSelector] = useState(false)
  const [endpointSupportsMultipleDatasets, setEndpointSupportsMultipleDatasets] = useAppStatePath('endpointCapabilities.endpointSupportsMultipleDatasets')
  
  const [startTime, setStartTime] = useState(0)
  const [endTime, setEndTime] = useState(0)
  const [numMatches, setNumMatches] = useState(0)
  // identifies the current query by a count (e.g. to differentiate different queries in the same session)
  const [queryNum, setQueryNum] = useState(0)

  const [state, queryResults, metadata, error, fetch, cancel] = useStreamingEndpoint(endpoint("/query"))

  // sync streaming results into 'results' state
  useEffect(() => {
    let matches = queryResults.filter(r => r != 'skipped')
    setNumMatches(matches.length)
    setResults({queryId: queryNum, elements: matches})
  }, [queryResults])

  // on state change, update end time
  useEffect(() => {
    if (!state) {
      setEndTime(new Date().getTime())
    }
  }, [state])

  // cancel on Esc
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        cancel()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [cancel])

  const loading = state && (state == StreamingFetch.QUERYING || StreamingFetch.STREAMING)
  let status = null;
  
  // measure total query duration
  let duration = null;
  if (startTime && endTime) {
    duration = (endTime - startTime) / 1000
  }
  
  if (state == StreamingFetch.QUERYING) {
    status = "Querying..."
  } else if (state == StreamingFetch.STREAMING) {
    let traces_per_second = (queryResults.length / (new Date().getTime() - startTime)) * 1000
    status = "Scanning " + numMatches + "/" + queryResults.length + " (ESC to cancel, " + traces_per_second.toFixed(1) + " trc/s)"
  } else if (queryResults.length == 0 && numMatches == 0) {
    status = null;
  } else {
    if (numMatches == 0) {
      status = "No Results (took " + (1000*duration).toFixed(0) + "ms)"
    } else {
      status = "Found " + numMatches + "/" + queryResults.length + " traces"
      if (duration) {
        status += " (in " + (1000*duration).toFixed(0) + "ms)"
      } 
    }
  }

  // on status change, write it to global app state
  useEffect(() => {
    setGlobalStatus(status)
  }, [status])

  const onMount = (editor, monaco) => {
    editor.focus()
    // set theme
    monaco.editor.setTheme(options.theme)

    // on focus and blur
    editor.onDidFocusEditorText(() => setIsFocused(true))
    editor.onDidBlurEditorText(() => setIsFocused(false))
  }

  const onRun = () => {
    fetch({q: query, python: python, max_items: maxItems != 0 ? maxItems : -1, dataset: activeDataset.name})
    setStartTime(new Date().getTime())
    setQueryNum(qn => qn + 1)
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'r' && event.ctrlKey) {
        onRun()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onRun])

  // if on render, active dataset is not set, open dataset selector
  useEffect(() => {
    if (!activeDataset) {
      setShowDatasetSelector(true)
    }
  }, [])

  const [activeTab, setActiveTab] = useState('query')

  return <>
    <header>
      <h2 className='tabs'>
        <button className={'tab ' + (activeTab == 'query' ? 'active' : '')} onClick={() => setActiveTab('query')}><BsCodeSquare/> Query</button>
        <button className={'tab ' + (activeTab == 'python' ? 'active' : '')} onClick={() => setActiveTab('python')}><BsFillPuzzleFill/> Python Extension</button>
        <div className='spacer'/>
        {endpointSupportsMultipleDatasets && <button className='action' onClick={() => setShowDatasetSelector(true)}><BsDatabase/> Select Dataset</button>}
        <button className='action' onClick={() => setShowExamples(true)}><BsGridFill/> Examples</button>
      </h2>
    </header>
    <div className='editor-tabs'>
      <div className={activeTab == 'query' ? 'tab active' : 'tab'}>
        <Editor height="90vh" defaultLanguage="python" options={options} value={query} onChange={(value, event) => {setQuery(value)}} onMount={onMount}/>
      </div>
      <div className={activeTab == 'python' ? 'tab active' : 'tab'}>
        <Editor height="90vh" defaultLanguage="python" options={options} value={python} onChange={(value, event) => {setPython(value)}} onMount={onMount}/>
      </div>
    </div>
    <div className='float left status'>
      {error && <code className="error">{replaceTerminalControlCharacters(error)}</code>}
      {status && <label className='status mono'>{status.toString().substring(0, 50)}</label>}<br/>
      {activeDataset && (<label className='mono description' onClick={() => setShowDatasetSelector(true)}>{deriveFilenameFromPath(activeDataset.name)} ({activeDataset.size} traces)</label>)}
    </div>
    {showDatasetSelector && <DatasetSelector closeCallback={() => setShowDatasetSelector(false)}/>}
    {showSettings && <ConfigurationModal closeCallback={() => setShowSettings(false)} maxItems={maxItems} setMaxItems={setMaxItems}/>}
    {showExamples && <ExamplesGallery closeCallback={() => setShowExamples(false)} setQuery={setQuery} setPython={setPython} activeDataset={activeDataset}/>}
    <div className='float'>
      {maxItems > 0 && <label onClick={() => setShowSettings(true)} className='description'>ITEM LIMIT: {maxItems}</label>}
      <button className='icon' onClick={() => setShowSettings(!showSettings)}><BsFillGearFill/></button>
      <button className='with-arrow green' onClick={onRun} disabled={loading}>{loading ? 'Running...' : 'Run (Ctrl-R)'}</button>
    </div>
  </>
}

function ExamplesGallery(props) {
  // get endpoint /examples and display them
  const [examples, setExamples] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(endpoint("/examples"), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    }).then(response => response.json())
    .then(data => {
      setLoading(false);
      setExamples(data)
    })
    .catch((error) => {
      console.error('failed to fetch examples:', error);
    });
  }, [])
  
  const examplesSortedByCompatibility = examples.sort((a, b) => {
    if (isCompatible(a, props.activeDataset) && !isCompatible(b, props.activeDataset)) {
      return -1
    } else if (!isCompatible(a, props.activeDataset) && isCompatible(b, props.activeDataset)) {
      return 1
    }
    return 0
  })

  return <div className='modal'>
    <div className='modal-background' onClick={props.closeCallback}/>
    <div className='modal-content examples'>
      <h3>
        Query Library<br/>
        <span className='description'>Choose from a selection of example queries to get started.</span>
      </h3>

      {!loading && examplesSortedByCompatibility.length == 0 && <div className='empty'>No Examples Available</div>}
      {loading && <div className='empty'>Loading...</div>}

      <ul>
        {examplesSortedByCompatibility.map((example, index) => {
          return <li key={index} className={isCompatible(example, props.activeDataset) ? '' : 'incompatible'}>
            <div>
              <h4>
                {!isCompatible(example, props.activeDataset) && <BsExclamationCircleFill/>}
                {example.title}
              </h4>
              <p>
                {example.description}
                {isCompatible(example, props.activeDataset) ? '' : <><br/><b className='incompatible'>Note: This query was not designed for the active dataset.</b></>}
              </p>
            </div>
            <button className='inline try' onClick={() => {props.setQuery(example.query); props.setPython(example.python); props.closeCallback()}}>Load</button>
          </li>
        })}
      </ul>

      <footer>
        <button onClick={props.closeCallback}>Close</button>
      </footer>
    </div>
  </div>
}

function isCompatible(example, dataset) {
  return dataset.name.toLowerCase().includes(example.tag.toLowerCase())
}

function DatasetSelector(props) {
  // get endpoint /examples and display them
  const [datasets, setDatasets] = useState([])
  const [activeDataset, setActiveDataset] = useAppStatePath('query.activeDataset')
  const [endpointSupportsMultipleDatasets, setEndpointSupportsMultipleDatasets] = useAppStatePath('endpointCapabilities.endpointSupportsMultipleDatasets')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(endpoint("/tracesets"), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    }).then(response => response.json())
    .then(data => {
      setLoading(false);
      if (data.length == 1) {
        setActiveDataset(data[0])
        setEndpointSupportsMultipleDatasets(false)
      }
      setDatasets(data)
    })
    .catch((error) => {
      console.error('failed to fetch examples:', error);
    });
  }, [])
  
  return <div className='modal'>
    <div className='modal-background' onClick={props.closeCallback}/>
    <div className='modal-content examples'>
      <h3>
        Select Trace Datasets<br/>
        <span className='description'>Choose from a selection of example datasets to get started. You can later change the dataset, to explore different data.</span>
      </h3>

      {!loading && datasets.length == 0 && <div className='empty'>No Datasets Available</div>}
      {loading && <div className='empty'>Loading...</div>}

      <ul>
        {datasets.map((example, index) => {
          return <li key={index}>
            <div>
              <h4>{deriveFilenameFromPath(example.name)}</h4>
              <p>{example.metadata && example.metadata.description ? example.metadata.description : 'No description available.'}</p>
            </div>
            <button className='inline try' onClick={() => {setActiveDataset(example); props.closeCallback()}}>Load</button>
          </li>
        })}
      </ul>

      <footer class='contact'>
        <h4>Want to analyze your own data? Let us help you.</h4>
        <button className='with-arrow blue' onClick={() => window.location.href="mailto:traces@invariantlabs.ai"}>
          Contact Us
        </button>
      </footer>
    </div>
  </div>
}

function deriveFilenameFromPath(path) {
  let parts = path.split('/')
  let filename = parts[parts.length - 1]
  // remove extension
  let filenameParts = filename.split('.')
  filenameParts.pop()
  return filenameParts.join('.')
}

function ConfigurationModal(props) {
  const closeCallback = props.closeCallback || (() => {})
  const [maxItems, setMaxItems] = [props.maxItems, props.setMaxItems]

  return <div className='modal'>
    <div className='modal-background' onClick={closeCallback}/>
    <div className='modal-content'>
      <h3>Query Configuration</h3>
      <br/>
      <label>Item Limit</label>
      <input className={(maxItems == 0 || maxItems == -1) ? 'faded' : ''} name="maxitems" type='number' min="1" value={maxItems} onChange={(e) => setMaxItems(e.target.value) } autoComplete='off'/>
      <span className='description'>Maximum number of items to return. This limit is applied before filtering, which can be helpful for performance. Set to <code>0</code> or <code>-1</code> for no limit.</span>
      <br/>
      <label>Software Licenses</label>
      <span className='description'>This project uses Bootstrap Icons, which are licensed under the MIT License. The icons are used for demonstration purposes only and are not part of the core functionality of this project.</span>
      <footer>
        <button onClick={closeCallback}>Close</button>
      </footer>
    </div>
  </div>
}

function replaceTerminalControlCharacters(msg) {
  const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  return msg.replace(ansiRegex, '');
}

function endpoint(url) {
  const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
  if (isDev) {
    return "http://localhost:8000" + url;
  }

  // check for dev mode
  let base = window.location + ""
  // strip trailing slash
  if (base.endsWith('/')) {
    base = base.substring(0, base.length - 1)
  }
  return base + url
}

class ErrorHandlingComponent extends React.Component {
  constructor(props) {
    super(props)
    this.state = {error: null, errorInfo: null}
  }

  componentDidCatch(error, errorInfo) {
    this.setState({error: error, errorInfo: errorInfo})
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
      boxes[hoverClass].push({x, y, width, height})
      
      const onMouseOver = () => {
        parent.className = parent.className.split(' ').filter(c => !c.startsWith('hover-')).join(' ')
        parent.classList.add(hoverClass)
      }
      e.addEventListener('mouseover', onMouseOver, {passive: true})
      
      let onClick = null;
      if (!e.classList.contains('shiftclick')) {
        onClick = (event) => {
          parent.classList.toggle('keep-highlight')
          event.stopPropagation()
          this.onChangeListeners.forEach(listener => listener(parent.classList.contains('keep-highlight') ? hoverClass : null))
        }
        e.addEventListener('click', onClick, {passive: true})
      } else {
        onClick = (event) => {
          if (event.shiftKey) {
            parent.classList.toggle('keep-highlight')
            event.stopPropagation()
            event.preventDefault()
            this.onChangeListeners.forEach(listener => listener(parent.classList.contains('keep-highlight') ? hoverClass : null))
          }
        };
        e.addEventListener('click', onClick, {passive: true})
      }
      
      const onMouseOut = () => {
        if (!parent.classList.contains('keep-highlight')) {
          parent.className = parent.className.split(' ').filter(c => !c.startsWith('hover-')).join(' ')
          parent.classList.remove(hoverClass)
        }
      }
      e.addEventListener('mouseout', onMouseOut, {passive: true})

      listener.push({element: e, listener: onMouseOver})
      listener.push({element: e, listener: onMouseOut})
      listener.push({element: e, listener: onClick})
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
    this.listener.forEach(({element, listener}) => {
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
    boxes[hoverClass].push({x, y, width, height})
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
    let lastPoint = {x: -1, y: 0}
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

      lastPoint = {x: box.x + box.width / 2, y: box.y + box.height / 2}
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
  const [results, setElements] = useAppStatePath('results.results')
  const elements = results.elements || []
  const queryId = results.queryId

  const [selectedElement, setSelectedElement] = useState(0)
  const [selectedMessageHighlights, setSelectedMessageHighlights] = useState({})
  // keeps track of scroll positions for each element
  const [allCollapsedMessages, setAllCollapsedMessage] = useState({})   
  const collapsedMessages = allCollapsedMessages[selectedElement] || {}
  const setCollapsedMessage = useCallback((value) => {
    setAllCollapsedMessage({...allCollapsedMessages, [selectedElement]: value})
  }, [allCollapsedMessages, selectedElement])
  
  const [editorIsFocused, setEditorIsFocused] = useAppStatePath('editorFocus.isFocused')
  const [scrollPositions, setScrollPositions] = useState({})
  const [scrollElement, isMouseFocused] = useOnMouseFocus()
  const isFocused = !editorIsFocused && isMouseFocused;
  const [highlightedFlowIndex, setHighlightedFlowIndex] = useState(null)
  const [clearHighlightedFlowAction, setClearHighlightedFlowAction] = useState(() => {})
  const [globalStatus, setGlobalStatus] = useAppStatePath('query.status')

  // clear scroll positions when elements change
  useEffect(() => {
    setScrollPositions({})
  }, [queryId])
  
  // on scroll update scroll position for selected element
  const onScroll = (event) => {
    let newScrollPositions = {...scrollPositions}
    newScrollPositions[selectedElement] = event.target.scrollTop
    setScrollPositions(newScrollPositions)
  }

  // whether to autoexpand on focus
  const [autoexpand, setAutoexpand] = useState(true)
  const backgroundElement = useRef(this)

  // clear expanded states when elements change
  useEffect(() => setCollapsedMessage({}), [queryId])

  const onCollapseAll = () => {
    let updatedCollapsedMessages = {}
    elements[selectedElement].messages.forEach((message, index) => {
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
  }, [elements, selectedElement, allCollapsedMessages, autoexpand, isFocused])

  const onExpandAll = () => {
    setCollapsedMessage({})
    window.setTimeout(() => updateBackground(backgroundElement.current), 0)
  }

  const canFocus = Object.keys(selectedMessageHighlights).length > 0

  const onFocus = useCallback((expand) => {
    // collapse all messages except the ones with highlights
    let updatedCollapsedMessages = {}
    let firstSelectedMessage = null;
    
    elements[selectedElement].messages.forEach((message, index) => {
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
        messageElement.scrollIntoView({behavior: 'smooth', block: 'start', inline: 'nearest', inlineTop: 'nearest'})
      }, 20)
    }
  }, [elements, selectedElement, selectedMessageHighlights])

  // on selected element change, update highlights
  useEffect(() => {
    const messages = elements[selectedElement] ? elements[selectedElement].messages : []
    let highlights = {}
    messages.forEach((message, index) => {
      highlights[index] = getHighlights(message)
    })
    setSelectedMessageHighlights(highlights)

    // if not yet opened, autofocus
    if (!scrollPositions[selectedElement]) {
      window.setTimeout(() => {
        scrollElement.current.scrollTop = 0;
      }, 0)
    } else if (scrollElement.current) {
        window.setTimeout(() => {
          scrollElement.current.scrollTop = scrollPositions[selectedElement];
          updateBackground(backgroundElement.current);
        }, 0)
    }
  }, [selectedElement, queryId])

  // clear highlights on element change
  useEffect(() => {
    if (clearHighlightedFlowAction) {
      clearHighlightedFlowAction.fct();
    }
  }, [selectedElement])

  // on render of message change, update background
  useEffect(() => {
    let listener = new HighlightListener(backgroundElement.current)
    setHighlightedFlowIndex(listener.getCurrentHightlightIndex())
    listener.onChange((hoverClass) => {
      if (hoverClass) {
        setHighlightedFlowIndex(hoverClass.split('-')[1])
      } else {
        setHighlightedFlowIndex(null)
      }
    })
    
    setClearHighlightedFlowAction({fct: () => {
      console.log("clearing highlights")
      listener.clearHighlights();
    }})
    
    window.setTimeout(() => updateBackground(backgroundElement.current), 0)
    
    // also on window resize
    let resizeListener = () => updateBackground(backgroundElement.current);
    window.addEventListener('resize', resizeListener);
    
    return () => {
      listener.clear();
      window.removeEventListener('resize', resizeListener);
    }
  }, [selectedElement, allCollapsedMessages])

  return <>
    <header className='toolbar'>
      {props.header}
      <div className='spacer'/>
      <button className="inline" onClick={() => onFocus(autoexpand)} disabled={!canFocus}>
        <BsViewList /> Scroll To Match (S)</button>
      <div className='vr'/>
      <button className="inline" onClick={onCollapseAll}><BsArrowsCollapse /> Collapse All (W)</button>
      <button className="inline" onClick={onExpandAll}><BsArrowsExpand /> Expand All (E)</button>
      <CopyToClipboard object={(elements[selectedElement] || {})["messages"]} appearance='toolbar' disabled={elements[selectedElement] === undefined}/>
    </header>
    <div className='explorer panel'>
      {/* hierarchical selector of traces and then messages within traces */}
      <PanelGroup autoSaveId="agentql-layout-explorer" direction="horizontal">
        <Panel defaultSize={50}>
          <div className='elements'>
          {elements.map((element, index) => {
            return <div key={index} className={`element ${selectedElement === index ? 'active' : ''}`} onClick={() => setSelectedElement(index)}>
              <h3>{element.name}</h3>
              <h4>{element.messages.length} Messages</h4>
            </div>
          })}
          {elements.length === 0 && <div className='empty'>{globalStatus || 'No Results'}</div>}
          </div>
        </Panel>
        <PanelResizeHandle />
        <Panel defaultSize={50} onResize={() => updateBackground(backgroundElement.current)}>
          <div className={'messages'} onScroll={onScroll} ref={scrollElement}>
            <svg className='background' ref={backgroundElement} style={{display: elements.length > 0 ? 'block' : 'none'}}/>
            {elements[selectedElement] && <>
            {/* <label>{elements[selectedElement].name}</label> */}
            {elements[selectedElement].messages.map((message, index) => {
              return <Message key={index} highlights={selectedMessageHighlights[index] || []} id={'msg' + index}message={message} expanded={!collapsedMessages[index]} setExpanded={(value) => setCollapsedMessage({...collapsedMessages, [index]: !value})}/>
            })}
            </>}
            {!elements[selectedElement] && <div className='empty'>No Trace Selected</div>}
          </div>
          {highlightedFlowIndex && <div className={`flow-highlight-controls`}>
            <b> <BsLightbulbFill/> Highlighting Match {highlightedFlowIndex}</b>
            <button className="blue" onClick={clearHighlightedFlowAction ? clearHighlightedFlowAction.fct : null}>Clear</button>
          </div>}
        </Panel>
      </PanelGroup>
    </div>
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
      return false;
    }
  }
  return true;
}

function guessContentType(object) {
  try {
    object = JSON.parse(object)
    if (isFlatJSON(object)) {
      return {component: HighlightedValueTable, object: object}
    }

    return null;
  } catch (e) {
    // not JSON
  }

  return null;
}

function CopyToClipboard(props) {
  const {value} = props;
  const appearance = props.appearance || 'compact'
  const [recentlyCopied, setRecentlyCopied] = useState(false)

  useEffect(() => {
    if (recentlyCopied) {
      const timeout = setTimeout(() => setRecentlyCopied(false), 1000)
      return () => clearTimeout(timeout)
    }
  }, [recentlyCopied])

  const {object} = props;
  const onCopy = () => {
    const v = value || JSON.stringify(object, null, 2)
    navigator.clipboard.writeText(v).then(() => setRecentlyCopied(true))
  }

  if (appearance === 'compact') {
    return <button className={'copy ' + (recentlyCopied ? 'recently-copied' : '')} onClick={onCopy} disabled={props.disabled || false}>
      {recentlyCopied ? <BsClipboard2CheckFill /> : <BsClipboard2Fill/>}
    </button>
  } else {
    // like a regular button.inline
    return <button className='inline' onClick={onCopy} disabled={props.disabled || false}>
      {recentlyCopied ? <BsClipboard2CheckFill /> : <BsClipboard2Fill/>}
      {recentlyCopied ? 'Copied!' : 'Copy as JSON'}
    </button>
  }
}

function HighlightedValueTable(props) {
  const {object} = props;
  
  return <table className='highlighted-value-table'>
    <tbody>
    {Object.keys(object).map((key, index) => {
      return <tr key={index}>
        <td className='key'>{key}</td>
        <td className='value'>
          <HighlightedCode>{object[key]}</HighlightedCode>
          <CopyToClipboard value={object[key]}/>
        </td>
      </tr>
    })}
    </tbody>
  </table>
}

function HighlightedCode(props) {
  // const {children, className} = props;
  let children = props.children
  let className = props.className
  let paragraph = props.paragraph || false

  if (props.fancy || false) {
    let contentType = guessContentType(children)
    if (contentType) {
      return <contentType.component object={contentType.object}/>
    }
  }

  // parse all <invariant_highlight:NUM>...</invariant_highlight:NUM> tags and wrap them as <span class='highlight'>...</span>, otherwise render as code
  let elements = []
  let text = children;
  let part_num = 0
  while (text.includes('<invariant_highlight:')) {
    let start = text.indexOf('<invariant_highlight:')
    let num = text.substring(start + '<invariant_highlight:'.length, text.indexOf('>', start))
    let end = text.indexOf('</invariant_highlight:' + num + '>')
    elements.push(text.substring(0, start))
    elements.push(<span key={num + '.' + part_num} className={'highlight hover-' + num}>{text.substring(start + '<invariant_highlight:'.length + num.length + 1, end)}</span>)
    text = text.substring(end + ('</invariant_highlight:' + num + '>').length)
    part_num += 1
  }
  elements.push(text)

  if (paragraph) {
    return <p className='text'>{elements}</p>
  }

  return <code className={className}>{elements}</code>
}

function HighlightedParagraph(props) {
  return <HighlightedCode paragraph={true} {...props} />
}

function HighlightDot(props) {
  const {x, y, num} = props;
  return <span className={'dot highlight hover-' + num}></span>
}

function getHighlights(message) {
  let text = JSON.stringify(message)
  let highlights = []
  while (text.includes('<invariant_highlight:')) {
    let start = text.indexOf('<invariant_highlight:')
    let num = text.substring(start + '<invariant_highlight:'.length, text.indexOf('>', start))
    let end = text.indexOf('</invariant_highlight:' + num + '>')
    highlights.push({num: num, start: start, end: end})
    text = text.substring(end + ('</invariant_highlight:' + num + '>').length)
  }
  return highlights
}

function CategoricalBadge(props) {
  // badge-N with N in [1,8] gives different colors. Decide on text hash of the children text
  const {children, id} = props;
  const text = children.toString()

  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const color = hash % 8 + 1

  return <span className={`badge badge-${color}`}>{children}</span>
}

function CompactDescription(props) {
  const {message, expanded} = props

  const to_compact = (message) => {
    var output = message.tool_calls[0].function.name
    output += " ("
    output += Object.entries(message.tool_calls[0].function.arguments).map(([key, value]) => {
      if (value.length > 5) {
        value = value.slice(0, 5) + "…"
      }
      return key + ": " + value}).join(', ')
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
  const {message} = props;
  const role = message.role

  if (role == "tool") {
    return <><BsTools className='role'/> Tool</>
  } else if (role == "assistant") {
    // // check if tool call is present
    // if (message.tool_calls && message.tool_calls.length > 0) {
    //   return <><BsTools/> Tool Call</>
    // }
    return <><BsRobot className='role'/> Assistant</>
  } else if (role == "system") {
    return <><BsSignpost2Fill className='role'/> System</>
  } else {
    return <><BsChatFill className='role'/> {role}</>
  }
}

function Message(props) {
  const {message, id, highlights} = props
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
        <BsCaretRightFill/>
        {!toolCallHighlight && messageHighlight >= 0 && <HighlightDot x={messageHighlight} y={messageHighlight} num={messageHighlight}/>}
        {toolCallHighlight && <HighlightDot x={toolCallHighlight} y={toolCallHighlight} num={toolCallHighlight}/>}
        <Role message={message}/>
        <CompactDescription message={message} expanded={false}/>
      </label>
    </div>
  }

  return <div id={id} className={`message ${message.role} ${messageHighlight >= 0 ? 'highlight shiftclick hover-' + messageHighlight : ''}`}>
    <MessageToolbar message={message} setFancyRendering={setFancyRendering} fancyRendering={fancyRendering}/>
    <MessageTitle message={message} setMessageExpanded={setMessageExpanded} messageHighlight={messageHighlight}/>
    <MessageToolCallId message={message}/>
    <MessageContent message={message}/>
    <MessageToolCallContent message={message} expanded={expanded} fancyRendering={fancyRendering}/>
  </div>
}

function MessageToolCallId(props) {
  const {message} = props
  if (message.tool_call_id) {
    return <code className='id'>{message.tool_call_id}</code>
  }
  return null
}

function MessageContent(props) {
  const {message} = props;

  if (!message.content) {
    return null;
  }

  if (message.role == "tool") {
    return <HighlightedCode className='tool'>{message.content}</HighlightedCode>
  } else {
    return <HighlightedParagraph>{message.content}</HighlightedParagraph>
  }
}

function MessageToolCallContent(props) {
  const {message, expanded, fancyRendering} = props
  const tool_calls = (message.tool_calls || []);
  
  if (tool_calls.length == 0) {
    return null;
  }

  return tool_calls.map((tool_call, index) => {
    return <div key={index} className={`tool-call ${tool_call.invariant_highlight >= 0 ? 'highlight shiftclick hover-' + tool_call.invariant_highlight : ''}`}>
      <HighlightedCode className='name'>
        {tool_call.invariant_highlight >= 0 && <HighlightDot x={tool_call.invariant_highlight} y={tool_call.invariant_highlight} num={tool_call.invariant_highlight}/>}
        {tool_call.function.name}
      </HighlightedCode>
      <code className='id'>{tool_call.id}</code>
      {expanded && <HighlightedCode className='arguments' fancy={fancyRendering}>
        {JSON.stringify(tool_call.function.arguments, null, 2)}
      </HighlightedCode>}
      {!expanded && <HighlightedCode className='arguments short' fancy={fancyRendering}>
        {JSON.stringify(tool_call.function.arguments)}
      </HighlightedCode>}
    </div>
  })
}

function MessageTitle(props) {
  const {message, setMessageExpanded, messageHighlight} = props

  return <label onClick={() => setMessageExpanded(false)}><BsCaretDownFill/>
    {messageHighlight >= 0 && <HighlightDot x={messageHighlight} y={messageHighlight} num={messageHighlight}/>}
    {/* {message.role} */}
    <Role message={message}/>
    <CompactDescription message={message} expanded={true}/>
  </label>
}

function MessageToolbar(props) {
  const {message, setFancyRendering, fancyRendering} = props
  
  // for tool calls, there is the option to toggle fancy rendering ("Basic Rendering")
  if (message.tool_calls) { 
    return <>
      <div className='buttons'>
        {/* <button className={'inline ' + (expanded ? 'active' : '')} onClick={() => setExpanded(!expanded)}><BsArrowsExpand /></button> */}
        <button className={'icon inline ' + (!fancyRendering ? 'active' : '')} onClick={() => setFancyRendering(!fancyRendering)}><BsCodeSquare /></button>
      </div>
    </>
  }

  return null
}

function App() {
  return (
    <>
      <header>
          <img src="theme/images/logo.svg" alt="logo" />
          <h1>Invariant Explorer</h1>
          <button className='icon'><BsQuestionCircleFill/></button>
      </header>
      <div className='content'>
        <PanelGroup autoSaveId="agentql-layout" direction="horizontal">
          <Panel defaultSize={50}>
          <PanelGroup autoSaveId="agentql-layout-vert" direction="vertical">
            <Panel defaultSize={50}>
              <QueryEditor />
            </Panel>
            {/* <PanelResizeHandle />
            <Panel defaultSize={50}>
              <DataSource />
            </Panel> */}
          </PanelGroup>
          </Panel>
          <PanelResizeHandle />
          <Panel>
            <ErrorHandlingComponent>
              <Explorer />
            </ErrorHandlingComponent>
          </Panel>
      </PanelGroup>
      </div>
    </>
  )
}

export default App
