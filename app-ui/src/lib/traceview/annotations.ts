import IntervalTree from '@flatten-js/interval-tree'
import jsonMap from "json-source-map"

/** A single annotation, with a start and end offset in the source text or leaf string, and a content field. */
export interface Annotation {
    start: number
    end: number
    content: any
    
    // specifies whether this annotation is range specific, or marks a higher-level
    // range like an entire object
    specific?: boolean
}

/** Like a regular annotation, but stores a list of annotations per range. */
export interface GroupedAnnotation {
    start: number
    end: number
    content: Annotation[] | null
}


/** Hierarchical representation of annotations like 
 * { a: { b: { c: { $annotations: [ { start: 0, end: 5, content: "annotation" } ] } } } }
 */
interface AnnotationMap {
    $annotations: Annotation[]
    [key: string]: any
}

/** Returns an empty annotation map. */
function empty(): AnnotationMap {
    return { $annotations: [] }
}

/**
 * Tracks annotations of an arbitrary JSON object, and provides methods to extract annotations for a given path.
 * 
 * Use `AnnotatedJSON.from_mappings` to create an instance from a list of annotations as shown below.
 */
export class AnnotatedJSON {
    // immutable representation of all annotations organized by path (do not modify directly)
    annotationsMap: AnnotationMap
    // caches results of `for_path` calls to maintain as much shared state as possible (avoids re-rendering in react)
    cachedSubs: Record<string, AnnotatedJSON>

    constructor(annotations: AnnotationMap) {
        this.annotationsMap = annotations as AnnotationMap
        this.cachedSubs = {}
    }

    /**
     * Returns a new AnnotatedJSON object that represents the annotations for the given path in the annotated object.
     * 
     * E.g. if the annotated object is: `{a: {b: {c: 1, d: 2}}}` and the annotations are [{key: "a.b.c:0-5", value: "annotation1"}],
     * then `for_path("a.b")` will return a new AnnotatedJSON object with annotations [{key: "c:0-5", value: "annotation1"}].
     */
    for_path(path: string): AnnotatedJSON {
        if (!this.annotationsMap) {
            return EMPTY_ANNOTATIONS
        }
    
        if (this.cachedSubs[path]) {
            return this.cachedSubs[path]
        }

        let tree = this.annotationsMap

        for (const key of path.split('.')) {
            if (!tree[key]) {
                return EMPTY_ANNOTATIONS
            }
            tree = tree[key]
        }
        
        if (tree.$annotations?.length === 0 && Object.keys(tree).length === 1) {
            return EMPTY_ANNOTATIONS
        }
        
        let sub = new AnnotatedJSON(tree)
        this.cachedSubs[path] = sub
        return sub
    }

    get rootAnnotations(): Annotation[] {
        return this.annotationsMap.$annotations || []
    }

    allAnnotations(): Annotation[] {
        let queue = [this.annotationsMap]
        let annotations = []
        while (queue.length > 0) {
            let current: any = queue.shift()
            if (current.$annotations) {
                annotations.push(...current.$annotations)
            }
            for (let key in current) {
                if (key !== "$annotations") {
                    queue.push(current[key])
                }
            }
        }
        return annotations
    }

    /**
     * Creates an AnnotatedJSON object from a list of key-value pairs, where the key is the path to the annotation
     * 
     * Use `from_mappings` to create an instance from a list of annotations like so:
     * 
     * ```typescript
     * const annotations = {
     *    "key1:0-5": "annotation1",    
     *   "key1.key2:0-5": "annotation2",
     *  "key1.key2.key3:0-5": "annotation3"
     * }
     * const annotated = AnnotatedJSON.from_mappings(annotations)
     * ```
     * 
     */
    static from_mappings(mappings: Record<string, string>) {
        if (!mappings || Object.keys(mappings).length === 0) {
            return EMPTY_ANNOTATIONS
        }

        let annotationsMap = annotationsToMap(mappings)
        return new AnnotatedJSON(annotationsMap)
    }

    /**
     * Returns the annotations referenced by this annotation tree, as a list of {start, end, content} objects
     * relative to the provided object string representation (e.g. JSON representation of the annotated object).
     * 
     * Uses JSON source maps internally, to point from an annotation into the object string. This means the object string
     * must be valid JSON.
     */
    in_text(object_string: string): Annotation[] {
        // extract source map pointers
        try {
            const map = jsonMap.parse(object_string)

            const pointers = []
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

            // return annotations with text offsets
            return to_text_offsets(this.annotationsMap, srm)
        } catch (e) {
            console.error("Failed to parse source map for", [object_string, e])
            return []
        }
    }

    /**
     * Turns a list of annotations into a list of fully separated intervals, where the list of
     * returned intervals is guaranteed to have no overlaps between each other and the 'content' field contains
     * the list of item contents that overlap in that interval.
     */
    static disjunct(annotations: Annotation[]): GroupedAnnotation[] {
        return disjunct_overlaps(annotations)
    }

