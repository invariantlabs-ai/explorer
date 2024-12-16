import "./TraceView.scss"
import Editor from "@monaco-editor/react";
import { BsCaretRightFill, BsCaretDownFill, BsPersonFill, BsRobot, BsChatFill, BsCheck2, BsExclamationCircleFill, BsMagic, BsLink } from "react-icons/bs";

import { HighlightedJSON, Highlight, GroupedHighlight } from "./highlights";
import { validate } from "./schema";
import jsonMap from "json-source-map"
import React, { useState, useEffect, useRef, Ref } from "react";

import { ViewportList } from 'react-viewport-list';
import { Plugins } from "./plugins";
import { HighlightContext, Line, TraceDecorator } from "./line";
import { config } from "../../Config";
import { truncate } from "./utils";
import { AnchorDiv, anchorToAddress, copyPermalinkToClipboard, permalink } from "../permalink-navigator";

/**
 * Props for the TraceView component.
 */
interface TraceViewProps {
    // JSON representation of the trace
    inputData: string;
    // when the trace editor changes, this function is called with the new JSON string
    handleInputChange: (value: string | undefined) => void;

    // highlights to highlight in the trace view
    highlights: Record<string, string>
    // ID of the trace
    traceId: string
    // whether to use the side-by-side view
    sideBySide?: boolean
    // custom view to show when selecting a line
    decorator?: TraceDecorator
    // additional header components to show
    header?: React.ReactNode
    // title of the trace view
    title?: string | React.ReactNode
    // whether to show the editor (default: true)
    editor?: boolean
}

/**
 * A hook that automatically validates JSON input and provides validation results.
 */
function useJSONValidation(props: { text: string }) {
    const [validationResult, setValidationResult] = useState({ valid: true, errors: [] as any[] })

    useEffect(() => {
        try {
            const parsed = JSON.parse(props.text)
            const pointers = jsonMap.parse(props.text).pointers

            // validate the trace
            let result = validate(parsed)
            setValidationResult(result)

            // augment errors with source ranges
            result.errors = result.errors.map((error: any) => {
                let pointer = pointers[error.instancePath]
                if (pointer) {
                    error.range = {
                        start: pointer.value ? pointer.value : pointer.keyStart,
                        end: pointer.value ? pointer.valueEnd : pointer.keyEnd
                    }
                }
                return error
            })
        } catch (e: any) {
            // get stack trace
            console.error(e)
            setValidationResult({ valid: false, errors: [{ instancePath: "/", message: e.message }] })
        }
    }, [props.text])

    return validationResult
}

/**
 * A component that shows the validation status of a trace, including error messages.
 */
export function TraceValidationStatus(props: { validation: { valid: boolean, errors: any[] } }) {
    const [showErrors, setShowErrors] = useState(false)
    const FORMAT_URL = "https://github.com/invariantlabs-ai/invariant?tab=readme-ov-file#trace-format"
    const validationResult = props.validation

    // hide errors when the validation result is valid
    useEffect(() => {
        if (validationResult.errors.length == 0) {
            setShowErrors(false)
        }
    }, [validationResult.errors])

    // show a valid status
    if (validationResult.valid) {
        return <div className="validation-status valid">
            <BsCheck2 /> <a href={FORMAT_URL} target="_blank" rel="noreferrer">
                Compatible Format
            </a>
        </div>
    } else {
        // show an invalid status with a list of errors
        return <div className="validation-status invalid" onClick={() => setShowErrors(!showErrors)}>
            <BsExclamationCircleFill />
            Format Issues ({validationResult.errors.length} Errors)
            {showErrors && <ul className="popup">
                {validationResult.errors.map((error, index) => {
                    return <li key={index}>{error.instancePath}: {error.message}</li>
                })}
                <a href={FORMAT_URL} target="_blank" rel="noreferrer">
                    Trace Format Documentation →
                </a>
            </ul>}
        </div>
    }
}

/**
 * A component that shows a trace view, including an editor and a preview of the trace.
 */
