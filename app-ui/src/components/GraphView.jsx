import "./Overlay.css"
import React, { useRef } from 'react';
import {useEffect, useState} from 'react';
import {PanelGroup, Panel, PanelResizeHandle} from 'react-resizable-panels'

import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { BsGearFill } from 'react-icons/bs';

cytoscape.use( dagre );


class ColorContext {
    constructor() {
        this.COLORS = [
            "#FFC8C1", // red
            "#B1DBEF", // blue
            "#9FE5A2", // green
            "#FEEDB9", // yellow
            "#D0D2F7", // purple
            "#D0D5DC" // grey
        ];
        this.ACTIVE_COLORS = [
            "#fbbbb2", // red
            "#84C5E6", // blue
            "#5FD564", // green
            "#FECF49", // yellow
            "#B5B8F2", // purple
            "#B5BEC8" // grey
        ];

        this.mapping = {};
        this.index = 0;
    }

    active_color(type) {
        if (typeof this.mapping[type] !== "undefined") {
            return this.ACTIVE_COLORS[this.mapping[type]];
        }

        // otherwise pick next color
        let color = this.ACTIVE_COLORS[this.index];
        this.mapping[type] = this.index;
        this.index = (this.index + 1) % this.COLORS.length;
        return color;
    }

    color(type) {
        if (typeof this.mapping[type] !== "undefined") {
            return this.COLORS[this.mapping[type]];
        }

        // otherwise pick next color
        let color = this.COLORS[this.index];
        this.mapping[type] = this.index;
        this.index = (this.index + 1) % this.COLORS.length;
        return color;
    }
}

function NodeContent(props) {
    let content = props;

    if (props.details == "none") {
        return null;
    }

    if (props.type == "prompt") {
        return null;
    } else if (props.type == "tool" || props.type == "blocked") {
        content = props.input;
    } else if (props.type == "observation") {
        content = props.output;
    } else if (props.type == "literal") {
        // literals only need the label
       return null;
    } else if (props.type == "function_call") {
        // function calls only need the label
        return null;
    }

    // try to parse nested content as JSON
    try {
        content = JSON.parse(content);
    } catch (e) {
        // show as string
    }

    if (typeof content === "undefined") {
        return null;
    }

    return <div key={props.id} className='synced box' id={'overlay-' + props.id}>
        <div className="content">
        <pre>
        <code>
            {JSON.stringify(content, null, 2)}
        </code>
        </pre>
        </div>
    </div>
}

function NodeLabel(props) {
    if (props.type == "prompt") {
        return "Prompt"
    } else if (props.type == "tool") {
        return props.tool || props.label;
    }  else if (props.type == "blocked") {
        return props.tool;
    } else if (props.type == "observation") {
        return "Observation";
    } else if (props.type == "literal") {
        return props.label + " (" + props.ttype + ")";
    } else if (props.type == "function_call") {
        return props.label;
    } else {
        return props.type;
    }
}

