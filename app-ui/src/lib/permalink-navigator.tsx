/**
 * Enables adressing of page elements by their address.
 * 
 * In case of nested e.g. tool calls or highlights, `Reveal` also supports
 * to first unfold the relevant parent elements before flashing the leaf element.
 */

import { useEffect, useRef } from "react";

interface RevealOptions {
    // the operation to perform on the leaf element (e.g. 'annotations' to open the annotations editor)
    operation: string;
    // whether the reveal flashes the target element
    flash?: boolean;
    // whether the reveal also updates the hash
    setHash?: boolean;

    // timeout for ID search
    timeout: number;
}

const DEFAULT_REVEAL_OPTIONS: RevealOptions = {
    operation: '',
    flash: true,
    setHash: true,
    timeout: 1000
}

// class to capture the order in which we are waiting for DOM element ids to appear
// and to unfold them in the correct order until we reach the leaf element to highlight
export class Reveal {
    // unique id of the reveal process
    id: number;
    // hash to unfold
    hash: string;
    // container element IDs to unfold in order
    ids: string[];
    // segments of leaf element address to highlight (e.g. ["messages", 7, "content", [21, 30]]) for messages.7.content:21-30
    segments: any[];
    // operation to perform on the leaf element (empty string, means it only flashes)
    operation: string;
    // stack of elements that were unfolded so far
    elementStack: HTMLElement[];
    
    cancelled: boolean;
    done: boolean;
    lastSearchStart: number;

    // elements that are currently being flashed
    flashed: HTMLElement[];

    // options
    options: RevealOptions;

    constructor(id: number, ids: string[], segments: any[], hash: string, operation: string, options: Partial<RevealOptions> = {}) {
        this.id = id;
        
        this.ids = ids;
        this.segments = segments;
        this.hash = hash;
        this.operation = operation;
        this.cancelled = false;
        this.done = false;
        this.lastSearchStart = new Date().getTime();
        // stack of elements that were unfolded so far
        this.elementStack = []

        this.options = Object.assign({}, DEFAULT_REVEAL_OPTIONS, options);

        // elements that are currently being flashed
        this.flashed = []

        window.requestAnimationFrame(() => {
            this.reveal();
        })
    }

    // cancel the unfolding process (e.g. when the user navigates around or the hash changes)
    cancel() {
        if (this.done) {
            return;
        }
        this.cancelled = true;

        this.flashed.forEach((element) => {
            if (element.getAttribute('data-anchor-flash-id') == this.id.toString()) {
                element.removeAttribute('data-anchor-highlight');
                element.removeAttribute('data-anchor-flash');
                element.removeAttribute('data-anchor-parent-flash');
                element.removeAttribute('data-anchor-flash-id');
            }
        })
    }

    isLeaf() {
        return this.ids.length === 1;
    }

    flash(element, parent=false) {
        if (!this.options.flash) {
            return;
        }

        // instead of class names use data-anchor-highlight and data-anchor-flash
        // note: we use data-* attributes here because, class is also set by react, which can 
        // create race conditions, data-* attributes are not touched by react and
        // can still be used to style the element
        element.setAttribute('data-anchor-highlight', 'true');
        element.setAttribute('data-anchor-flash-id', this.id.toString());

        this.flashed.push(element);

        const duration = parent ? 1000 : 1000;

        if (!parent) {
            element.setAttribute('data-anchor-flash', 'true');
        } else {
            element.setAttribute('data-anchor-parent-flash', 'true');
        }
        
        setTimeout(() => {
            if (element.getAttribute('data-anchor-flash-id' !== this.id.toString())) {
                return;
            }
            element.removeAttribute('data-anchor-highlight');
        }, duration * 2);
    }

    scrollIntoView(element) {
        // if element already more than 50% visible, don't scroll
        let rect = element.getBoundingClientRect();
        if (rect.top > 0 && rect.top < window.innerHeight * 0.5) {
            return;
        }

        element.scrollIntoView({ behavior: 'instant', block: 'center' });
    }