export function TraceView(props: TraceViewProps) {
    // extract props
    const { inputData, handleInputChange, highlights } = props;
    // state for the annotated JSON 
    const [highlightedJson, setHighlightedJSON] = useState<HighlightedJSON | null>(null);
    // current editing mode (editor or rendered trace)
    const [mode, setMode] = useState<"input" | "trace">("trace");
    // provides a continous validation result
    const validationResult = useJSONValidation({ text: inputData })

    const sideBySide = props.sideBySide
    const hasEditor = props.editor != false

    // when the parent-provided highlights change, convert them to HighlightedJSON format
    useEffect(() => {
        setHighlightedJSON(HighlightedJSON.from_mappings(highlights))
    }, [highlights])

    return <div className="traceview">
    {props.header != false && <h2>
        <div>
            {props.title}
            {!sideBySide && <div className="tab-group">
                <button className={mode === "input" ? "active" : ""} onClick={() => setMode("input")}>
                    <span className="inner">Edit</span>
                </button>
                <button className={mode === "trace" ? "active" : ""} onClick={() => setMode("trace")}>
                    <span className="inner">Preview</span>
                </button>
            </div>}
            {hasEditor && <TraceValidationStatus validation={validationResult} />}
            {props.header}
        </div>
    </h2>}
    {hasEditor && !sideBySide && <div className={"content"}>
        <div className={"tab" + (mode === "input" ? " active" : "")}>
            <TraceEditor inputData={inputData} handleInputChange={handleInputChange} highlights={highlightedJson || HighlightedJSON.empty()} validation={validationResult} />
        </div>
        <div className={"tab traces " + (mode === "trace" ? " active" : "")}>
            <RenderedTrace trace={inputData} highlights={highlightedJson || HighlightedJSON.empty()} decorator={props.decorator} traceId={props.traceId} />
        </div>
    </div>}
    {hasEditor && sideBySide && <div className="sidebyside">
        <div className="side">
            <TraceEditor inputData={inputData} handleInputChange={handleInputChange} highlights={highlightedJson || HighlightedJSON.empty()} validation={validationResult} />
        </div>
        <div className="traces side">
            <RenderedTrace trace={inputData} highlights={highlightedJson || HighlightedJSON.empty()} decorator={props.decorator} traceId={props.traceId} />
        </div>
    </div>}
    {!hasEditor && <div className="fullscreen">
        <div className={"side traces " + (mode === "trace" ? " active" : "")}>
            <RenderedTrace trace={inputData} highlights={highlightedJson || HighlightedJSON.empty()} decorator={props.decorator} traceId={props.traceId} />
        </div>
    </div>}
</div>
}

/**
 * A component that shows a JSON editor with syntax highlighting and validation of the trace format.
 * 
 * Also supports highlighting of specific ranges in the raw JSON representation.
 */
export function TraceEditor(props: { inputData: string, handleInputChange: (value: string | undefined) => void, highlights: HighlightedJSON, validation: { valid: boolean, errors: any[] } }) {
    // state to keep a reference to the editor instance
    const [editor, setEditor] = useState(null as any)
    // state to keep a reference to the monaco instance
    const [monaco, setMonaco] = useState(null as any)
    // decorations shown in the editor (to visualize highlights)
    const [editorDecorations, setEditorDecorations] = useState([] as any)
    // error underlines in the editor
    const [errorMarkerDecorations, setErrorMarkerDecorations] = useState([] as any)
    // JSON validation results
    const validationResults = props.validation

    // when highlights or pointers change, re-create the highlighted ranges from the updated sourcemap and highlights
    useEffect(() => {
        if (!editor || !monaco || !editorDecorations) {
            return
        }

        let highlights_in_text = props.highlights.for_path("messages").in_text(props.inputData)

        editorDecorations.clear()
        editorDecorations.set(highlights_in_text.map((a: Highlight) => {
            // get range from absolute start and end offsets
            let range = monaco.Range.fromPositions(editor.getModel().getPositionAt(a.start), editor.getModel().getPositionAt(a.end))
            let r = {
                range: range,
                options: {
                    isWholeLine: false,
                    className: a.specific ? "light highlight" : "highlight",
                    hoverMessage: { value: a.content }
                }
            }
            return r;
        }))
    }, [editor, props.highlights, monaco, props.inputData, editorDecorations])

    // when validation result changes, add error markers to the editor
    useEffect(() => {
        if (!editor || !monaco || !errorMarkerDecorations) {
            return
        }
        monaco.editor.setModelMarkers(editor.getModel(), "trace", validationResults.errors.filter((e: any) => e.range).map((error: any) => {
            return {
                startLineNumber: error.range.start?.line + 1,
                startColumn: error.range.start?.character + 1,
                endLineNumber: error.range.end?.line + 1,
                endColumn: error.range.end?.character + 1,
                message: error.message,
                severity: monaco.MarkerSeverity.Error
            }
        }), true)

    }, [editor, monaco, validationResults, errorMarkerDecorations])

    // when the editor is mounted, save the editor and monaco instance
    const onMount = (editor: any, monaco: any) => {
        setEditor(editor)
        setMonaco(monaco)
        let collection = editor.createDecorationsCollection()
        setEditorDecorations(collection)
        let errorCollection = editor.createDecorationsCollection()
        setErrorMarkerDecorations(errorCollection)
    }

    // when the editor content changes, update the parent state
    return <Editor defaultLanguage="json" value={props.inputData} onChange={props.handleInputChange} height="100%" theme="vs-light" onMount={onMount} options={{
        // line break
        wordWrap: "on",
        // background color
        minimap: { enabled: false },
        // custom theme with adapted background color
        theme: "vs-light",
    }} />
}