export function GraphView(props) {
    const graphElement = useRef(null);
    const [cy, setCy] = useState(null);

    const [activeMessage, setActiveMessage] = useState(null);
    const [messageAttribute, messageKey] = activeMessage ? (activeMessage.includes(':') ? activeMessage.split(':') : ['content', activeMessage]) : [null, null];

    const overlayElement = useRef(null);
    const [overlayTransform, setOverlayTransform] = useState({x: -1000, y: 0, scale: 1});

    const [highlightedProblem, setHighlightedProblem] = useState(props.editorState.highlightedProblem);

    const [viewOptionsVisible, setViewOptionsVisible] = useState(false);
    const [showFullPaths, setShowFullPaths] = useState(localStorage.getItem('graph-show-full-paths') === 'true');

    const [availableLayers, setAvailableLayers] = useState(["full"]);
    const [_activeLayer, setActiveLayer] = useState("full");

    const activeLayer = availableLayers.length > 1 ? _activeLayer : availableLayers[0];

    // listen for editor state active message changes
    useEffect(() => {
        // update active message when it changes in EditorState
        const onActiveMessageChange = (messageKey) => {
            setActiveMessage(messageKey);
        }
        props.editorState.onSelectedMessage(onActiveMessageChange);

        // update editor contents when active message changes
        const onEditorStateChange = (editorState) => {
            setActiveMessage(editorState.activeMessage);
        }
        props.editorState.onLoaded(onEditorStateChange);
        onEditorStateChange(props.editorState);

        return () => {
            props.editorState.offLoaded(onEditorStateChange);
            props.editorState.offSelectedMessage(onActiveMessageChange);
        }
    }, []);

    useEffect(() => {
        // listen for highlighted problems
        const onHighlightProblem = (problem) => {
            if (problem && problem.messageKey == messageKey) {
                setHighlightedProblem(problem);
            } else {
                setHighlightedProblem(null);
            }
        };
        props.editorState.onHighlightProblem(onHighlightProblem);

        return () => {
            props.editorState.offHighlightProblem(onHighlightProblem);
        }
    }, [messageKey]);

    const clear = () => {
        if (cy) {
            cy.destroy();
            setCy(null);
        }
        graphElement.current.innerHTML = "";
    }

    useEffect(() => {
        const message = props.editorState.messages.find(m => m.key === messageKey);
        if (!message) {
            clear();
            return;
        }
        
        let graph = null;
        if (message.role == "verifier") {
            try {
                let payload = JSON.parse(message.content);
                graph = payload.graph
                // graph = message.graph;
            } catch (e) {
                console.error(e);
                return;
            }
        } else if (message.role == "workflow") {
            if (message.graph) {
                graph = message.graph;
            } else {
                return;
            }
        } else {
            console.log("unsupported message role", message.role);
            // nothing to change
            return;
        }

        // check if graph is empty
        if (!graph) {
            clear();
            return;
        }

        if (graph.layers) {
            graph = graph.layers["react"];
        }

        if (!graph.nodes || !graph.edges) {
            clear();
            return;
        }

        // parse label as JSON and erive label as 'name' attribute if possible
        let colors = new ColorContext();

        graph.nodes.forEach((node) => {
            try {
                let props = JSON.parse(node.label);
                if (!props.type) throw new Error("node.label should not be interpreted as JSON");
                node.label = NodeLabel(props);
                node.color = colors.color(props.type);
                node.width = "420px";
                node.activeColor = colors.active_color(props.type);
                node.padding = 0;
                node.props = props;
            } catch (e) {
                node.label = node.label;
                node.props = {"details": "none"}
                
                node.width = "label"
                node.padding = "10px"
                node.color = colors.color("default");
                node.activeColor = colors.active_color("default");
            }
        });

        const cy = cytoscape({
            container: graphElement.current,
            elements: [
                ...graph.nodes.map(n => ({ data: { ...n } })),
                ...graph.edges.map((e,i) => ({ data: { id: 'edge-' + i, source: e.source, target: e.target } })),
            ],
            style: [
                {
                    selector: 'node',
                    style: {
                        'background-color': 'data(color)',
                        'label': 'data(label)',
                        'text-wrap': 'wrap',
                        'text-valign': 'top',
                        'text-halign': 'center',
                        'text-margin-y': 22,
                        'color': 'black',
                        'shape': 'round-rectangle',
                        'width': 'data(width)',
                        'padding': 'data(padding)',
                        'font-size': '18px',
                        'font-family': "monospace",
                        'border-width': 2,
                        'border-color': 'data(activeColor)',
                    }
                },
                {
                    selector: 'node.faded',
                    style: {
                        'opacity': 0.2
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'width': 3,
                        'line-color': '#ccc',
                        'target-arrow-color': '#ccc',
                        'curve-style': 'bezier',
                        'control-point-step-size': 240,
                        'control-point-weight': 0.5,
                        'control-point-distance': 20,
                        'target-arrow-shape': 'triangle',
                        'target-arrow-fill': 'filled',
                        'arrow-scale': 2,
                        'opacity': 0.5
                    }
                },
                {
                    // selected node
                    selector: 'node:selected',
                    style: {
                        'background-color': 'data(activeColor)',
                        'border-width': 3,
                        'border-color': '#333',
                        'border-style': 'solid',
                    }
                }
            ],
            layout: {
                name: 'dagre',
                rankDir: 'TB',
                rankSep: 30,
                nodeSep: 10,
                edgeSep: 10,
                padding: 10
            },
            draggable: true
        });
        setCy(cy);
        cy.on('pan', onPan);
        cy.on('zoom', onZoom);
        cy.on('drag', 'node', onMoveNode);
        cy.on('position', 'node', onMoveNode);

    } , [graphElement, messageKey, activeLayer]);

    useEffect(() => {
        if (cy) {
            cy.resize();
            fit();
        }
    }, [cy]);

    const onResize = () => {
        if (cy) {
            cy.resize();
        }
    }

    const onMoveNode = (e) => {
        if (overlayElement.current) {
            let element = overlayElement.current.querySelector('#overlay-' + e.target.id());
            if (!element) return;
            sync(e.target, element);
        }
    }

    const onPan = (e) => {
        setOverlayTransform({x: e.cy.pan().x, y: e.cy.pan().y, scale: e.cy.zoom()});
    }

    const onZoom = (e) => {
        setOverlayTransform({x: e.cy.pan().x, y: e.cy.pan().y, scale: e.cy.zoom()});
    }

    useEffect(() => {
        if (overlayElement.current && cy) {
            overlayElement.current.querySelectorAll('.synced').forEach((element) => {
                let id = element.id.split('-')[1];
                let node = cy.getElementById(id);
                sync(node, element);
            });
        }
    }, [overlayElement, cy]);

    const fit = () => {
        if (cy) {
            cy.nodes().forEach((node) => {
                // get elemetn height
                let element = overlayElement.current.querySelector('#overlay-' + node.id());
                if (!element) return;
                node.style('height', element.clientHeight + 10 + 'px');
            });

            cy.layout({name: 'dagre'}).run();
            cy.fit();
            cy.zoom(cy.zoom() * 0.9);
            
            // limit zoom to 1
            if (cy.zoom() > 1) {
                cy.zoom(1);
            }
            
            cy.center();
        }
    }

    useEffect(() => {
        if (overlayElement.current) {
            overlayElement.current.style.transform = `translate(${overlayTransform.x}px, ${overlayTransform.y}px) scale(${overlayTransform.scale})`;
            overlayElement.current.querySelectorAll('.box').forEach((element) => {
                element.style.opacity = Math.max(0, overlayTransform.scale - 0.1) / 0.1;
            })
        }
    }, [overlayElement, overlayTransform]);
    
    useEffect(() => {
        if (cy && highlightedProblem && highlightedProblem.messageKey == messageKey && highlightedProblem.issue && highlightedProblem.issue.data && highlightedProblem.issue.data.paths) {
            let highlighted = new Set();

            console.log(highlightedProblem)
            highlightedProblem.issue.data.paths.forEach(path => {
                if (showFullPaths) {
                    path.ids.forEach(id => {
                        highlighted.add("" + id);
                    })
                } else {
                    // only highlight first and last
                    highlighted.add("" + path.ids[0]);
                    highlighted.add("" + path.ids[path.ids.length - 1]);
                }
            })
            let nodes = cy.nodes().filter((node) => {
                return highlighted.has(node.id());
            });
            
            // fade cy elements
            cy.elements().addClass('faded');
            nodes.removeClass('faded');
            
            // cy html elements
            if (overlayElement.current) {
                overlayElement.current.querySelectorAll('.box').forEach((element) => {
                    element.classList.add('faded');
                });
                let selector = Array.from(highlighted).map(id => '#overlay-' + id).join(', ');
                overlayElement.current.querySelectorAll(selector).forEach((element) => {
                    element.classList.remove('faded');
                });
            }
        } else if (cy) {
            cy.elements().removeClass('faded');
            if (overlayElement.current) {
                overlayElement.current.querySelectorAll('.box').forEach((element) => {
                    element.classList.remove('faded');
                });
            }
        }
    }, [highlightedProblem, cy, messageKey, showFullPaths]);

    return <>
        <header className='secondary'>
            <div className='spacer'></div>
            <button className='action' onClick={fit}>Fit</button>
            <button className={'action' + (viewOptionsVisible ? ' active' : '')} onClick={() => setViewOptionsVisible(!viewOptionsVisible)}>
                <BsGearFill/>
            </button>
            {viewOptionsVisible && <div className="popover" onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
                <h2>
                    View Settings
                </h2>
                <select id='graph-layers' value={activeLayer} onChange={(e) => setActiveLayer(e.target.value)} disabled={availableLayers.length <= 1}>
                    {availableLayers.map((layer) => <option key={layer} value={layer}>{layer}</option>)}
                </select><br/><br/>
                <input type="checkbox" id="show-full-paths" checked={showFullPaths} onClick={(e) => {
                    setShowFullPaths(!showFullPaths);
                    localStorage.setItem('graph-show-full-paths', !showFullPaths);
                    e.stopPropagation();
                } }/>
                <label htmlFor="show-full-paths" onClick={(e) => e.stopPropagation()}>Show full paths</label><br/>
            </div>}
        </header>
        <div className='graph-pan-blocker left'/>
        <div className='graph-overlay' ref={overlayElement}>
            <div className="overlay">
                {/* <div className='synced box' id='overlay-2'>Test</div> */}
                {cy && cy.nodes().map((node) => <NodeContent id={node.id()} key={node.id()} {...node.data().props}/>)}
            </div>
        </div>
        <div ref={graphElement} className='graph' style={{height: '100%'}} onResize={onResize}></div>
    </>
}

function sync(node, element) {
    if (node) {
        let position = {
            x: node.position().x - node.width() / 2 - 5,
            y: node.position().y - node.height() / 2 - 5
        }
        // element.style.top = position.y + 20 + 'px';
        // element.style.left = position.x + 10 + 'px';
        element.style.transform = `translate(${position.x + 10}px, ${position.y + 20}px)`;

        element.style.width = node.width() - 10 + 'px';
        element.style.height = node.height() - 10 + 'px';
    }
}