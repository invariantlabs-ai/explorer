import { register_plugin } from "../plugins";
import React from "react";
import { Line } from "../line";
import { HighlightedJSON } from "../highlights";
import { truncate } from "../utils";
import "./image-viewer.scss";

// component properties of the code-highlighter plugin
interface ImageViewerProps {
  content: string;
  datasetName: string;
  traceId: string;
  imageId: string;
  highlights: any;
  highlightContext: any;
  address: string;
  traceIndex?: number;
  onUpvoteDownvoteCreate?: (traceIndex: number) => void;
  onUpvoteDownvoteDelete?: (traceIndex: number) => void;
}

function extractImageId(content: string): {
  datasetName: string | null;
  traceId: string | null;
  imageId: string | null;
} {
  let pattern: string;
  if (content.includes("s3_img_link")) {
    pattern = "s3_img_link: s3://invariant-explorer-imgs/(.*)\.png";
  } else {
    pattern = "local_img_link: /srv/images/(.*)\.png";
  }
  const match = content.match(pattern);

  if (!match) {
    return { datasetName: null, traceId: null, imageId: null };
  }

  const parts = match[1].split("/");
  return {
    datasetName: parts[0],
    traceId: parts[1],
    imageId: parts[2],
  };
}

class ImageViewer extends React.Component<
  ImageViewerProps,
  {
    nodes: any;
    datasetName: string | null;
    traceId: string | null;
    imageId: string | null;
    imageUrl: string | null;
    isModalOpen: boolean;
  }
> {
  constructor(props) {
    super(props);
    const imageInfo = extractImageId(props.content);
    this.state = {
      nodes: [],
      datasetName: imageInfo.datasetName,
      traceId: imageInfo.traceId,
      imageId: imageInfo.imageId,
      imageUrl: null,
      isModalOpen: false,
    };
  }

  async componentDidMount() {
    await this.fetchImage();
  }

  async componentDidUpdate(prevProps) {
    if (prevProps.content !== this.props.content) {
      const imageInfo = extractImageId(this.props.content);
      this.setState(
        {
          datasetName: imageInfo.datasetName,
          traceId: imageInfo.traceId,
          imageId: imageInfo.imageId,
          imageUrl: null,
        },
        () => {
          this.fetchImage();
        },
      );
    }
  }

  async fetchImage() {
    const url = `/api/v1/trace/image/${this.state.datasetName}/${this.state.traceId}/${this.state.imageId}`;

    try {
      const cache = await caches.open("trace-images");
      let response = await cache.match(url);

      if (!response) {
        response = await fetch(url);
        if (!response.ok) {
          throw new Error("Image fetch failed");
        }
        // Clone the response before caching because response body can only be used once
        const responseClone = response.clone();
        await cache.put(url, responseClone);
      }

      const blob = await response.blob();
      const imageUrl = URL.createObjectURL(blob);
      this.setState({ imageUrl });
    } catch (error) {
      console.error("Error fetching image:", error);
    }
  }

  /**
   * Get annotations for image and update the higlights for it by either:
   *      - Wrapping it in a span with annotation data
   *      - Wrapping it in an unannotated span
   * This image is the set in the nodes object.
   */
  updateHighlights() {
    let highlights_in_text = this.props.highlights.in_text(
      JSON.stringify(this.props.content, null, 2),
    );
    highlights_in_text = HighlightedJSON.disjunct(highlights_in_text);
    let highlights_per_line = HighlightedJSON.by_lines(
      highlights_in_text,
      '"' + this.props.content + '"',
    );
    let elements: React.ReactNode[] = [];

    // Loop over the highlighted structure
    let highligthed_found = false;
    for (const highlights of highlights_per_line) {
      let image: React.ReactNode[] = [];
      for (const interval of highlights) {
        if (interval.content !== null) {
          let className =
            "annotated" +
            " " +
            interval.content
              .filter((c) => c["source"])
              .map((c) => "source-" + c["source"])
              .join(" ");
          const tooltip = interval.content
            .map((c) =>
              truncate("[" + c["source"] + "]" + " " + c["content"], 100),
            )
            .join("\n");

          // We assume that we will have exactly one highlight and that this is for the image,
          // so only push a new line if find a highlight AND it is the first highlight.
          if (this.state.imageUrl && !highligthed_found) {
            image.push(
              <span
                key={
                  elements.length +
                  "-" +
                  image.length +
                  "-" +
                  interval.start +
                  "-" +
                  interval.end
                }
                className={`image-wrapper ${className}`}
                data-tooltip-id={"highlight-tooltip"}
                data-tooltip-content={tooltip}
              >
                <img
                  src={this.state.imageUrl}
                  className={`trace-image ${className} ${this.state.isModalOpen ? "full-size" : ""}`}
                />
              </span>,
            );
            highligthed_found = true;
          }
        }
      }

      // We still need to render the image if we do not have annotattions
      if (!highligthed_found) {
        image.push(
          <span
            key={"line-" + elements.length}
            className="image-wrapper unannotated"
          >
            {
              <img
                src={this.state.imageUrl || ""}
                className={`trace-image unannotated`}
              />
            }
          </span>,
        );
      }

      // Push the image as a line (gives us the option to add comments, thumbs up/down and tooltips)
      elements.push(
        <Line
          key={"line-" + elements.length}
          highlights={highlights}
          highlightContext={this.props.highlightContext}
          address={this.props.address + ":L" + elements.length}
          traceIndex={this.props.traceIndex}
          onUpvoteDownvoteCreate={this.props.onUpvoteDownvoteCreate}
          onUpvoteDownvoteDelete={this.props.onUpvoteDownvoteDelete}
        >
          {image}
          {"\n"}
        </Line>,
      );
    }

    // Update the nodes for render method
    return elements;
  }

  render() {
    let elements = this.updateHighlights();

    const image_view = (
      <div className="plugin code-image-viewer">
        {this.state.imageUrl && (
          <>
            {elements}
            <button
              className="full-screen-button"
              onClick={() => this.setState({ isModalOpen: true })}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
              >
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            </button>
            {this.state.isModalOpen && (
              <div
                className="image-full-screen"
                onClick={() => this.setState({ isModalOpen: false })}
              >
                <img
                  src={this.state.imageUrl}
                  alt="Image in the trace fullscreen"
                  className="image-full-screen-opened"
                />
              </div>
            )}
          </>
        )}
      </div>
    );

    return image_view;
  }
}

// register the image-viewer plugin
register_plugin({
  name: "image-viewer",
  component: (props) => <ImageViewer {...props} />,
  isCompatible: (address: string, msg: any, content: string) => {
    if (content.includes("s3_img_link") || content.includes("local_img_link")) {
      return true;
    }
    return false;
  },
});
