import IntervalTree from '@flatten-js/interval-tree'
import jsonMap from "json-source-map"

/** A single highlight, with a start and end offset in the source text or leaf string, and a content field. */
export interface Highlight {
    start: number
    end: number
    content: any

    // specifies whether this highlight is range specific, or marks a higher-level
    // range like an entire object
    specific?: boolean
}

/** Like a regular highlight, but stores a list of highlights per range. */
export interface GroupedHighlight {
    start: number
    end: number
    content: Highlight[] | null
}


/** Hierarchical representation of highlights like 
 * { a: { b: { c: { $highlights: [ { start: 0, end: 5, content: "highlight" } ] } } } }
 */
interface HighlightMap {
    $highlights: Highlight[]
    [key: string]: any
}

/** Returns an empty highlight map. */
function empty(): HighlightMap {
    return { $highlights: [] }
}

/**
 * Tracks highlights of an arbitrary JSON object, and provides methods to extract highlights for a given path.
 * 
 * Use `HighlightedJSON.from_mappings` to create an instance from a list of highlights as shown below.
 */
export class HighlightedJSON {
    // immutable representation of all highlights organized by path (do not modify directly)
    highlightsMap: HighlightMap
    // caches results of `for_path` calls to maintain as much shared state as possible (avoids re-rendering in react)
    cachedSubs: Record<string, HighlightedJSON>

    constructor(highlights: HighlightMap) {
        this.highlightsMap = highlights as HighlightMap
        this.cachedSubs = {}
    }

    /**
     * Returns a new HighlightedJSON object that represents the highlights for the given path in the highlighted object.
     * 
     * E.g. if the highlighted object is: `{a: {b: {c: 1, d: 2}}}` and the highlights are [{key: "a.b.c:0-5", value: "highlight1"}],
     * then `for_path("a.b")` will return a new HighlightedJSON object with highlights [{key: "c:0-5", value: "highlight1"}].
     */
    for_path(path: string): HighlightedJSON {
        if (!this.highlightsMap) {
            return EMPTY_ANNOTATIONS
        }

        if (this.cachedSubs[path]) {
            return this.cachedSubs[path]
        }

        let tree = this.highlightsMap

        for (const key of path.split('.')) {
            if (!tree[key]) {
                return EMPTY_ANNOTATIONS
            }
            tree = tree[key]
        }

        if (tree.$highlights?.length === 0 && Object.keys(tree).length === 1) {
            return EMPTY_ANNOTATIONS
        }

        let sub = new HighlightedJSON(tree)
        this.cachedSubs[path] = sub
        return sub
    }

    get rootHighlights(): Highlight[] {
        return this.highlightsMap.$highlights || []
    }

    allHighlights(): Highlight[] {
        let queue = [this.highlightsMap]
        let highlights: Highlight[] = []
        while (queue.length > 0) {
            let current: any = queue.shift()
            if (current.$highlights) {
                highlights.push(...current.$highlights)
            }
            for (let key in current) {
                if (key !== "$highlights") {
                    queue.push(current[key])
                }
            }
        }
        return highlights
    }

    /**
     * Creates an HighlightedJSON object from a list of key-value pairs, where the key is the path to the highlight
     * 
     * Use `from_mappings` to create an instance from a list of highlights like so:
     * 
     * ```typescript
     * const highlights = {
     *   "key1:0-5": "highlight1",    
     *   "key1.key2:0-5": "highlight2",
     *   "key1.key2.key3:0-5": "highlight3"
     *   
     * }
     * const highlighted = HighlightedJSON.from_mappings(highlights)
     * ```
     * 
     */
    static from_mappings(mappings: Record<string, string>) {
        if (!mappings || Object.keys(mappings).length === 0) {
            return EMPTY_ANNOTATIONS
        }

        let highlightsMap = highlightsToMap(mappings)
        return new HighlightedJSON(highlightsMap)
    }

