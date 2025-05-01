import { register_plugin } from "../plugins";
import { createHighlighter } from "shiki/bundle/web";

import React from "react";
import "./code-highlighter.scss";
import { HighlightedJSON } from "../highlights";
import { Line } from "../line";
import { truncate } from "../utils";
import KEY_TOKENS from "./code-highligther-keywords.json";
import { permalink } from "../../permalink-navigator";

// component properties of the code-highlighter plugin
interface CodeHighlightedViewProps {
  content: string;
  highlights: any;
  highlightContext: any;
  address: string;
  traceIndex?: number;
  onUpvoteDownvoteCreate?: (traceIndex: number) => void;
  onUpvoteDownvoteDelete?: (traceIndex: number) => void;
}

// a token as produced by the shiki highlighter
interface Token {
  content: string;
  offset: number;
  variants: object;
}

// allows streaming access to a styled sequence of tokens in terms of character ranges,
// rather than line ranges (which is what the shiki highlighter produces)
class StyledContent {
  // offset in the content in terms of characters
  offset: number = 0;
  // offset in the content in terms of lines
  line_offset: number = 0;

  constructor(public tokens: Token[][] = []) {}

  style(variant: any) {
    const fontStyles = {
      0: "normal",
      1: "bold",
      2: "italic",
    };
    return {
      color: variant.color,
      fontWeight: fontStyles[variant.fontStyle],
    };
  }

  /**
   * Statefully consumes a range of characters in the content and returns the corresponding styled spans.
   *
   * Consumption is a stateful operation, i.e., subsequent calls to this function must always be in order and never jump back in the content.
   *
   * @param start the start of the range to consume
   * @param end the end of the range to consume
   *
   * @returns the styled spans for the given range
   */
  consume(start: number, end: number) {
    let result: React.ReactNode[] = [];
    // disallow negative start
    start = Math.max(start, 0);

    // ensure subsequent calls to this function are always in order and never jump back in the content (streaming assumption)
    if (start < this.offset) {
      throw new Error(
        "Cannot access content before the current offset (" +
          this.offset +
          ", " +
          start +
          ")"
      );
    }
    this.offset = end;
    // keeps track of whether all lines so far have been skipped by the range
    let skipped = true;

    // this is not the most efficient way to do this, but it is simple
    for (let i = this.line_offset; i < this.tokens.length; i++) {
      let line = this.tokens[i];

      for (let token of line) {
        let token_start = token.offset;
        let token_end = token.offset + token.content.length;
        if (token_end < start) {
          continue;
        } else if (token_start > end) {
          // if the token is beyond the range, we cannot skip the line in the future, since we have not consumed the range yet
          skipped = false;
          return result;
        } else {
          let start_offset = Math.max(start, token_start) - token_start;
          let end_offset = Math.min(end, token_end) - token_start;
          let token_content = token.content.substring(start_offset, end_offset);
          result.push(
            <span
              key={"highlighted-token-" + result.length}
              style={this.style(token.variants[0])}
            >
              {token_content}
            </span>
          );
          // if a line is at least partially consumed, we can't skip it in the future since it may contain additional content that
          // only falls into the next range query
          skipped = false;
        }
      }

      // if all lines so far have been skipped, we can skip the line
      if (skipped) {
        this.line_offset = Math.max(this.line_offset, i + 1);
      }
    }
    return result;
  }
}

/**
 * Creates a shared highlighter instance that is used by all code-highlighter instances.
 *
 * This is necessary to avoid creating multiple highlighter instances, which is expensive.
 *
 * @returns a promise that resolves with the shared highlighter instance
 */