// Props for the RenderedTrace component
interface RenderedTraceProps {
    // the serialized trace to render
    trace: string | object;
    // highlights to highlight in the trace view
    highlights: HighlightedJSON;
    // ID of the trace
    traceId: string
    // a decorator configuration for inline editor (e.g. to annotate a line, or comment on a line)
    decorator?: TraceDecorator;
    // additional components to show before the trace (in the same scroll container)
    prelude?: React.ReactNode;
    // callback when the component is mounted
    onMount?: (events: Record<string, BroadcastEvent>) => void
    // current state of whether all messages are expanded/collapsed 
    // (used to initialize expanded state of messages when they are loaded in
    // after the user has already expanded/collapsed all messages)
    allExpanded?: boolean
}

// state for the RenderedTrace component
interface RenderedTraceState {
    // error that occurred during rendering
    error: Error | null;
    // parsed trace object
    parsed: any | null;
    // last parsed trace string
    traceString: string | object | null;
    // currently selected highlight address (where the inline editor is shown)
    selectedHighlightAddress: string | null;

    // alt key pressed
    altPressed: boolean;

    // broadcast events for the trace view to allow parent components to 
    // expand/collapse all messages
    events: {
        collapseAll: BroadcastEvent,
        expandAll: BroadcastEvent
    }
}

// a broadcast event to allow parent components to call into handlers
// in child views (e.g. to expand/collapse all messages)
class BroadcastEvent {
    listeners: any[]

    constructor() {
        this.listeners = []
    }

    on(listener) {
        this.listeners.push(listener)
    }

    off(listener) {
        this.listeners = this.listeners.filter(l => l !== listener)
    }

    fire(data) {
        this.listeners.forEach(l => l(data))
    }
}

/**
 * Components that renders a list of messages, but handles rendering issues and errors gracefully 
 * on a per-message basis.
 */
export class RenderedTrace extends React.Component<RenderedTraceProps, RenderedTraceState> {
    listRef: any
    viewportRef: any

    constructor(props: RenderedTraceProps) {
        super(props)

        // keep track of parsed trace, as well as the last parsed trace string (so we know when to re-parse)
        this.state = {
            error: null,
            parsed: null,
            traceString: null,
            selectedHighlightAddress: null,
            events: { collapseAll: new BroadcastEvent(), expandAll: new BroadcastEvent() },
            altPressed: false
        }

        this.listRef = React.createRef()
        this.viewportRef = React.createRef()
    }

    componentDidUpdate(): void {
        this.parse()
    }

    componentDidMount() {
        this.parse()
        this.props.onMount?.(this.state.events)

        window.addEventListener("keydown", this.onAltDown)
        window.addEventListener("keyup", this.onAltUp)
    }

    componentWillUnmount() {
        window.removeEventListener("keydown", this.onAltDown)
        window.removeEventListener("keyup", this.onAltUp)
    }

    onAltDown = (e: KeyboardEvent) => {
        if (e.key === "Alt") {
            this.setState({ altPressed: true })
        }
    }

    onAltUp = (e: KeyboardEvent) => {
        if (e.key === "Alt") {
            this.setState({ altPressed: false })
        }
    }

    parse() {
        if (this.state.traceString !== this.props.trace) {
            if (this.state.selectedHighlightAddress) {
                this.setState({ selectedHighlightAddress: null })
            }
            try {
                let parsed = {}
                if (typeof this.props.trace === "object") {
                    parsed = this.props.trace
                } else {
                    parsed = JSON.parse(this.props.trace)
                }

                this.setState({
                    parsed: parsed,
                    error: null,
                    traceString: this.props.trace
                })
            } catch (e) {
                this.setState({ error: e as Error, parsed: null, traceString: this.props.trace })
            }
        }
    }

