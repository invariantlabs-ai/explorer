import React from "react"
import { GroupedHighlight } from "./highlights";

/** A way to provide inline decorations to a rendered trace view. */
export interface TraceDecorator {
    // component to use as inline editor (instantiated with props: { highlights: GroupedHighlight[], address: string, onClose: () => void })
    editorComponent: React.ComponentType
    // returns true, if a given address is highlighted (e.g. hints at highlights being present)
    hasHighlight?: (address?: string, ...args: any) => boolean

    // global extra args that are passed to editor and hasHighlight functions
    extraArgs?: any
}

// context for the highlight state of a line of content (cf. <Line/>)
export interface HighlightContext {
    // currently selected highlight address
    selectedHighlightAnchor: string | null
    // set the selected highlight address
    setSelection: (address: string | null) => void
    // decorator configuration of the component to show
    // when the inline editor is shown
    decorator?: TraceDecorator
}

/**
 * Renders a single line of content in a trace view (e.g. a line of code in a tool output, a line of user input, a line of the value of a tool call argument).
 * 
 * Wrapping content in a <Line/> enables line-level annotations and also supports highlights as part of the content (e.g. to mark analyzer or search results).
 * 
 * @param props
 *  - children: the content to render
 *  - highlightContext: the highlight context to use for this line (includes the component to show when the line is clicked)
 *  - address: the address of the line (e.g. the address of the tool call argument, message, or line of code)
 *  - highlights: the highlights to show on this line (e.g. search results, analyzer results)
 */
export function Line(props: { children: any, highlightContext?: HighlightContext, address?: string, highlights?: GroupedHighlight[] }) {
    // const [expanded, setExpanded] = useState(false)
    const decorator = props.highlightContext?.decorator

    const setExpanded = (state: boolean) => {
        if (!props.address) {
            return;
        }

        if (!state && props.address === props.highlightContext?.selectedHighlightAnchor) {
            props.highlightContext?.setSelection(null)
        } else {
            props.highlightContext?.setSelection(props.address)
        }
    }

    const expanded = props.address === props.highlightContext?.selectedHighlightAnchor
    const className = "line " + (props.highlights?.length ? "has-highlights" : "")
    let extraClass = " "

    if (!decorator) {
        return <span className={className}>{props.children}</span>
    }

    if (decorator.hasHighlight) {
        let highlightResult = decorator.hasHighlight(props.address, ...decorator.extraArgs);
        if (typeof highlightResult === "boolean") {
            extraClass += "highlighted"
        } else if (typeof highlightResult === "string") {
            extraClass += highlightResult
        }
    }

    if (!expanded) {
        return <span id='unexpanded' className={className + extraClass}><SelectableSpan onActualClick={() => setExpanded(!expanded)}>{props.children}</SelectableSpan></span>
    }

    const InlineComponent: any = decorator.editorComponent
    const content = InlineComponent({ highlights: props.highlights, address: props.address, onClose: () => setExpanded(false) })

    if (content === null) {
        return <span className={className}>{props.children}</span>
    }

    return <span className={className + extraClass}><SelectableSpan onActualClick={() => setExpanded(!expanded)}>{props.children}</SelectableSpan>{expanded && <div className="inline-line-editor">
        {content}
    </div>}</span>
}

/**
 * Like a <span>...</span> but only triggers the onActualClick handler when the span 
 * is clicked and the user did not just select text.
 * 
 * If a user selects text, the click event is not triggered.
 */
function SelectableSpan(props: { children: any, onActualClick: () => void }) {
    const handler = (e: React.MouseEvent) => {
        const selection = window.getSelection()
        if (selection && selection.toString().length > 0) {
            return
        }

        // when shift or alt key is pressed, do not trigger
        if (e.shiftKey || e.altKey) {
            return
        }
        
        // set super short interval to not trigger on double click
        props.onActualClick()
    }

    return <span onClick={handler}>{props.children}</span>
}