    static by_lines(disjunct_annotations: Annotation[], text: string): GroupedAnnotation[][] {
        let result: GroupedAnnotation[][] = [[]]
        let queue: GroupedAnnotation[] = disjunct_annotations.map((a) => ({ start: a.start, end: a.end, content: a.content }))

        while (queue.length > 0) {
            const front = queue[0]
            const content = text.substring(front.start, front.end)
            const lines = content.split('\n')

            if (lines.length === 1) {
                result[result.length-1].push({ start: front.start, end: front.end, content: front.content })
                queue.shift()
            } else {
                result[result.length-1].push({ start: front.start, end: front.start + lines[0].length + 1, content: front.content })
                result.push([])
                front.start += lines[0].length + 1
            }
        }

        return result
    }


    static empty(): AnnotatedJSON {
        return EMPTY_ANNOTATIONS
    }
}

// shared empty annotations instance
class EmptyAnnotations extends AnnotatedJSON {
    constructor() {
        super(empty())
    }

    for_path(_path: string): AnnotatedJSON {
        return this
    }

    get rootAnnotations(): Annotation[] {
        return []
    }

    in_text(_object_string: string): Annotation[] {
        return []
    }

    toString(): string {
        return "EmptyAnnotations"
    }
}

export const EMPTY_ANNOTATIONS = new EmptyAnnotations()

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
function disjunct_overlaps(items: { start: number, end: number, content: any }[]): GroupedAnnotation[] {
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
    const disjunct: GroupedAnnotation[] = []
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

        // handle root level annotations
        if (parts.length === 1 && parts[0] === "") {
            if (!current["$annotations"]) {
                current["$annotations"] = []
            }
            let new_range = { start: range.start, end: range.end, content: range.content }
            current["$annotations"].push(new_range)
            continue
        }

        for (let i = 0; i < parts.length; i++) {
            let part: any = parts[i]

            if (i === parts.length - 1) {
                if (!current[part]) {
                    current[part] = {}
                }
                if (!current[part]["$annotations"]) {
                    current[part]["$annotations"] = []
                }
                
                let new_range = { start: range.start, end: range.end, content: range.content }
                current[part]["$annotations"].push(new_range)
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
 * Returns the list of annotations as mapped out by the annotationMap, such that start and end offsets 
 * for each annotation correspond to the actual text offsets in the source text, based on the given source map.
 * 
 * Returns the flattened list of annotations, with start and end offsets adjusted to the actual text offsets.
 */
function to_text_offsets(annotationMap: any, sourceRangeMap: any, located_annotations: any[] = []): Annotation[] {
    for (let key of Object.keys(annotationMap)) {
        if (key === "$annotations") {
            annotationMap[key].forEach((a: any) => {
                // a["start"] += sourceRangeMap[key][0]["start"]
                // a["end"] += sourceRangeMap[key][0]["start"]
                let end = a["end"] !== null ? a["end"] + sourceRangeMap[key][0]["start"] : sourceRangeMap[key][0]["end"]
                let start = a["start"] !== null ? a["start"] + sourceRangeMap[key][0]["start"] : sourceRangeMap[key][0]["start"]

                located_annotations.push({
                    "start": start,
                    "end": end,
                    "content": a["content"],
                    "specific": a["start"] === null || a["end"] === null
                })
            })
            continue;
        }
        if (sourceRangeMap[key]) {
            to_text_offsets(annotationMap[key], sourceRangeMap[key], located_annotations)
        } else {
            // console.log("key", key, "not found in", sourceRangeMap)
        }
    }

    return located_annotations

}

// turns a list of 'key.index.prop:start-end' strings into a map of { key: { index: { prop: { $annotations: [ { start: start, end: end, content: content } ] } } } }
// this makes annotations easier to work with in the UI, as they are grouped by key, index, and prop
function annotationsToMap(annotations: Record<string, any>, prefix = ""): AnnotationMap {

    const map: AnnotationMap = { $annotations: [] }
    const annotationsPerKey: Record<string, Record<string, any>> = {}
    const directAnnotations = []
    
    for (const key in annotations) {
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
            directAnnotations.push({ key: last_prop, start: parsedStart, end: parsedEnd, content: annotations[key] })
        } else if (rest.length === 0) {
            directAnnotations.push({ key: firstSegment, start: null, end: null, content: annotations[key] })
        } else {
            if (!annotationsPerKey[firstSegment]) {
                annotationsPerKey[firstSegment] = {}
            }
            annotationsPerKey[firstSegment][rest] = annotations[key]
        }
    }

    for (const key in annotationsPerKey) {
        try {
            map[key] = annotationsToMap(annotationsPerKey[key], prefix + key + ".")
        } catch (e: any) {
            throw new Error(`Failed to parse annotations for key ${prefix + key}: ${e.message}`)
        }
    }

    for (const annotation of directAnnotations) {
        if (!map[annotation.key]) {
            map[annotation.key] = {}
        }
        if (!map[annotation.key]["$annotations"]) {
            map[annotation.key]["$annotations"] = []
        }
        map[annotation.key]["$annotations"].push({ start: annotation.start, end: annotation.end, content: annotation.content })
    }

    return map
}