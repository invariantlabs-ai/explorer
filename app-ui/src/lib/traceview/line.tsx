import React, { useState } from "react"
import { GroupedHighlight } from "./highlights";
import { useTelemetry } from "../../telemetry";
import { BsArrowUp, BsArrowDown } from "react-icons/bs";
import { useRemoteResource } from "../../RemoteResource";
import { Annotations, THUMBS_UP, THUMBS_DOWN } from "../../AnnotationAugmentedTraceView";
import { useUserInfo } from "../../UserInfo";
import { alertSignup } from "../../SignUpModal";
import { permalink } from "../permalink-navigator";

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
    traceId?: string
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
export function Line(props: { children: any, highlightContext?: HighlightContext, address?: string, highlights?: GroupedHighlight[]}) {
    const decorator = props.highlightContext?.decorator
    const telemetry = useTelemetry();
    const userInfo = useUserInfo();

    let traceId = props.highlightContext?.traceId;
    const [annotations, annotationStatus, annotationsError, annotator] = useRemoteResource(Annotations, traceId)
    const [isThumbsUpHovered, setIsThumbsUpHovered] = useState(false);
    const [isThumbsDownHovered, setIsThumbsDownHovered] = useState(false);

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
    const className = "line " + (props.highlights?.length ? "has-highlights" : "") + (userInfo?.loggedIn ? " logged-in" : "")
    let extraClass = " "
    let thumbsUp = false, thumbsDown = false;

    if (!decorator) {
        return <span className={className}>{props.children}</span>
    }

    if (decorator.hasHighlight) {
        let highlightResult = decorator.hasHighlight(props.address, ...decorator.extraArgs);
        if (typeof highlightResult === "boolean") {
            extraClass += "highlighted"
        } else if (typeof highlightResult === "string") {
            let result = highlightResult as string;
            thumbsUp = thumbsUp || result.includes("thumbs-up")
            thumbsDown = thumbsDown || result.includes("thumbs-down")
            extraClass += result;
        }
    }

    const onClickLine = () => {
        setExpanded(!expanded)
        if (!expanded) telemetry.capture("traceview.opened-annotation-editor")
    }

    let threadAnnotations = []
    if (props.address) {
        threadAnnotations = (annotations || {})[props.address] || []
    }

    const handleThumbsUp = (e: React.MouseEvent) => {
        const existingThumbAnnotations = threadAnnotations
            .filter(annotation => annotation["content"] === THUMBS_UP || annotation["content"] === THUMBS_DOWN)

        if (!userInfo?.loggedIn) {
            alertSignup("label agent traces");
            e.stopPropagation();
            return;
        }

        let existing = (userInfo?.id && existingThumbAnnotations.find(a => a["user"]["id"] === userInfo?.id))
        if (existing) {
            annotator?.delete(existing["id"]).then(() => {
                annotator?.refresh();
            }).catch((error) => {
                console.error("error deleting thumbs up", error);
            })
            e.stopPropagation();
            
            // if same as before, untoggle it
            if (existing["content"] === THUMBS_UP) {
                return;
            }
            // otherwise add opposite
        }

        e.stopPropagation();

        annotator?.create({ address: props.address, content: THUMBS_UP }).then(() => {
            annotator?.refresh();
        }).catch((error) => {
            console.error("error saving thumbs up", error);
        });
    };

    const handleThumbsDown = (e: React.MouseEvent) => {
        const existingThumbAnnotations = threadAnnotations
            .filter(annotation => annotation["content"] === THUMBS_DOWN || annotation["content"] === THUMBS_UP)

        if (!userInfo?.loggedIn) {
            alertSignup("label agent traces");
            e.stopPropagation();
            return;
        }

        let existing = (userInfo?.id && existingThumbAnnotations.find(a => a["user"]["id"] === userInfo?.id))
        if (existing) {
            annotator?.delete(existing["id"]).then(() => {
                annotator?.refresh();
            }).catch((error) => {
                console.error("error deleting thumbs down", error);
            })
            e.stopPropagation();
            
            // if same as before, untoggle it
            if (existing["content"] === THUMBS_DOWN) {
                return;
            }
            // otherwise add opposite
        }

        e.stopPropagation();
        
        annotator?.create({ address: props.address, content: THUMBS_DOWN }).then(() => {
            annotator?.refresh();
        }).catch((error) => {
            console.error("error saving thumbs down", error);
        });
    };

    const id = permalink(props.address || '', false);

    if (!expanded) {
        return <span 
            id={id} data-address={props.address}
            className={`${className}${extraClass} unexpanded ${isThumbsUpHovered ? 'hovered-up' : isThumbsDownHovered ? 'hovered-down' : ''}`}> 
            <SelectableSpan onActualClick={onClickLine} className={isThumbsUpHovered ? 'hovered-up' : isThumbsDownHovered ? 'hovered-down' : ''}>
                {props.children}
                <div className={"thumbs " + (thumbsUp || thumbsDown ? "visible" : "")}>
                    {<BsArrowUp 
                        onClick={handleThumbsUp} 
                        className={'thumbs-up-icon up ' + (thumbsUp ? "toggled" : "")}                     
                        onMouseEnter={() => setIsThumbsUpHovered(true)}
                        onMouseLeave={() => setIsThumbsUpHovered(false)}
                    />}
                    {<BsArrowDown 
                        onClick={handleThumbsDown} 
                        className={'thumbs-down-icon down ' + (thumbsDown ? "toggled" : "")} 
                        onMouseEnter={() => setIsThumbsDownHovered(true)}
                        onMouseLeave={() => setIsThumbsDownHovered(false)}
                    />}
                </div>
            </SelectableSpan>
        </span>
    }

    const InlineComponent: any = decorator.editorComponent
    const content = InlineComponent({ highlights: props.highlights, address: props.address, onClose: () => {setExpanded(false);} })

    if (content === null) {
        return <span id={id} data-address={props.address} className={className}>{props.children}</span>
    }

    return <span 
        className={className + (expanded ? ' expanded ' : '') + extraClass}
        id={id} data-address={props.address}
    >
        <SelectableSpan onActualClick={onClickLine}>
            {props.children}
        </SelectableSpan>{expanded && <div className="inline-line-editor">
        {content}
    </div>}</span>
}

/**
 * Like a <span>...</span> but only triggers the onActualClick handler when the span 
 * is clicked and the user did not just select text.
 * 
 * If a user selects text, the click event is not triggered.
 */
function SelectableSpan(props: { children: any, onActualClick: () => void, className?: string }) {
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

    return <span className={`selectable ${props.className || ''}`} onClick={handler}>{props.children}</span>
}