    onReveal(segments: any[], operation: string) {
        // check if first segment is 'messages', then highlight the list item
        if (segments.length > 1 && segments[0] === "messages" && typeof segments[1] === "number") {
            this.viewportRef.current.scrollToIndex({index: segments[1]})
            // if last segment is L<NUM>
            if (segments.length > 2 && segments[segments.length - 1].startsWith && segments[segments.length - 1].startsWith("L")) {
                if (operation == 'annotations') {
                    this.setState({ selectedHighlightAddress: anchorToAddress(segments) })
                }
            }
        }
    }

    afterReveal(segments: any[], operation: string, element: HTMLElement) {
        if (element && element.classList.contains('annotated') && operation == 'annotations') {
            let line = element.parentElement?.parentElement;
            let lineAddress = line?.getAttribute('data-address');

            this.setState({ selectedHighlightAddress: lineAddress || this.state.selectedHighlightAddress })
        }
    }


    render() {
        if (this.state.error) {
            return <div className="error">
                <div>
                    <h3>Failed to Preview Trace</h3>
                    <pre>
                        {this.state.error.message + "\n"}
                        <pre>
                            {JSON.stringify(this.state.traceString, null, 2)}
                        </pre>
                    </pre>
                </div>
            </div>
        }

        try {
            const highlightContext: HighlightContext = {
                decorator: this.props.decorator,
                selectedHighlightAnchor: this.state.selectedHighlightAddress,
                setSelection: (address: string | null) => {
                    this.setState({ selectedHighlightAddress: address })
                },
                traceId: this.props.traceId
            }
            const events = this.state.parsed ? (Array.isArray(this.state.parsed) ? this.state.parsed : [this.state.parsed]) : []

            return <AnchorDiv id="messages" className={"traces " + (this.state.altPressed ? "alt" : "")} htmlRef={this.listRef} onReveal={this.onReveal.bind(this)} afterReveal={this.afterReveal.bind(this)}>
            {this.props.prelude}
            {/* ViewportList is an external library (react-viewport-list) that ensures that only the visible messages are rendered, improving performance */}
            {/* Note: overscan can be reduce to greatly improve performance for long traces, but then ctrl-f doesn't work (needs custom implementation) */}
            <ViewportList items={events} viewportRef={this.listRef} ref={this.viewportRef} overscan={1000}>
                {(item: any, index: number) => {
                    return <MessageView key={index} index={index} message={item} highlights={this.props.highlights.for_path("messages." + index)} highlightContext={highlightContext} address={"messages[" + index + "]"} 
                                        events={this.state.events} allExpanded={this.props.allExpanded} />
                }}
            </ViewportList>
            {events.length === 0 && <div className="event empty">
                No Messages
            </div>}
        </AnchorDiv>
        } catch (e) {
            this.setState({ error: e as Error })
            return null
        }
    }

    componentDidCatch(error: Error) {
        this.setState({ error })
    }
}

function truncate_content(s: any, length: number) {
    if (typeof s !== "string") {
        return s;
    }
    if (s.length <= length) {
        return s;
    }
    const k = Math.floor(length / 2);
    const truncatedChars = s.length - length;
    return s.substring(0, k) + '<...truncated ' + truncatedChars + ' characters...>' + s.substring(s.length - length + k);
}

/**
 * Props for the MessageView component.
 */
interface MessageViewProps {
    // message object to render
    message: any;
    // index of the message in the trace
    index: number;
    // trace highlights that map to this message
    highlights: HighlightedJSON;
    // context for the highlights
    highlightContext?: HighlightContext;
    // address of the message in the trace
    address: string
    // broadcast events for the trace view to allow parent components to
    // e.g. expand/collapse all messages
    events: Record<string, BroadcastEvent>
    // current state of whether all messages are expanded/collapsed 
    // (used to initialize expanded state of messages when they are loaded in
    // after the user has already expanded/collapsed all messages)
    allExpanded?: boolean
}

/**
 * A component that renders a single message in the trace view, including role, content, and tool calls
 */
function RoleIcon(props: { role: string }) {
    const role = props.role;
    if (role === "user") {
        return <BsPersonFill />
    } else if (role === "assistant") {
        return <BsRobot />
    } else {
        return <BsChatFill />
    }
}

