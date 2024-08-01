import React, { useState } from 'react';
import { Panel } from 'react-resizable-panels'
import { useEffect } from 'react';

export function Tab(props) {
    return props.children;
}

export function TabbedPanel(props) {
    const [activeTab, _setActiveTab] = useState(props.editorState.settings[props.autoSaveId] || 0);

    useEffect(() => {
        const handler = (settings) => {
            _setActiveTab(settings[props.autoSaveId] || 0);
        }
        props.editorState.onSettingsChanged(handler);
        
        return () => {
            props.editorState.offSettingsChanged(handler);
        }
    }, [activeTab]);

    const setActiveTab = (index) => {
        if (props.autoSaveId) {
            props.editorState.setSetting(props.autoSaveId, index);
        } else {
            _setActiveTab(index);
        }
    }

    return <Panel minSize={props.minSize || 1} size={props.size || 1} style={props.style} className={props.className || ''}>
        <header className='tabbed'>
            <div className='tabs'>
                {React.Children.map(props.children, (child, index) => {
                    return <button className={index === activeTab ? 'active' : ''} onClick={() => setActiveTab(index)}>{child.props.name || 'Tab'}</button>
                })}
            </div>
        </header>
        <div className='tabbed-content'>
        {React.Children.map(props.children, (child, index) => {
            return <div className={index === activeTab ? 'tab active' : 'tab hidden'}>{child}</div>
        })}
        </div>
    </Panel>
}