import React, { useRef } from 'react';
import { useEffect, useState } from 'react';

import Editor from '@monaco-editor/react';

const SNIPPETS: Record<string, string> = {
    "sapmail": `- "dataflow.block":
    name: "Don't leak my personal inbox outside of SAP"
    source: "tool:google_mail_get_inbox"
    sink: "tool:google_mail_send_message({\\
        to: \\"^[^@]*@(?!sap\\\\.com)\\"\\
    })"
    fix: "Choose a sap.com e-mail address"`,
    "mail": `- "dataflow.block":
    name: "Don't leak my personal inbox outside of acme.com"
    source: "tool:google_mail_get_inbox"
    sink: "tool:google_mail_send_message({\\
        to: \\"^[^@]*@(?!acme\\\\.com)\\"\\
    })"
    fix: "Choose a acme.com e-mail address"`,
    "slack": `- "dataflow.block":
    name: "Don't leak my personal inbox to Slack"
    source: "tool:google_mail_get_inbox"
    sink: "tool:slack_send_message"`,
    "location": `- "tools.restrict":
    name: "You cannot leak location data in outbound message"
    pattern: "tool:google_mail_send_message({\\
        message: <LOCATION>\\
    })"`,
    "gsheets": `- "dataflow.block":
    name: "Don't post untrusted Google Sheets data into the internal Slack"
    source: "tool:google_sheets_get_spreadsheet_data"
    sink: "tool:slack_send_message"`
}

export function PolicyEditor(props: {contents: string, onChange: (value: (string | undefined)) => void, autoHeight?: boolean, lineNumbers?: boolean}) {
    const [height, setHeight] = React.useState(((props.contents || '').split('\n').length + 1) * 18 + 'pt');
    const editorRef = useRef(null as (any | null));
    const [isDarkMode, setDarkMode] = useState(false);

    let contents = props.contents || '';
    let editorLanguage = 'yaml';

    const updateHeight = () => {
        if (editorRef.current) {
            editorRef.current.layout();
            let n_lines = editorRef.current.getModel().getLineCount();
            let maxInElementOffset = editorRef.current.getTopForLineNumber(n_lines + 1);
            setHeight(maxInElementOffset + 18 * 2 + 'px');
        }
    };

    useEffect(() => {
        if (editorRef.current && editorRef.current.getValue() !== contents) {
            editorRef.current.setValue(contents);
            editorRef.current.updateOptions({
                language: editorLanguage
            });
        }
    }, [contents]);

    return <Editor
            className='policy-editor'
            onMount={(editor, monaco) => {
                editorRef.current = editor;
                // restore content from local storage
                if (contents) {
                    editor.setValue(contents);
                }
                // disable diagnostics
                monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
                    noSyntaxValidation: true,
                    noSemanticValidation: true,
                  });
                monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
                    validate: false,
                    allowComments: false,
                    schemas: []
                });
                // add snippets
                monaco.languages.registerCompletionItemProvider(editorLanguage, {
                    provideCompletionItems: () => {
                        return {
                            suggestions: Object.keys(SNIPPETS).map(key => ({
                                label: key,
                                kind: monaco.languages.CompletionItemKind.Snippet,
                                insertText: SNIPPETS[key]
                            }))
                        } as any;
                    }
                });

                if (props.autoHeight) {
                    // update height
                editor.onDidLayoutChange(() => {
                    updateHeight();
                });
                updateHeight();
                }
            }}
            onChange={(value) => {
                if (props.autoHeight) {
                    updateHeight();
                }
                props.onChange(value);
            }}
            defaultLanguage={editorLanguage}
            defaultValue=""
            height={props.autoHeight ? height : undefined}
            theme={isDarkMode ? 'vs-dark' : 'vs-light'}
            options={{
                minimap: {
                    enabled: false
                },
                // no markers in scrollbar
                glyphMargin: false,
                language: editorLanguage,
                fontSize: 18,
                // padding
                padding: {
                    top: 2,
                    bottom: 2,
                },
                // long lines
                wordWrap: 'on',
                // left bar with line numbers
                lineNumbers: props.lineNumbers ? 'on' : 'off',
                scrollBeyondLastLine: false,
                // no scroll bars
                // padding left to numbers
                folding: false
            }}
        />
}