/**
 * Component that renders a message header, including the role and if applicable, a compact view of the message content (e.g. the tool call)
 */
function MessageHeader(props: { className: string, role: string, message: any, expanded: boolean, setExpanded: (state: boolean) => void, address: string }) {
    const [copied, setCopied] = useState(false)
    const [timeout, setTimeoutHandle] = useState(null as any)

    const onCopy = (e: any) => {
        copyPermalinkToClipboard(props.address)
        setCopied(true)
        clearTimeout(timeout)
        setTimeoutHandle(setTimeout(() => setCopied(false), 2000))
    }

    return <div className={"role " + props.className} onClick={() => props.setExpanded(!props.expanded)}>
        {props.expanded ? <BsCaretRightFill /> : <BsCaretDownFill />}
        <RoleIcon role={props.role} />
        {props.role}
        <CompactView message={props} />
        <div className="address" onClick={(e) => {
                onCopy(e);
                e.stopPropagation();
            }} >
            {props.address}
            {copied ? " (copied)" : ""}
        </div>
    </div>
}

// categorical color palette for marking different tools
// to enable easier visual distinction
const categorical_colors = [
    "#E1D1CF",
    "#FFC8C0",
    "#FECF49",
    "#9FE5A2",
    "#B1DBEF",
    "#D0D2F7",
    "#D5D2E8",
    "#D0D5DC"
]

// hashes a string to a color in the categorical color palette
function string_color(s: string) {
    const hash = s.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)
    return categorical_colors[hash % categorical_colors.length]
}

// component that renders a compact view of a message's content, e.g. the associated tool call
function CompactView(props: { message: any }) {
    // get first tool call or use message as tool call
    const message = props.message.message
    let tool_call = message.tool_calls ? message.tool_calls[0] : null
    if (!message.role && message.type == "function") tool_call = message

    // if no tool call, no compact representation
    if (!tool_call) {
        return null
    }

    // get single line of <function_name>(<arguments>)
    const f = tool_call.function

    // format compact representation
    let compact = f.name + "(" + JSON.stringify(f.arguments)
    // replace all newlines with empty space
    compact = compact.replace(/\n/g, " ")
    // truncate to max 50 characters
    compact = compact.substring(0, 50)
    // add ellipsis if truncated
    if (compact.length == 50) {
        compact += "…"
    }
    compact += ")"

    return <span className="badge" style={{ backgroundColor: string_color(f.name) }}>
        {compact}
    </span>
}

/**
 * Component that renders a single message in the trace view, including role, content, and tool calls
 */
class MessageView extends React.Component<MessageViewProps, { error: Error | null, collapsed: boolean }> {
    collapse: () => void
    expand: () => void

    constructor(props: MessageViewProps) {
        super(props)

        this.state = {
            error: null,
            collapsed: typeof props.allExpanded !== "undefined" ? !props.allExpanded : false
        }

        this.collapse = () => this.setState({ collapsed: true })
        this.expand = () => this.setState({ collapsed: false })
        
    }

    componentDidMount(): void {
        this.props.events.collapseAll.on(this.collapse)
        this.props.events.expandAll.on(this.expand)
    }

    componentWillUnmount(): void {
        this.props.events.collapseAll.off(this.collapse)
        this.props.events.expandAll.off(this.expand)
    }

    componentDidCatch(error: Error) {
        this.setState({ error })
    }

