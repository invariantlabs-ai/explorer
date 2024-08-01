import { BsCircle, BsCircleFill, BsDiagram2Fill, BsFileTextFill } from "react-icons/bs";
import "./LoadingIndicator.css";
import React from 'react';

export function Step(props: { title: string, subtitle: string, active?: boolean, step: number, editorState?: any, className?: string, children: any }) {
    const onClick = () => {
        if (!props.editorState) return;
        props.editorState.selectMessage(props.step);
    };

    let className = 'step' + (props.active ? ' active' : '');

    if (props.className) className += ' ' + props.className;

    return <div className={className} onClick={onClick}>
        <h1>
            {props.title == "Summary" ?
             <><BsDiagram2Fill/> Summary</> :
             <>{props.title}</>}
        </h1>
        <h2>{props.subtitle}</h2>
        <div className='content'>
            {props.children}
        </div>
    </div>
}

export function Connector() {
    return <div className='connector'></div>
}

export function LoadingStep(props: { text: string }) {
    return <Step title={props.text} className='loading' key='loading' subtitle='' step={0}>
        <div className="lds-ellipsis"><div></div><div></div><div></div><div></div></div>
    </Step>
}