    /**
     * Returns the highlights referenced by this highlight tree, as a list of {start, end, content} objects
     * relative to the provided object string representation (e.g. JSON representation of the highlighted object).
     * 
     * Uses JSON source maps internally, to point from an highlight into the object string. This means the object string
     * must be valid JSON.
     */
    in_text(object_string: string): Highlight[] {
        // extract source map pointers
        try {
            let map = null as any
            try {
                // try to parse source map
                map = jsonMap.parse(object_string)
            } catch (e) {
                // if parsing fails, assume it's a string and try again
                map = {
                    pointers: {
                        "": { value: { pos: 0 }, valueEnd: { pos: object_string.length } }
                    }
                }
            }

            const pointers: { start: number, end: number, content: string }[] = []
            for (const key in map.pointers) {
                const pointer = map.pointers[key]
                // in case, we map to a string, we offset the start and end by 1 to exclude the quotes
                let isDoubleQuote = object_string[pointer.value.pos] === '"'
                pointers.push({
                    start: pointer.value.pos + (isDoubleQuote ? 1 : 0),
                    end: pointer.valueEnd.pos + (isDoubleQuote ? -1 : 0),
                    content: key
                })
            }

            // construct source range map (maps object properties to ranges in the object string)
            let srm = sourceRangesToMap(pointers)

            // return highlights with text offsets
            return to_text_offsets(this.highlightsMap, srm)
        } catch (e) {
            console.error("Failed to parse source map for", [object_string, e])
            return []
        }
    }

    /**
     * Turns a list of highlights into a list of fully separated intervals, where the list of
     * returned intervals is guaranteed to have no overlaps between each other and the 'content' field contains
     * the list of item contents that overlap in that interval.
     */
    static disjunct(highlights: Highlight[]): GroupedHighlight[] {
        return disjunct_overlaps(highlights)
    }

    static by_lines(disjunct_highlights: Highlight[], text: string): GroupedHighlight[][] {
        let result: GroupedHighlight[][] = [[]]
        let queue: GroupedHighlight[] = disjunct_highlights.map((a) => ({ start: a.start, end: a.end, content: a.content }))

        while (queue.length > 0) {
            const front = queue[0]
            const content = text.substring(front.start, front.end)
            const lines = content.split('\n')

            if (lines.length === 1) {
                result[result.length - 1].push({ start: front.start, end: front.end, content: front.content })
                queue.shift()
            } else {
                result[result.length - 1].push({ start: front.start, end: front.start + lines[0].length + 1, content: front.content })
                result.push([])
                front.start += lines[0].length + 1
            }
        }

        return result
    }


    static empty(): HighlightedJSON {
        return EMPTY_ANNOTATIONS
    }
}

// shared empty highlights instance
class EmptyHighlights extends HighlightedJSON {
    constructor() {
        super(empty())
    }

    for_path(_path: string): HighlightedJSON {
        return this
    }

    get rootHighlights(): Highlight[] {
        return []
    }

    in_text(_object_string: string): Highlight[] {
        return []
    }

    toString(): string {
        return "EmptyHighlights"
    }
}

export const EMPTY_ANNOTATIONS = new EmptyHighlights()

/**
 * Turns a list of {start, end, content} items into a list of fully separated intervals, where the list of
 * returned intervals is guaranteed to have no overlaps between each other and the 'content' field contains
 * the list of item contents that overlap in that interval.
 * 
 * E.g. turns these overlapping intervals:
 * 
 * |--A-----|
 *    |--B------|
 * |----C----------|
 *                  
 * into these disjunct intervals:
 *                  
 * |AC|-ABC-|BC-|-C|
 *                  
 */
function disjunct_overlaps(items: { start: number, end: number, content: any }[]): GroupedHighlight[] {
    // create interval tree for efficient interval queries
    const tree = new IntervalTree()

    // helper function to calculate overlap between two ranges
    function len_overlap(range1: [number, number], range2: [number, number]) {
        return Math.max(0, Math.min(range1[1], range2[1]) - Math.max(range1[0], range2[0]))
    }

    // collects all interval boundaries
    let boundaries = [0, Infinity]

    for (const item of items) {
        tree.insert([item.start, item.end], item)
        boundaries.push(item.start)
        boundaries.push(item.end)
    }

    // make boundaries unique
    boundaries = Array.from(new Set(boundaries))
    boundaries = boundaries.sort((a, b) => a - b)

    // construct fully separated intervals, by querying all intervals between each checkpoint
    const disjunct: GroupedHighlight[] = []
    for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i]
        const end = boundaries[i + 1]
        const overlapping = tree.search([start, end]).filter((o: any) => len_overlap([o.start, o.end], [start, end]) > 0)

        if (overlapping.length > 0) {
            disjunct.push({ start, end, content: overlapping.map((o: any) => o.content) })
        } else {
            disjunct.push({ start, end, content: null })
        }
    }

    return disjunct
}


/** 
 * Organizes a sequential list of source map ranges of format {start, end, content: /0/tool_calls/0/function/arguments} into a hierarchical map
 * of format { 0: { tool_calls: { 0: { function: { arguments: [ { start, end, content } ] } } } } }
 */