export function createSharedHighlighter(): Promise<any> {
  // create a window-scoped handle to a single shared highlighter instance (to avoid multiple instances)
  return new Promise((resolve, reject) => {
    const handle = window["HIGHLIGHTER_INSTANCES"];
    if (handle) {
      if (handle.highlighter) {
        resolve(handle.highlighter);
      } else {
        handle.callbacks.push({ resolve, reject });
      }
      return;
    } else {
      let handle = { highlighter: null, callbacks: [{ resolve, reject }] };
      window["HIGHLIGHTER_INSTANCES"] = handle;
      createHighlighter({
        themes: ["github-light"],
        langs: ["markdown", "python", "js", "typescript", "bash", "css"],
      })
        .then((highlighter: any) => {
          handle.highlighter = highlighter;
          handle.callbacks.forEach(({ resolve }) => resolve(highlighter));
        })
        .catch((error) => {
          handle.callbacks.forEach(({ reject }) => reject(error));
        });
    }
  });
}

/**
 * The CodeHighlightedView component is a plugin for the traceview that highlights code snippets.
 *
 * It uses the shiki highlighter to tokenize the content and then applies highlights to the tokens.
 *
 * It uses `classify` to determine the language of the content automatically.
 */
class CodeHighlightedView extends React.Component<
  CodeHighlightedViewProps,
  { nodes: any; content: string; tokens: Token[][]; language: string }
> {
  constructor(props) {
    super(props);
    this.state = {
      nodes: [<span key="loading">Loading...</span>],
      content: cleanContent(props),
      tokens: [],
      language: LANGUAGE_CLASSIFIER.derive_highlighting_language(
        props.content
      ) as string,
    };
  }

  async componentDidMount() {
    const tokens = await this.tokenizeContent(cleanContent(this.props));
    await this.updateContent(tokens);
  }

  async componentDidUpdate(prevProps) {
    let oldTokens = this.state.tokens;
    let tokens = this.state.tokens;
    let update = false;
    // if needed, re-tokenize the content
    if (prevProps.content !== this.props.content) {
      this.setState({
        content: cleanContent(this.props),
        language: LANGUAGE_CLASSIFIER.derive_highlighting_language(
          this.props.content
        ) as string,
        nodes: [<span key="loading">Loading...</span>],
      });
      tokens = await this.tokenizeContent(cleanContent(this.props));
      await this.updateContent(tokens);
      return;
    }

    // if tokens or highlights have changed, update the content
    if (
      oldTokens !== tokens ||
      prevProps.highlights !== this.props.highlights ||
      prevProps.highlightContext !== this.props.highlightContext ||
      prevProps.highlightContext?.decorator !==
        this.props.highlightContext?.decorator
    ) {
      // detect changes to selectedHighlightAnchor that are relevant to this component (based on this.props.address)
      const highlightSelectionChangeRelevant =
        this.props.highlightContext?.selectedHighlightAnchor?.startsWith(
          this.props.address
        ) ||
        prevProps.highlightContext?.selectedHighlightAnchor?.startsWith(
          this.props.address
        ) ||
        (this.props.highlightContext.selectedHighlightAnchor === null &&
          prevProps.highlightContext?.selectedHighlightAnchor?.startsWith(
            this.props.address
          ));
      // detect changes of the highlights themselves
      const highlightsChanged = prevProps.highlights !== this.props.highlights;
      // detect changes to the decorator (e.g. whether a line is highlighted or not). the decorator changes when the rendered trace is changed
      const decoratorChanged =
        prevProps.highlightContext?.decorator !==
        this.props.highlightContext?.decorator;

      // do not update this component, if only some selection change happened at some other address (other message/event)
      if (
        !highlightSelectionChangeRelevant &&
        !highlightsChanged &&
        !decoratorChanged
      ) {
        return;
      }
      // otherwise clean the content and update rendered nodes
      this.setState({ content: cleanContent(this.props) });
      await this.updateContent(tokens);
    }
  }

  async tokenizeContent(content: string) {
    const highlighter = await createSharedHighlighter();
    const tokens = await highlighter.codeToTokensWithThemes(content, {
      lang: this.state.language,
      themes: ["github-light"],
    });
    this.setState({ tokens: tokens });
    return tokens;
  }

  async updateContent(tokens: Token[][]) {
    const content = this.state.content;

    let tokenized_content = new StyledContent(tokens);
    let highlights_in_text = this.props.highlights.in_text(
      JSON.stringify(content, null, 2)
    );
    highlights_in_text = HighlightedJSON.disjunct(highlights_in_text);
    let highlights_per_line = HighlightedJSON.by_lines(
      highlights_in_text,
      '"' + content + '"'
    );
    let elements: React.ReactNode[] = [];

    for (const highlights of highlights_per_line) {
      let line: React.ReactNode[] = [];
      for (const interval of highlights) {
        // additionally highlight NLs with unicode character
        let c = tokenized_content.consume(interval.start - 1, interval.end - 1);
        const addr =
          this.props.address +
          ":" +
          (interval.start - 1) +
          "-" +
          (interval.end - 1);
        const permalink_id = permalink(addr, false);

        if (interval.content === null) {
          line.push(
            <span
              key={
                elements.length +
                "-" +
                line.length +
                "-" +
                interval.start +
                "-" +
                interval.end
              }
              className="unannotated"
            >
              {c}
            </span>
          );
        } else {
          let className =
            "annotated" +
            " " +
            interval.content
              .filter((c) => c["source"])
              .map((c) => "source-" + c["source"])
              .join(" ");
          const tooltip = interval.content
            .map((c) =>
              truncate("[" + c["source"] + "]" + " " + c["content"], 100)
            )
            .join("\n");
          line.push(
            <span
              key={
                elements.length +
                "-" +
                line.length +
                "-" +
                interval.start +
                "-" +
                interval.end
              }
              className={className}
              data-tooltip-id={"highlight-tooltip"}
              data-tooltip-content={tooltip}
              id={permalink_id}
            >
              {c}
            </span>
          );
        }
      }
      const line_highlights = highlights
        .filter((a) => a.content)
        .map((a) => {
          return {
            snippet: this.props.content.substring(a.start - 1, a.end - 1),
            start: a.start - 1,
            end: a.end - 1,
            content: a.content,
          };
        });
      elements.push(
        <Line
          key={"line-" + elements.length}
          highlights={line_highlights}
          highlightContext={this.props.highlightContext}
          address={this.props.address + ":L" + elements.length}
          traceIndex={this.props.traceIndex}
          onUpvoteDownvoteCreate={this.props.onUpvoteDownvoteCreate}
          onUpvoteDownvoteDelete={this.props.onUpvoteDownvoteDelete}
        >
          {line}
          {"\n"}
        </Line>
      );
    }

    this.setState({ nodes: elements });
  }

  render() {
    return (
      <div className="plugin code-highlighter">
        {/* enable this, to show debugging information on the language classification */}
        {/* <span className='language'>{JSON.stringify(LANGUAGE_CLASSIFIER.derive_highlighting_language(this.props.content, true))}</span> */}
        {this.state.nodes}
      </div>
    );
  }
}