    render() {

        if (this.state.error) {
            return <div className="message">
                <h3>Failed to Render Message #{this.props.index}: {this.state.error.message}</h3>
            </div>
        }

        const isHighlighted = this.props.highlights.rootHighlights.length

        try {
            const message = this.props.message            

            if (!message.role) {
                // top-level tool call
                if (message.type == "function") {
                    return <div className={"event tool-call" + (this.state.collapsed ? " expanded" : "")}>
                        <MessageHeader message={message} className="seamless" role="Assistant" expanded={this.state.collapsed} setExpanded={(state: boolean) => this.setState({ collapsed: state })} address={this.props.address} />
                        {!this.state.collapsed && <>
                            <div className="tool-calls seamless">
                                <ToolCallView tool_call={message} highlights={this.props.highlights} highlightContext={this.props.highlightContext} address={this.props.address} message={message} />
                            </div>
                        </>}
                    </div>
                }

                // error message
                return <div className={"event parser-error" + (isHighlighted ? "highlight" : "")}>
                    <div className="content error">
                        <p><b>Failed to render message #{this.props.index}</b>: Could not parse the following as a message or tool call. An event must be either in the form of a messsage (role, content) or a tool call (type, function).</p>
                        <pre>{JSON.stringify(message, null, 2)}</pre>
                    </div>
                </div>
            } else {
                // normal message (role + content and optional tool calls)
                return <AnchorDiv className={"event " + (isHighlighted ? "highlight" : "") + " " + message.role + (this.state.collapsed ? " expanded" : "")} id={permalink(this.props.address, false)} onReveal={() => this.setState({ collapsed: false })} flash={true}>
                    {message.role && <MessageHeader message={message} className="role" role={message.role} expanded={this.state.collapsed} setExpanded={(state: boolean) => this.setState({ collapsed: state })} address={this.props.address} />}
                    {!this.state.collapsed && <>
                        {message.content && <div className={"content " + message.role}>
                            {typeof message.content === "object" ? <MessageJSONContent content={message.content} highlights={this.props.highlights.for_path("content")} highlightContext={this.props.highlightContext} address={this.props.address + ".content"} message={message} /> :
                            <Annotated highlights={this.props.highlights.for_path("content")} highlightContext={this.props.highlightContext} address={this.props.address + ".content"} message={message}>
                                {truncate_content(message.content, config("truncation_limit"))}
                            </Annotated>}
                        </div>}
                        {message.tool_calls && <div className={"tool-calls " + (message.content ? "" : " seamless")}>
                            {message.tool_calls.map((tool_call: any, index: number) => {
                                return <ToolCallView key={index} tool_call={tool_call} highlights={this.props.highlights.for_path("tool_calls." + index)} highlightContext={this.props.highlightContext} address={this.props.address + ".tool_calls[" + index + "]"} message={message} />
                            })}
                        </div>}
                    </>}
                </AnchorDiv>
            }
        } catch (e) {
            this.setState({ error: e as Error })
            return null
        }
    }
}

function MessageJSONContent(props: { content: object, highlights: any, highlightContext?: HighlightContext, address: string, message?: any }) {
    const content = props.content
    const highlights = props.highlights
    const keys = Object.keys(content)

    return <table className="json content">
        <tbody>
            {keys.map((key: string, index: number) => {
                return <tr key={index}>
                    <td className="key"><div>{key}</div></td>
                    <td className="value"><AnnotatedStringifiedJSON highlights={highlights.for_path(key)} address={props.address + "." + key} highlightContext={props.highlightContext} message={props.message}>{typeof content[key] === "object" ? JSON.stringify(content[key], null, 2) : content[key]}</AnnotatedStringifiedJSON></td>
                </tr>
            })}
        </tbody>
    </table>
}

/**
 * Component that renders a tool call in the trace view, including the function name and arguments.
 * 
 * May occur as a top-level tool call or as part of a message.
 */
function ToolCallView(props: { tool_call: any, highlights: any, highlightContext?: HighlightContext, address: string, message?: any }) {
    const tool_call = props.tool_call
    const highlights = props.highlights

    if (tool_call.type != "function") {
        return <pre>{JSON.stringify(tool_call, null, 2)}</pre>
    }

    const f = tool_call.function
    let args = f.arguments;

    const isHighlighted = highlights.rootHighlights.length

    // translate highlights on arguments back into JSON source ranges
    const argumentHighlights = highlights.for_path("function.arguments")

    return <AnchorDiv className={"tool-call " + (isHighlighted ? "highlight" : "")} id={permalink(props.address, false)}>
        <div className="function-name">
            <Annotated highlights={highlights.for_path("function.name")} highlightContext={props.highlightContext} address={props.address + ".function.name"} message={props.message}>
                {f.name || <span className="error">Could Not Parse Function Name</span>}
            </Annotated>
            <div className="address">
                {props.address}
            </div>
        </div>
        <div className="arguments">
            <pre>
                <HighlightedJSONTable tool_call={props.tool_call} highlights={argumentHighlights} highlightContext={props.highlightContext} address={props.address + ".function.arguments"} message={props.message}>
                </HighlightedJSONTable>
            </pre>
        </div>
    </AnchorDiv>
}

/**
 * Component that renders a JSON object as a table with keys and values, highlighting specific ranges in the JSON.
 * 
 * Supports passing down the corresponding highlights to the keys and values.
 * 
 * Used to render the different arguments of a tool call.
 */