function sourceRangesToMap(ranges: { start: number, end: number, content: string }[]): Record<string, any> {
    const map: Record<string, any> = {}

    for (const range of ranges) {
        const parts = range.content.substring(1).split('/')
        let current = map

        // handle root level highlights
        if (parts.length === 1 && parts[0] === "") {
            if (!current["$highlights"]) {
                current["$highlights"] = []
            }
            let new_range = { start: range.start, end: range.end, content: range.content }
            current["$highlights"].push(new_range)
            continue
        }

        for (let i = 0; i < parts.length; i++) {
            let part: any = parts[i]

            if (i === parts.length - 1) {
                if (!current[part]) {
                    current[part] = {}
                }
                if (!current[part]["$highlights"]) {
                    current[part]["$highlights"] = []
                }

                let new_range = { start: range.start, end: range.end, content: range.content }
                current[part]["$highlights"].push(new_range)
            } else {
                if (!current[part]) {
                    current[part] = {}
                }
                current = current[part]
            }
        }
    }

    return map;
}


/**
 * Returns the list of highlights as mapped out by the highlightMap, such that start and end offsets 
 * for each highlight correspond to the actual text offsets in the source text, based on the given source map.
 * 
 * Returns the flattened list of highlights, with start and end offsets adjusted to the actual text offsets.
 */
function to_text_offsets(highlightMap: any, sourceRangeMap: any, located_highlights: any[] = []): Highlight[] {
    for (let key of Object.keys(highlightMap)) {
        if (key === "$highlights") {
            highlightMap[key].forEach((a: any) => {
                // a["start"] += sourceRangeMap[key][0]["start"]
                // a["end"] += sourceRangeMap[key][0]["start"]
                let end = a["end"] !== null ? a["end"] + sourceRangeMap[key][0]["start"] : sourceRangeMap[key][0]["end"]
                let start = a["start"] !== null ? a["start"] + sourceRangeMap[key][0]["start"] : sourceRangeMap[key][0]["start"]

                located_highlights.push({
                    "start": start,
                    "end": end,
                    "content": a["content"],
                    "specific": a["start"] === null || a["end"] === null
                })
            })
            continue;
        }
        if (sourceRangeMap[key]) {
            to_text_offsets(highlightMap[key], sourceRangeMap[key], located_highlights)
        } else {
            // console.log("key", key, "not found in", sourceRangeMap)
        }
    }

    return located_highlights

}

// turns a list of 'key.index.prop:start-end' strings into a map of { key: { index: { prop: { $highlights: [ { start: start, end: end, content: content } ] } } } }
// this makes highlights easier to work with in the UI, as they are grouped by key, index, and prop
function highlightsToMap(highlights: Record<string, any>, prefix = ""): HighlightMap {

    const map: HighlightMap = { $highlights: [] }
    const highlightsPerKey: Record<string, Record<string, any>> = {}
    const directHighlights: { key: string, start: number | null, end: number | null, content: any }[] = []

    for (const key in highlights) {
        // group keys by first segment (if it is not already a range), then recurse late
        const parts = key.split('.')
        const firstSegment = parts[0]
        const rest = parts.slice(1).join('.')

        if (firstSegment.includes(':')) {
            const [last_prop, range] = firstSegment.split(':')
            let [start, end] = range.split('-')
            let parsedStart = parseInt(start)
            let parsedEnd = parseFloat(end)
            if (isNaN(parsedStart) || isNaN(parsedEnd)) {
                throw new Error(`Failed to parse range ${range} in key ${prefix + key}`)
            }
            directHighlights.push({ key: last_prop, start: parsedStart, end: parsedEnd, content: highlights[key] })
        } else if (rest.length === 0) {
            directHighlights.push({ key: firstSegment, start: null, end: null, content: highlights[key] })
        } else {
            if (!highlightsPerKey[firstSegment]) {
                highlightsPerKey[firstSegment] = {}
            }
            highlightsPerKey[firstSegment][rest] = highlights[key]
        }
    }

    for (const key in highlightsPerKey) {
        try {
            map[key] = highlightsToMap(highlightsPerKey[key], prefix + key + ".")
        } catch (e: any) {
            throw new Error(`Failed to parse highlights for key ${prefix + key}: ${e.message}`)
        }
    }

    for (const highlight of directHighlights) {
        if (!map[highlight.key]) {
            map[highlight.key] = {}
        }
        if (!map[highlight.key]["$highlights"]) {
            map[highlight.key]["$highlights"] = []
        }
        map[highlight.key]["$highlights"].push({ start: highlight.start, end: highlight.end, content: highlight.content })
    }

    return map
}