    // try to retrieve next id and reveal it (pop id from list if successful,
    // otherwise wait for the next frame and try again)
    reveal() {  
        // console.log("revealing", this.ids[0], "operation=" + this.operation);

        // if a search takes longer than 5s, cancel it
        if (new Date().getTime() - this.lastSearchStart > this.options.timeout) {
            this.cancel();
            return;
        }

        if (this.cancelled) {
            return;
        }

        // console.log("unfolding", this.ids[0], "operation=" + this.operation);
        let element = document.getElementById(this.ids[0]);

        if (element) {
            this.elementStack.push(element);

            this.scrollIntoView(element);
            let onReveal = getOnReveal(element);
            onReveal(this.segments, this.operation);

            if (this.isLeaf() || element.classList.contains('permalink-flash')) {
                this.flash(element, !this.isLeaf());
            }

            if (this.isLeaf()) {
                this.finalize(element);
            }

            this.ids.shift();
            this.lastSearchStart = new Date().getTime();
            
            if (this.ids.length === 0) {
                this.done = true;
                return;
            } else {
                window.requestAnimationFrame(() => {
                    this.reveal();
                })
            }
        } else {
            window.requestAnimationFrame(() => {
                this.reveal();
            })
        }
    }

    finalize(element) {
        // finalize the reveal 
        
        // call all afterReveal listener on all traversed parent contains, in
        // case they have additional behavior based on the actual leaf element
        this.elementStack.forEach((e) => {
            const afterReveal = getAfterReveal(e);
            afterReveal(this.segments, this.operation, element);
        })

        if (this.options.setHash) {
            // set the hash to the current address
            window.location.hash = this.hash;
        }
    }

    static create(ids: string[], segments: any[], hash: string, operation: string, options: Partial<RevealOptions> = {}) {
        if (window['ACTIVE_REVEAL']) {
            window['ACTIVE_REVEAL'].cancel();
        }
        
        let id = window['REVEAL_COUNT'];
        window['REVEAL_COUNT'] += 1;
        
        window['ACTIVE_REVEAL'] = new Reveal(id, ids, segments, hash, operation, options);
        
        return window['ACTIVE_REVEAL'];
    }
}

window['ACTIVE_REVEAL'] = null;
window['REVEAL_COUNT'] = 0;

/**
 * Programmatically reveal an element by address on the current page.
 */
export function reveal(address: string, operation: string = '', escape=true, options: Partial<RevealOptions> = {}) {
    let link = escape ? permalink(address, true) : address;
    let [segments, _] = parse(link);
    let ids = segmentsToIds(segments);
    return Reveal.create(ids, segments, link, operation, options);
}

/**
 * Converts an array of segments in a permalink address to an 
 * array of HTML element IDs to reveal in order.
 */
function segmentsToIds(segments) {
    // [Log] segmentsToIds – ["messages", 11, "content", …] (4) (permalink-navigator.ts, line 29)
    //  ["messages", 11, "content", [20, 30]]
    let ids: string[] = [];
    let prefix = "";
    let trace_object = segments.length > 0 && segments[0] === 'messages';

    for (let i = 0; i < segments.length; i++) {
        let s = segments[i];
        // string segments we append to the prefix
        if (typeof s === 'string') {
            if (s.startsWith('L') && i == segments.length - 1) {
                ids.push(prefix ? prefix + '-' + s : s);
                continue;
            }
            if (s != "messages" && trace_object) {
                prefix += prefix ? '-' + s : s;
                continue;
            }
            ids.push(prefix ? prefix + '-' + s : s);
            prefix += prefix ? '-' + s : s;
        } else if (typeof s === 'number') {
            // number segments we append to the prefix
            ids.push(prefix ? (prefix + '-' + s) : (""+s));
            prefix += prefix ? '-' + s : '' + s;
        } else if (Array.isArray(s)) {
            // array segments we append to the prefix
            ids.push(prefix ? prefix + '-' + s.join('-') : s.join('-'));
            prefix += prefix ? '-' + s.join('-') : s.join('-');
        }
    }

    return ids;
}

