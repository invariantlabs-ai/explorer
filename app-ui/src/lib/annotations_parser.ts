import { HighlightData } from "./traceview/highlights";

/**
 * Root key to identify top-level annotations by.
 */
export const ROOT_ANNOTATIONS_KEY = "<root>";
interface ParsedAnnotationOutput {
  highlights: [string, HighlightData][];
  filtered_annotations: { [key: string]: HighlightData[] };
  errors: { type: string; count: number }[];
  top_level_annotations: HighlightData[];
}

/**
 * Takes the total list of trace annotations and splits it into the different types of annotations, e.g.
 *
 * - search highlights
 * - analyzer errors
 * - user comments
 * - testing highlights
 */
export class AnnotationsParser {
  static parse_annotations(
    annotations,
    search_highlights: { [key: string]: HighlightData }
  ): ParsedAnnotationOutput {
    // collect annotations of a character range format (e.g. "messages.0.content:5-9") into mappings
    const highlights: [string, HighlightData][] = search_highlights
      ? Object.entries(search_highlights)
      : [];
    // collect errors from analyzer annotations
    const errors = [] as { type: string; count: number }[];

    for (let key in annotations) {
      for (let annotation of annotations[key]) {
        if (
          annotation.extra_metadata &&
          annotation.extra_metadata["source"] == "analyzer"
        ) {
          try {
            const contentJson = JSON.parse(annotation.content);
            if (contentJson["errors"]) {
              for (let error of contentJson["errors"]) {
                errors.push({
                  type: error["args"][0],
                  count: error["ranges"].length,
                });
              }
            }
          } catch (error) {
            continue; // Skip if annotation.content is not valid JSON
          }
        }
      }

      // mappings
      let substr = key.substring(key.indexOf(":"));
      // Match either a character range or a bounding box
      if (
        substr.match(/:\d+-\d+/) ||
        substr.match(/:bbox-\d.\d+,\s*\d.\d+,\s*\d.\d+,\s*\d.\d+/)
      ) {
        for (let i = 0; i < annotations[key].length; i++) {
          let annotation = annotations[key][i]; // TODO: what do multiple indices here mean{
          let highlight: HighlightData = {
            content: annotation.content,
            // allows us to identify the annotation from the highlight
            source: annotation.extra_metadata
              ? annotation.extra_metadata["source"]
              : "unknown",
            annotationId: key + ":" + i,
          };

          if (annotation.extra_metadata) {
            highlight.extra_metadata = Object.assign(
              {},
              annotation.extra_metadata
            );
            // remove source if present
            delete highlight.extra_metadata!["source"];
          }

          highlights.push([key, highlight]);
        }
      }
    }

    // Filter all annotations with "analyzer" as source from all the keys
    // NOTE: Long term might be good to separate analysis results from the other annotations to avoid this kind of filtering logic
    let filtered_annotations = {};
    for (let key in annotations) {
      let new_annotations = annotations[key].filter(
        (annotation) =>
          !(
            annotation.extra_metadata &&
            annotation.extra_metadata["source"] === "analyzer"
          )
      );
      if (new_annotations.length > 0) {
        filtered_annotations[key] = new_annotations;
      }
    }

    // filter all top-level annotations
    let top_level_annotations = [] as HighlightData[];
    // top-level annotations are stored under the <root> key
    if (annotations && annotations[ROOT_ANNOTATIONS_KEY]) {
      for (let i = 0; i < annotations[ROOT_ANNOTATIONS_KEY].length; i++) {
        let annotation = annotations[ROOT_ANNOTATIONS_KEY][i];
        let highlight: HighlightData = {
          content: annotation.content,
          // allows us to identify the annotation from the highlight
          source: annotation.extra_metadata
            ? annotation.extra_metadata["source"]
            : "unknown",
          annotationId: "<top level>:" + i,
        };

        if (annotation.extra_metadata) {
          highlight.extra_metadata = Object.assign(
            {},
            annotation.extra_metadata
          );
          // remove source if present
          delete highlight.extra_metadata!["source"];
        }

        top_level_annotations.push(highlight);
      }
    }

    return {
      highlights: highlights,
      filtered_annotations,
      errors,
      top_level_annotations,
    };
  }
}
