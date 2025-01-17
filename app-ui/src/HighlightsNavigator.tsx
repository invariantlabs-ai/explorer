import { useCallback, useEffect, useState } from "react";
import { Highlight, HighlightedJSON } from "./lib/traceview/highlights";
import { BsArrowDown, BsArrowUp } from "react-icons/bs";
import {
  ACTIVE_HASH,
  permalink,
  reveal,
} from "./lib/permalink-navigator";
import { safeAnchorId } from "./HighlightDetails";

/**
 * Create a navigation anchor for a highlight.
 */
function getNavigationAnchor(address: string, start?: number, end?: number) {
  return address + ":" + (start || 0) + "-" + (end || 0);
}

// indicates whether we can navigate to this type of highlight and it is a failed test
function isNavigatableHighlight(highlight: Highlight) {
  return (
    highlight?.content?.extra_metadata?.test &&
    !highlight?.content?.extra_metadata?.passed
  );
}

// indicates whether we can navigate to this type of highlight and it is a passed test
function isNavigatablePassed(highlight: Highlight) {
  return (
    highlight?.content?.extra_metadata?.test &&
    highlight?.content?.extra_metadata?.passed
  );
}

// indicates whether all highlights are passing assertions
function isAllPassed(highlights: [string, Highlight][]) {
  return highlights.every(([_, highlight]) => isNavigatablePassed(highlight));
}

// compare two ranges (ascending)
function compareRanges(arange: [number, number], brange: [number, number]) {
  if (arange[0] < brange[0]) {
    return -1;
  } else if (arange[0] > brange[0]) {
    return 1;
  }

  return arange[1] - brange[1];
}

// compare two addresses and their ranges (ascending)
function compareAddresses(
  apair: [string, Highlight],
  bpair: [string, Highlight],
) {
  // compare by the messages index and then by the tool_calls index
  const [a, a_highlight] = apair;
  const [b, b_highlight] = bpair;

  const aParts = a.split(".");
  if (aParts.length < 2) {
    return -1;
  }
  const bParts = b.split(".");
  if (bParts.length < 2) {
    return 1;
  }

  const aMessageIndex = parseInt(aParts[1]);
  const bMessageIndex = parseInt(bParts[1]);

  if (aMessageIndex < bMessageIndex) {
    return -1;
  } else if (aMessageIndex > bMessageIndex) {
    return 1;
  }

  return compareRanges(
    [a_highlight.start, a_highlight.end],
    [b_highlight.start, b_highlight.end],
  );
}

// navigation anchor for the highlights navigator
export interface HighlightsNavigatorProps {
  highlights: HighlightedJSON;
  top_level_annotations: Highlight[];
  traceId: string;

  // behavior on open
  onOpen: null | "expand-first";
}

// anchor for the navigator
interface NavigationAnchor {
  label: string;
  anchor: string;
}

/**
 * Offers controls to navigate between highlights in the trace view.
 *
 * Restricted to testing related highlights (assertions and expectations) for now.
 */
export function HighlightsNavigator(props: HighlightsNavigatorProps) {
  const [selectedHighlight, _setSelectedHighlight] = useState<number>(1);
  const [numHighlights, setNumHighlights] = useState<number>(1);

  if (!props.highlights) {
    return null;
  }

  const all = props.highlights.allHighlights();

  const highlights: [string, Highlight][] = isAllPassed(all)
    ? all.filter(([_, highlight]) => isNavigatablePassed(highlight))
    : all.filter(([_, highlight]) => isNavigatableHighlight(highlight));

  highlights.sort((a, b) => compareAddresses(a, b));

  // create anchors for each highlight (top-level and inline)
  let anchors: NavigationAnchor[] = props.top_level_annotations.map((tla) => ({
    label: tla.content,
    anchor: safeAnchorId(tla.annotationId || ""),
  }));

  anchors = [
    ...anchors,
    ...highlights.map(([address, highlight]) => {
      return {
        label: highlight.content.content,
        anchor: permalink(
          getNavigationAnchor(address, highlight.start, highlight.end),
          true,
        ),
      };
    }),
  ];

  // reset counter when the total number changes
  useEffect(() => {
    if (anchors.length !== numHighlights) {
      setNumHighlights(anchors.length);
      setSelectedHighlight(() => 1);
    }
  }, [anchors.length]);

  // navigate to first highlight on open (if configured to do so)
  useEffect(() => {
    if (props.onOpen === "expand-first") {
      if (anchors.length > 0) {
        // only navigte to first highlight if no other anchor is already set on window.location.hash
        // using window.location.hash directly does not work here, as it may not be updated yet
        // we use ACTIVE_HASH instead to track if there was a hash that was already acted on by the
        // permalink-navigfator.tsx
        if (ACTIVE_HASH == "") {
          onNavigateTo(anchors[0].anchor, "annotations");
        }
      }
    }
  }, [props.onOpen, props.highlights]);

  // called when the user clicks on the navigator
  const onNavigateTo = (anchor: string, operation: string = "") => {
    reveal(anchor, operation, false, {
      setHash: false,
    });
  };

  // set the selected highlight
  const setSelectedHighlight = useCallback(
    (newSelected: (old: number) => number) => {
      let updated_index = newSelected(selectedHighlight);
      if (
        updated_index > 0 &&
        updated_index <= anchors.length &&
        updated_index !== selectedHighlight
      ) {
        _setSelectedHighlight(updated_index);
        onNavigateTo(anchors[updated_index - 1].anchor, "annotations");
      }
    },
    [selectedHighlight, anchors],
  );

  // called when the user clicks on the navigator
  const onClick = () => {
    onNavigateTo(anchors[selectedHighlight - 1].anchor, "annotations");
  };

  if (anchors.length == 0) {
    return null;
  }

  return (
    <div className="highlights-navigator">
      <span className="content" onClick={onClick}>
        {selectedHighlight} out of {anchors.length} assertions
        {/* {anchors[selectedHighlight - 1] && anchors[selectedHighlight - 1][0]} */}
      </span>
      {anchors.length > 0 && (
        <>
          <button
            disabled={selectedHighlight === 1}
            onClick={() => setSelectedHighlight((s) => s - 1)}
            data-tooltip-id="button-tooltip"
            data-tooltip-content="Previous"
          >
            <BsArrowUp />
          </button>
          <button
            disabled={selectedHighlight === highlights.length}
            onClick={() => setSelectedHighlight((s) => s + 1)}
            data-tooltip-id="button-tooltip"
            data-tooltip-content="Next"
          >
            <BsArrowDown />
          </button>
        </>
      )}
    </div>
  );
}
