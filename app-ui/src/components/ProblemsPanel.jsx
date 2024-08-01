import React, { useRef } from 'react';
import { useEffect } from 'react';
import { useState } from 'react';

import Editor from '@monaco-editor/react';
import {Panel} from 'react-resizable-panels'
import { BsExclamationSquareFill, BsFillLightbulbFill, BsFillLightbulbOffFill } from 'react-icons/bs';

export function ProblemsRow(props) {
    const [collapsed, setCollapsed] = useState(true);

    const onClick = (e, h1=false) => {
        // on shift set highlight
        if (e.shiftKey) {
            props.highlighted ? props.onUnhighlight() : props.onHighlight();
        } else if (collapsed || h1) {
            setCollapsed(!collapsed);
        }
    }

    let stripped_details = {...props.issue};
    delete stripped_details.message;
    delete stripped_details.rule;

    let type = props.issue.type ? props.issue.type : "error";
    
    return <li className={'problem' + (collapsed ? ' collapsed' : '') + (props.highlighted ? ' hovered' : '')} onClick={onClick}>
        <h1 onClick={(e) => onClick(e, true)}>
            {/* <div className='role' onClick={() => setCollapsed(!collapsed)}>{collapsed ? '▶' : '▼'} System policy</div> */}
            <BsExclamationSquareFill />
            {collapsed ? '▶' : '▼'}
            {props.issue.rule ?  " Violation: " + props.issue.rule : props.issue.message}</h1>
        <button onClick={(e) => { props.highlighted ? props.onUnhighlight() : props.onHighlight(); e.stopPropagation();} } className={'highlight action outline toggle' + (props.highlighted ? ' active' : '')}>
            {<BsFillLightbulbFill />}
        </button>
        {!collapsed && <>
            {props.issue.message && <p>{props.issue.message}</p>}
            <code>
                {JSON.stringify(stripped_details)}
            </code>
            <span className='type'>{type}</span>
        </>}
    </li>
}

export function ProblemsPanel(props) {
    const [messageKey, setActiveMessage] = useState(null);
    const [problems, setProblems] = useState([]);
    const [highlighedProblem, _setHighlightedProblem] = useState(props.editorState.highlightedProblem);

    const setHighlightedProblem = (problem) => {
        if (problem) {
            props.editorState.highlightProblem(problem);
        } else {
            props.editorState.highlightProblem(false);
        }
    }

    useEffect(() => {
        const onHighlightProblem = (problem) => {
            if (problem && problem.messageKey === messageKey) {
                _setHighlightedProblem(problem);
            } else {
                _setHighlightedProblem(null);
            }
        };
        props.editorState.onHighlightProblem(onHighlightProblem);

        // clear highlighted problem when message changes
        setHighlightedProblem(null);

        return () => {
            props.editorState.offHighlightProblem(onHighlightProblem);
        }
    }, [messageKey]);

    // listen for editor state active message changes
    useEffect(() => {
        // update active message when it changes in EditorState
        const onActiveMessageChange = (messageKey) => {
            setActiveMessage(messageKey);
        }
        props.editorState.onSelectedMessage(onActiveMessageChange);

        // update editor contents when active message changes
        const onEditorStateChange = (editorState) => {
            setActiveMessage(editorState.activeMessage);
        }
        props.editorState.onLoaded(onEditorStateChange);
        onEditorStateChange(props.editorState);

        return () => {
            props.editorState.offLoaded(onEditorStateChange);
            props.editorState.offSelectedMessage(onActiveMessageChange);
        }
    }, []);

    useEffect(() => {
        const message = props.editorState.messages.find(m => m.key === messageKey);
        if (!message) {
            setProblems([]);
            return;
        }

        let issues = message.issues || [];

        if (message.role == "verifier") {
            try {
                if (!message.issues) {
                    let payload = JSON.parse(message.content);
                    issues = payload.issues;
                }
            } catch (e) {
                console.error(e);
                return;
            }
        }

        setProblems(issues.map((issue,i) => ({
            // truncate title
            key: i,
            issue,
            messageKey: messageKey
        })));
    }, [messageKey]);

    const highlightedKey = highlighedProblem ? highlighedProblem.key : null;

    return <Panel minSize={10}>
        <header>
            <h2>
                Verifier
            </h2>
            <div className='spacer'></div>
        </header>
        <ul className='problems'>
            {problems.map(problem => <ProblemsRow key={problem.key} {...problem} highlighted={highlightedKey === problem.key} onHighlight={() => setHighlightedProblem(problem)} onUnhighlight={() => setHighlightedProblem(null)} />)}
            {problems.length === 0 && <li className='empty'>No Policy Violations</li>}
        </ul>
    </Panel>
}