function HighlightedJSONTable(props: { tool_call: any, highlights: any, highlightContext?: HighlightContext, address: string, message?: any }) {
    const tool_call = props.tool_call
    const highlights = props.highlights

    if (tool_call.type != "function") {
        return <pre>{JSON.stringify(tool_call, null, 2)}</pre>
    }

    const f = tool_call.function
    let args = f.arguments;
    let keys: string[] = []

    // format args as error message if undefined
    if (typeof args === "undefined") {
        return <span className="error">No .arguments field found</span>
    } else if (typeof args === "object") {
        args = Object.fromEntries(
            Object.entries(args).map(([key, value]) => [
                truncate_content(key, config("truncation_limit")),
                truncate_content(value, config("truncation_limit"))
            ])
        )
        keys = Object.keys(args)
    } else {
        return <div className='direct'><AnnotatedStringifiedJSON highlights={highlights} address={props.address} message={props.message} highlightContext={props.highlightContext}>{truncate_content(args, config("truncation_limit"))}</AnnotatedStringifiedJSON></div>
    }

    if (keys.length === 0) {
        return <pre style={{ paddingLeft: "5pt" }}>{'{}'}</pre>
    }

    return <table className="json">
        <tbody>
            {keys.map((key: string, index: number) => {
                return <tr key={index}>
                    <td className="key"><div>{key}</div></td>
                    <td className="value"><AnnotatedStringifiedJSON highlights={highlights.for_path(key)} address={props.address + "." + key} highlightContext={props.highlightContext} message={props.message}>{typeof args[key] === "object" ? JSON.stringify(args[key], null, 2) : args[key]}</AnnotatedStringifiedJSON></td>
                </tr>
            })}
        </tbody>
    </table>
}

function replaceNLs(content: string, key: string) {
    let elements: any[] = []

    if (!content.includes("\n")) {
        return content
    } else {
        let lines = content.split("\n")
        for (let i = 0; i < lines.length; i++) {
            elements.push(lines[i])
            elements.push(<span className="nl" key={'newline-' + key + '-ws-' + i}>↵</span>)
            elements.push("\n")
        }
        elements.pop()
        elements.pop()
        return elements
    }
}

function Annotated(props: { highlights: any, children: any, highlightContext?: HighlightContext, address?: string, message?: any }) {
    const parentElement = useRef(null as any);

    const [contentElements, setContentElements] = useState([] as any)
    const [plugin, setPlugin] = useState(null as any);
    const [pluginEnabled, setPluginEnabled] = useState(true);

    // derive the rendering plugin to use for this content
    useEffect(() => {
        // serialize JSON objects to strings
        const content = props.children.toString()
        // first check if there is a render plugin that can render this content
        const plugins = Plugins.getPlugins()
        const match = plugins.find((plugin: any) => plugin.isCompatible(props.address, props.message, content))
        if (match) {
            setPlugin(match)
        } else {
            // use default rendering
            setPlugin(null)
        }
    }, [props.children])

    useEffect(() => {
        const content = props.children.toString()
        const elements: React.ReactNode[] = []

        if (plugin && pluginEnabled) {
            setContentElements([<plugin.component {...props} content={content} key="plugin-view-0" />])
            return
        }

        let highlights_in_text = props.highlights.in_text(JSON.stringify(content, null, 2))
        highlights_in_text = HighlightedJSON.disjunct(highlights_in_text)
        let highlights_per_line = HighlightedJSON.by_lines(highlights_in_text, '"' + content + '"');

        for (const highlights of highlights_per_line) {
            let line: React.ReactNode[] = []
            for (const interval of highlights) {
                // additionally highlight NLs with unicode character
                let c = content.substring(interval.start - 1, interval.end - 1)
                c = replaceNLs(c, 'content-' + interval.start + "-" + interval.end)
                if (interval.content === null) {
                    line.push(<span key={(elements.length) + "-" + interval.start + "-" + interval.end} className="unannotated">
                        {c}
                    </span>)
                } else {
                    const addr = props.address + ":" + (interval.start - 1) + "-" + (interval.end - 1)
                    const permalink_id = permalink(addr, false)

                    const message_content = content.substring(interval.start - 1, interval.end - 1)
                    let className = "annotated" + " " + interval.content.filter(c => c['source']).map(c => "source-" + c['source']).join(" ")
                    const tooltip = interval.content.map(c => truncate('[' + c['source'] + ']' + ' ' + c['content'], 100)).join("\n")
                    line.push(<span key={(elements.length) + "-" + (interval.start) + "-" + (interval.end)} className={className} data-tooltip-id={'highlight-tooltip'} data-tooltip-content={tooltip} id={permalink_id}>{message_content}</span>)
                }
            }
            const line_highlights = highlights
                .filter(a => a.content)
                .map(a => ({
                    snippet: content.substring(a.start - 1, a.end - 1),
                    start: a.start - 1,
                    end: a.end - 1,
                    content: a.content
                }))
            elements.push(<Line key={'line-' + elements.length} highlights={line_highlights} highlightContext={props.highlightContext} address={props.address + ":L" + elements.length}>{line}</Line>)
        }
        setContentElements(<div className='default-renderer'>{elements}</div>)
    }, [plugin, pluginEnabled, props.highlights, props.children, props.highlightContext?.selectedHighlightAnchor, props.highlightContext?.decorator])

    return <div ref={parentElement} className="annotated-parent text">
        {plugin && <button className="plugin-toggle" onClick={() => setPluginEnabled(!pluginEnabled)}>
            {pluginEnabled ? 'Formatted' : 'Raw'}
        </button>}
        {contentElements}
    </div>
}

