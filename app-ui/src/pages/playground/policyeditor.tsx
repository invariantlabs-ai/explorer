import Editor from "@monaco-editor/react";

interface PolicyEditorProps {
  height?: string;
  defaultLanguage?: string;
  theme?: string;
  value?: string;
  onChange?: (value: string | undefined) => void;
}

interface PolicyEditorProps {
  width?: string;
  height?: string;
  defaultLanguage?: string;
  theme?: string;
  value?: string;
  readOnly?: boolean;
  fontSize?: number;
  onChange?: (value: string | undefined) => void;
  onDidContentSizeChange?: (number) => void;
  className?: string;
}

export function PolicyEditor(props: PolicyEditorProps) {
  const onMount = (editor: any, monaco: any) => {
    // register completion item provider
    monaco.languages.registerCompletionItemProvider("python", {
      provideCompletionItems: function (model, position) {
        return {
          suggestions: [
            {
              label: "pi",
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: `from invariant.detectors import prompt_injection`,
              documentation: "Import prompt injection detection predicates.",
            },
            {
              label: "usermsg",
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: `(msg: Message)\nmsg.role == 'user'`,
              documentation: "Matches a user message.",
            },
            // call -> (call|: ToolCall)
            {
              label: "call",
              kind: monaco.languages.CompletionItemKind.Snippet,
              // set cursor fater call
              insertText: `(call: ToolCall)`,
              documentation: "Matches a tool call.",
            },
            // out -> (out|: ToolOutput)
            {
              label: "out",
              kind: monaco.languages.CompletionItemKind.Snippet,
              // set cursor fater call
              insertText: `(out: ToolOutput)`,
              documentation: "Matches a tool output.",
            },
            // import invariant.detectors.code (python_code, ipython_code, semgrep)
            {
              label: "code",
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: `from invariant.detectors.code import python_code, ipython_code, semgrep`,
              documentation: "Import code detectors.",
            },
            {},
          ],
        };
      },
    });
    if (props.onDidContentSizeChange) {
      editor.onDidContentSizeChange(props.onDidContentSizeChange);
    }
  };

  return (
    <Editor
      width={props.width}
      height={props.height}
      defaultLanguage="python"
      options={{
        wordWrap: "on",
        readOnly: props.readOnly,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: {
          vertical: props.readOnly ? "hidden" : "auto",
        },
        fontSize: props.fontSize || 14,
        overviewRulerBorder: false,
      }}
      onMount={onMount}
      {...props}
    />
  );
}
