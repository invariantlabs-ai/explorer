/**
 * Helpers to render metadata with some additional eyecandy
 * like fitting icons and colors.
 */

import { useState } from "react"
import { BsCheckCircleFill, BsCircleFill, BsExclamationCircleFill, BsRobot } from "react-icons/bs"
import "./Metadata.scss"

/**
 * Tries to infer a nice rendering for a given metadata value (e.g. success, error, warning) 
 * and adds color or an icon accordingly.
 * 
 * Does nothing if the key does not contain any of the keywords.
 */
export function InferredMetadataValueRender(props) {
    const { keyValue } = props

    if (!keyValue) {
        return <BsCircleFill />
    }

    if (keyValue.toLowerCase().includes('error')) {
        // for true and false add <BsCheck/> and <BsExclamationCircleFill/>
        const value = props.children.toString().toLowerCase()
        if (value === 'true') {
            return <span className='red'>
                <BsExclamationCircleFill />
                {props.children}
            </span>
        } else if (value === 'false') {
            return <span className='green'>
                <BsCheckCircleFill />
                {props.children}
            </span>
        } else {
            return props.children
        }
    } else if (keyValue.toLowerCase().includes('success')) {
        const value = props.children.toString().toLowerCase()
        if (value === 'true') {
            return <span className='green'>
                <BsCheckCircleFill />
                {props.children}
            </span>
        } else if (value === 'false') {
            return <span className='red'>
                <BsExclamationCircleFill />
                {props.children}
            </span>
        } else {
            return props.children
        }
    } else if (keyValue.toLowerCase().includes('warning')) {
        return <span className='yellow'>{props.children}</span>
    } else {
        return props.children
    }
}

/**
 * Tries to infer a nice icon for a given key.
 * 
 * Show no icon if the key does not contain any of the keywords.
 */
export function InferredKeyIcon(props) {
    let keyValue = props.keyValue

    if (!keyValue) {
        return null
    }

    keyValue = keyValue.toLowerCase().trim()

    if (keyValue.includes('llm') || keyValue.includes('model')) {
        return <><BsRobot /></>
    }

    return null;
}

/**
 * Renders a key-value pair of metadata.
 */
function Pair(props) {
    const MAX_LENGTH = 80
    const [truncatedState, setTruncated] = useState(true)
    const value = typeof props.value != "string" ? JSON.stringify(props.value) : props.value
    const truncatedValue = value.length > MAX_LENGTH ? value.slice(0, MAX_LENGTH) + '...' : value
    const key = props.keyValue
    const truncated = value != truncatedValue && truncatedState

    return <div className='pair'>
        <span className='key'><InferredKeyIcon keyValue={key} /> {key}</span>
        <span className='value'>{<InferredMetadataValueRender keyValue={key}>
            {truncated ? <>{truncatedValue} <a onClick={() => setTruncated(false)}>Show more</a></> : value}
        </InferredMetadataValueRender>}</span>
    </div>
}

/**
 * Renders a given object of metadata as a list of key-value pairs.
 * 
 * @param props.extra_metadata The metadata object to render.
 * @param props.header The header to display above the metadata.
 */
export function Metadata(props) {
    const extra_metadata = props.extra_metadata;
    
    if (!extra_metadata) {
        return null;
    }

    if (props.trace_id) {
        extra_metadata["trace_id"] = props.trace_id;
    }
    return <div className='event metadata'>
        {props.header}
        <div className='content'>
            {Object.keys(extra_metadata).map(key => {
                return <Pair key={key} keyValue={key} value={extra_metadata[key]} />
            })}
        </div>
    </div>
}