function AnnotatedStringifiedJSON(props: { highlights: any, children: any, highlightContext?: HighlightContext, address: string, message?: any }) {
    const parentElement = useRef(null as any);

    const [contentElements, setContentElements] = useState([] as any)
    const [plugin, setPlugin] = useState(null as any);
    const [pluginEnabled, setPluginEnabled] = useState(true);

    // derive the rendering plugin to use for this content
    useEffect(() => {
        const content = props.children.toString()
        // first check if there is a render plugin that can render this content
        const plugins = Plugins.getPlugins()
        const match = plugins.find((plugin: any) => plugin.isCompatible(props.address, props.message, content))
        if (match) {
            setPlugin(match)
        } else {
            // use default rendering
            setPlugin(null)
        }
    }, [props.children])

    useEffect(() => {
        const content = props.children.toString()
        const elements: React.ReactNode[] = []

        if (plugin && pluginEnabled) {
            setContentElements([<plugin.component {...props} content={content} key="plugin-view-0" />])
            return
        }

        let highlights_in_text = props.highlights.in_text(content)
        highlights_in_text = HighlightedJSON.disjunct(highlights_in_text)
        let highlights_per_line = HighlightedJSON.by_lines(highlights_in_text, content)

        for (const line_highlights of highlights_per_line) {
            let line: React.ReactNode[] = []
            for (const interval of line_highlights) {
                // for (const interval of highlights_in_text) {
                if (interval.content === null) {
                    line.push(<span key={interval.start + "-" + interval.end} className="unannotated">
                        {content.substring(interval.start, interval.end)}
                    </span>)
                } else {
                    const addr = props.address + ":" + (interval.start - 1) + "-" + (interval.end - 1)
                    const permalink_id = permalink(addr, false)
                    
                    const message_content = props.children.toString().substring(interval.start, interval.end)
                    let className = "annotated" + " " + interval.content.filter(c => c['source']).map(c => "source-" + c['source']).join(" ")
                    const tooltip = interval.content.map(c => truncate('[' + c['source'] + ']' + ' ' + c['content'], 100)).join("\n")
                    line.push(<span key={(interval.start) + "-" + (interval.end)} className={className} data-tooltip-id={'highlight-tooltip'} data-tooltip-content={tooltip} id={permalink_id}>
                        {message_content}
                    </span>)
                }
            }
            const highlights = line_highlights
                .filter(a => a.content)
                .map(a => ({
                    snippet: content.substring(a.start, a.end),
                    start: a.start,
                    end: a.end,
                    content: a.content
                }))
            elements.push(<Line key={'line-' + elements.length} highlights={highlights} highlightContext={props.highlightContext} address={props.address + ":L" + elements.length}>{line}</Line>)
        }
        setContentElements(elements)
    }, [plugin, pluginEnabled, props.highlights, props.children, props.highlightContext])

    return <div ref={parentElement} className="annotated-parent">
        {plugin && <button className="plugin-toggle" onClick={() => setPluginEnabled(!pluginEnabled)}>
            {pluginEnabled ? 'Formatted' : 'Raw'}
        </button>}
        {contentElements}
    </div>
}