export let ACTIVE_HASH = '';

/**
 * Install the permalink navigator.
 * 
 * This function should be called once in the application to install the permalink navigator.
 * 
 * It listens for hash changes and navigates to the relevant HTML DOM element as soon as it appears.
 */
export function install() {
    function onHashChange() {
        let h = window.location.hash;
        ACTIVE_HASH = h;
        let [full, operation] = parse(h);

        if (h === '#' || h === '') {
            return;
        }

        let ids = segmentsToIds(full);
        Reveal.create(ids, full, h, operation);
    }

    window.addEventListener('hashchange', onHashChange);
    onHashChange();
}

/**
 * Converts a string to a permalink.
 * 
 * The following transformations are applied:
 * 
 * `.` -> `/`
 * `[` -> `/n/`
 * `]` -> ``
 * `:` -> `/`
 * `[^a-zA-Z0-9/]` -> `-`
 * 
 * If `link` is false, then after all this, all `/` are replaced with `-`.
*/
export function permalink(s: string, link=true) {
    let original = s;

    s = s.replace(/\./g, '/');
    s = s.replace(/\[/g, '/');
    s = s.replace(/\]/g, '');
    s = s.replace(/\:/g, '/');
    s = s.replace(/[^a-zA-Z0-9/]/g, '-');

    // when generating the id, remove the dash
    if (!link) s = s.replace(/\//g, '-');

    return s;
}

/**
 * Parses a hash of the format `#a/b/c/n/1/d/2:1-10` into an array of segments and an operation.
 * 
 * The output to the above hash would be `[['a', 'b', 'c', 1, 'd', 2, [1, 10]], '']`.
 * 
 * Other supported formats include:
 * 
 * `abc` -> `[['abc'], '']`
 * `abc:<query>` -> `[['abc'], '<query>']`
 * `abc/L2` -> `[['abc', 'L2'], '']`
 * `abc/L2:<query>` -> `[['abc', 'L2'], '<query>']`
 */
export function parse(hash: string): [any[], string] {
    // if there is more than one #, we only take the first part as the hash and the remainder as operation
    // make sure there is at least one #
    hash = hash.replace(/^#/, '');

    let operation = '';
    // if there is a color, split by it
    if (hash.includes(':')) {
        [hash, operation] = hash.split(':');
    }
    
    const parts = hash.split('/');
    const result: (string | number | number[])[] = [];
    for (let i = 0; i < parts.length; i++) {
        if (parts[i].includes('-') && i + 1 === parts.length) {
            result.push(parts[i].split('-').map(x => parseInt(x)));
        } else if (!isNaN(parseInt(parts[i]))) {
            result.push(parseInt(parts[i]));
        } else {
            // check if int and convert
            if (!isNaN(parseInt(parts[i]))) {
                result.push(parseInt(parts[i]));
            } else {
                result.push(parts[i]);
            }
        }
    }

    return [result, operation || ''];
}

interface AnchorDivProps {
    // id of the element
    id: string;
    // function to call when the element is revealed
    onReveal: (segments: any) => void;
    // children to wrap
    children: any;
    // reference to the HTML element
    htmlRef?: React.RefObject<HTMLDivElement>;
    // whether the element should flash when revealed
    flash?: boolean;
    // function to call after the element is revealed
    afterReveal?: (segments: any[], operation: string, leafElement: HTMLElement) => void;
    // whether to copy the permalink to the clipboard on click
    copyOnClick?: boolean;
}

/**
 * AnchorDiv is a `div` that can be used to wrap any content that should be linkable by a permalink (a link that when opened
 * opens the same page and scrolls to this component).
 * 
 * @param props 
 * - id: the id of the element
 * - onReveal: a function that is called when the element is revealed (e.g. scrolled into view because of a permalink reveal)
 * - children: the content to wrap
 * - htmlRef: a reference to the HTML element
 * - flash: whether the element should flash when revealed (also applies when actual permalink target is a child of this element)
 * - afterReveal: a function that is called after the element is revealed. Receives the segments, operation and the leaf HTML element that the reveal ended on.
 */
export function AnchorDiv(props: any & AnchorDivProps) {
    // props without onReveal, id
    let { onReveal, copyOnClick, afterReveal, id, flash, htmlRef, className, ...rest } = props
    const ref = useRef(null)

    if (flash) {
        className = (className || '') + ' permalink-flash';
    }
    
    useEffect(() => {
        if (htmlRef) htmlRef.current = ref.current;
        
        if (ref.current) {
            addAnchorRevealListener(ref.current, (segments: any[], operation: string) => {
                if (onReveal) onReveal(segments, operation);
            })
            if (afterReveal) {
                addAnchorAfterRevealListener(ref.current, (segments: any[], operation: string, leafElement: HTMLElement) => {
                    afterReveal(segments, operation, leafElement);
                })
            }
        }

        return () => {
            if (ref.current) {
                removeAnchorRevealListener(ref.current);
                
                if (afterReveal) {
                    removeAnchorAfterRevealListener(ref.current);
                }
            }
        }
    }, [ref.current]);

    const onClick = (e) => {
        if (copyOnClick) {
            const link = window.location.protocol + "//" + window.location.host + window.location.pathname + window.location.search + "#" + id
            navigator.clipboard.writeText(link)
            alert('info: Copied permalink to clipboard ' + link)

        }
        if (props.onClick) props.onClick(e);
    }

    return <div id={id} {...rest} ref={ref} className={className} onClick={onClick}>
        {props.children}
    </div>
}

export function addAnchorRevealListener(element: HTMLElement, onReveal: (segments: any, operation: string) => void) {
    element['permalink-on-reveal'] = onReveal;
}

export function removeAnchorRevealListener(element: HTMLElement) {
    delete element['permalink-on-reveal'];
}

export function addAnchorAfterRevealListener(element: HTMLElement, afterReveal: (segments: any[], operation: string, leafElement: HTMLElement) => void) {
    element['permalink-after-reveal'] = afterReveal;
}

export function removeAnchorAfterRevealListener(element: HTMLElement) {
    delete element['permalink-after-reveal'];
}

export function getOnReveal(element: HTMLElement) {
    return element['permalink-on-reveal'] || ((segments, operation) => {})
}

export function getAfterReveal(element: HTMLElement) {
    return element['permalink-after-reveal'] || ((segments, operation, leafElement) => {})
}

export function copyPermalinkToClipboard(address: string) {
    const link = window.location.protocol + "//" + window.location.host + window.location.pathname + window.location.search + "#" + permalink(address, true)
    navigator.clipboard.writeText(link)
    alert('Copied permalink to clipboard ' + link)
}

export function anchorToAddress(segments: any) {
    let a = "";
    for (let i = 0; i < segments.length; i++) {
        let s = segments[i];
        if (typeof s === 'string') {
            if (s.match(/^L\d+$/) && i == segments.length - 1) {
                // for :L2 line markers
                a += ":" + s;
            } else {
                a += "." + s;
            }
        } else if (typeof s === 'number') {
            // for array indices
            a += '[' + s + ']';
        } else if (Array.isArray(s)) {
            // for character ranges
            a += ':' + s.join('-');
        } else {
            console.error("unknown segment type", s, "in", segments);
        }
    }
    // ltrim .
    if (a.startsWith('.')) a = a.substring(1);

    // replace .[ occurrences with [
    return a;
}