/**
 * Performs some basic cleaning on the content to make it easier to classify.
 *
 * This includes removing leading line numbers and removing the first and last line if they are ``` blocks.
 *
 * @param props the component properties for which we want to extract the cleaned content
 *
 */
function cleanContent(props: { content: string }) {
  let content = props.content;

  // remove ``` block if directly at the beginning
  if (content.trim().startsWith("```") && content.trim().endsWith("```")) {
    content = content.trim().split("\n").slice(1, -1).join("\n");
  }

  // in each line, remove leading line numbers
  const lines = content.split("\n");
  if (
    (LANGUAGE_CLASSIFIER.derive_highlighting_language(content) as string) ===
    "plaintext"
  ) {
    return content;
  }
  const cleaned = lines.map((line) => {
    return remove_line_numbers(line);
  });

  return cleaned.join("\n");
}

function remove_line_numbers(text) {
  // Find line numbers with optional ':'
  const pattern = /(^\s*\d+:?)(\s*.*)/;

  // Replace with everything after the line number
  return text.replace(pattern, (_, group1, group2) => group2).replace("\t", "");
}

/**
 * Derives the highlighting language of a given content (among a set of supported programming languages)
 *
 * Uses simple token counts to determine the language.
 */
class LanguageClassifier {
  supported_languages = ["python", "typescript", "plaintext", "markdown"];

