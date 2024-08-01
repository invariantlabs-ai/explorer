import React, { useRef } from 'react';
import { useEffect } from 'react';
import { useState } from 'react';

import Editor from '@monaco-editor/react';
import {Panel} from 'react-resizable-panels'
import { appearance } from './Appearance';

export function EditorPanel(props) {
    const editorRef = useRef(null);
    const [editorLanguage, setEditorLanguage] = useState('typescript');
    const [activeMessage, setActiveMessage] = useState(null);
    const [contents, setContents] = useState('');
    const [executionRunning, setExecutionRunning] = useState(props.editorState.execution_running);
    const [holdsCtrl, setHoldsCtrl] = useState(false);

    const [messageAttribute, messageKey] = activeMessage ? (activeMessage.includes(':') ? activeMessage.split(':') : ['content', activeMessage]) : [null, null];
    const [isDarkMode, setDarkMode] = useState(appearance.darkMode);

    useEffect(() => {
        const listener = value => setDarkMode(value);
        appearance.onAppearance(listener);
        return () => appearance.offAppearance(listener);
    }, []);

    useEffect(() => {
        // update active message when it changes in EditorState
        const onActiveMessageChange = (messageKey) => {
            setActiveMessage(messageKey);
        }
        props.editorState.onSelectedMessage(onActiveMessageChange);

        const onExecution = (steps) => {
            setExecutionRunning(props.editorState.execution_running);
        }
        props.editorState.onExecution(onExecution);

        // update editor contents when active message changes
        const onEditorStateChange = (editorState) => {
            const message = editorState.messages.find(m => m.key === messageKey);
            if (message) {
                setEditorLanguage(message.role === 'workflow' ? 'typescript' : 'json');
                setContents(message.content);
            }
        }
        props.editorState.onLoaded(onEditorStateChange);
        onEditorStateChange(props.editorState);

        return () => {
            props.editorState.offExecution(onExecution);
            props.editorState.offLoaded(onEditorStateChange);
            props.editorState.offSelectedMessage(onActiveMessageChange);
        }
    }, [props.editorState]);

    useEffect(() => {
        // install global shortcuts for Ctrl-R and Ctrl-V for onRun and onVerify
        const onGlobalKeyDown = (event) => {
            if (event.ctrlKey && event.key === 'r') {
                onRun();
            } else if (event.ctrlKey && event.key === 'v') {
                onVerify();
            }
            if (event.ctrlKey) {
                setHoldsCtrl(true);
            }
        }
        window.addEventListener('keydown', onGlobalKeyDown);

        const onGlobalKeyUp = (event) => {
            if (!event.ctrlKey) {
                setHoldsCtrl(false);
            }
        }
        window.addEventListener('keyup', onGlobalKeyUp);

        return () => {
            window.removeEventListener('keydown', onGlobalKeyDown);
            window.removeEventListener('keyup', onGlobalKeyUp);
        }
    });

    // update editor contents when active message changes
    useEffect(() => {
        if (activeMessage) {
            try {
                const message = props.editorState.messages.find(m => m.key === messageKey);
                if (message) {
                    if (messageAttribute === 'content') {
                        setEditorLanguage(message.role === 'workflow' ? 'typescript' : 'json');
                    } else if (messageAttribute !== 'content') {
                        setEditorLanguage('markdown');
                    }
                    setContents(message[messageAttribute]);
                }
            } catch (e) {
                console.error(e);
                setContents('Failed to load message contents (message key: ' + activeMessage + ')');
            }
        } else {
            setContents('');
        }
    }, [activeMessage]);

    // update editor element contents when contents change
    useEffect(() => {
        if (editorRef.current) {
            if (contents === editorRef.current.getValue()) {
                return;
            }
            editorRef.current.setValue(contents);
            editorRef.current.getModel().setLanguage(editorLanguage);
        }
    }, [editorRef, contents, editorLanguage]);

    const onRun = () => {
        props.editorState.setSetting('editor.right.active_tab', 1)
        props.editorState.run(messageKey)
    }

    const onVerify = () => {
        props.editorState.setSetting('editor.right.active_tab', 1)
        props.editorState.verify(messageKey)
    }

    const onChange = (value) => {
        if (messageKey) {
            const message = props.editorState.messages.find(m => m.key === messageKey);
            if (message[messageAttribute] === value) {
                return;
            }
            if (messageAttribute !== 'content') {
                return;
            }
            
            props.editorState.setMessages(msgs => [...msgs.map(m => {
                if (m.key === messageKey) {
                    let updated_msg = Object.assign({}, m);
                    updated_msg['content'] = value;
                    return updated_msg;
                }
                return m;
            })]);
        }
    }
    
    let CONTENT_TYPES = {
        "system_prompt": ": System Prompt",
        "content": ""
    }

    return <Panel>
        <header>
            <h2>{props.title || 'Editor'} {messageAttribute ? CONTENT_TYPES[messageAttribute] : ''}</h2>
            <div className='spacer'></div>
            <button className='clicky' onClick={onVerify} disabled={executionRunning}>
                {/* with utf8 play symbol triangle */}
                Verify {holdsCtrl ? '(Ctrl+V)' : ''}
            </button>
            <button className='clicky' onClick={onRun} disabled={executionRunning}>
                {/* with utf8 play symbol triangle */}
                ▶ Run {holdsCtrl ? '(Ctrl+R)' : ''}
            </button>
        </header>
        <div className='graph-pan-blocker right'/>
        <Editor
            onMount={(editor, monaco) => {
                editorRef.current = editor;
                // set editor contents
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
            }}
            onChange={(value, event) => onChange(value)}
            defaultLanguage={editorLanguage}
            defaultValue={contents}
            theme={isDarkMode ? 'vs-dark' : 'vs-light'}
            options={{
                minimap: {
                    enabled: false
                },
                language: editorLanguage,
                fontSize: 18,
                // padding
                padding: {
                    top: 20,
                    bottom: 20
                },
                // left bar with line numbers
                lineNumbers: 'on',
                // break long lines
                wordWrap: 'on',
                // padding left to numbers
                folding: false
            }}
        />
    </Panel>
}