  // we transform KEY_TOKENS into a map that maps 'token' -> ['lang1', 'lang2', ...] (so we don't have to iterate over all languages for counting)
  token_map: Record<string, string[]>;

  constructor() {
    this.token_map = {};
    for (let language in KEY_TOKENS) {
      // If KEY_TOKENS[language] is an object, iterate over its keys
      for (let token in KEY_TOKENS[language]) {
        if (!this.token_map[token]) {
          this.token_map[token] = [];
        }
        this.token_map[token].push(language);
      }
    }
  }

  /**
   * Classify the content as one of the supported programming languages.
   *
   * Uses counts over a set of key tokens to determine the language.
   *
   * @param content the content to classify
   * @param return_distribution if true, returns the distribution of key tokens
   *
   * @returns the classified language
   * @returns the distribution of key tokens if return_distribution is true
   *
   */
  derive_highlighting_language(
    content: string,
    return_distribution = false
  ): string | Record<string, number> {
    // if it is a markdown block with tag, we can use the tag to classify
    if (content.trim().startsWith("```")) {
      const tag = content.trim().split("\n")[0].replace("```", "");
      if (tag === "python") {
        return "python";
      } else if (tag === "javascript") {
        return "typescript";
      } else if (tag === "typescript") {
        return "typescript";
      }
    }

    // count the number of occurrences of each key token
    let counts: Record<string, number> = Object.fromEntries(
      this.supported_languages.map((language) => [language, 0])
    );
    for (let token in this.token_map) {
      const n = content.split(token).length - 1;
      for (let language of this.token_map[token]) {
        counts[language] += n * KEY_TOKENS[language][token];
      }
    }

    // bound counts to be at least 0
    for (let language in counts) {
      counts[language] = Math.max(0, counts[language]);
    }

    // sort languages by number of occurrences
    const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

    // pair with their count
    const pairs: [string, number][] = sorted.map((language) => [
      language,
      counts[language],
    ]);

    // get the most and second most occurring language
    const max_language = pairs[0][0];
    const max = pairs[0][1];
    const second_max = pairs[1][1];

    // total number of occurrences
    const total = pairs.reduce((acc, [_, count]) => acc + count, 0);

    // normalize counts
    for (let language in counts) {
      counts[language] = counts[language] / total;
    }

    // if the difference between the most and least occurring language is too small (in relative terms), we classify as plaintext
    if (max - second_max < 0.05 * total) {
      if (return_distribution) {
        return Object.fromEntries(
          Object.entries(counts).map(([key, value]) => [
            key,
            Math.round(value * 100) / 100,
          ])
        );
      }
      return "plaintext";
    }

    // return distribution if requested
    if (return_distribution) {
      // return counts, but truncate to 2 decimal places
      return Object.fromEntries(
        Object.entries(counts).map(([key, value]) => [
          key,
          Math.round(value * 100) / 100,
        ])
      );
    }

    // if the max language has 'null' as count, we classify as plaintext (this means that no key tokens were found)
    if (!counts[max_language]) {
      return "plaintext";
    }

    return max_language;
  }
}

const LANGUAGE_CLASSIFIER = new LanguageClassifier();

// register the code-highlighter plugin
register_plugin({
  name: "code-highlighter",
  component: (props) => <CodeHighlightedView {...props} />,
  isCompatible: (address: string, msg: any, content: string) => {
    if (
      content.includes("s3_img_link") ||
      content.includes("local_img_link") ||
      content.includes("local_base64_img")
    ) {
      return false;
    }
    const lang = LANGUAGE_CLASSIFIER.derive_highlighting_language(content);
    // if (lang === 'plaintext') {
    //     return false;
    // }
    return true;
  },
});

export default CodeHighlightedView;
