import React, { useState, useEffect } from 'react'
import { TraceView } from './lib/traceview/traceview';
import { Modal } from './Modal';

const CONTENT = `[
  {
    "role": "assistant",
    "content": "Hello, how can I help you today?"
  }
]`

function postTrace(trace: string) {
  return fetch('/api/v1/trace/snippets/new', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ 
      "content": trace,
      "extra_metadata": {}
    })
  }).then((res) => {
    if (!res.ok) {
      throw new Error('Failed to post trace')
    }
    return res.json()
  })
}

export function New() {
    const [traceString, setTraceString] = React.useState(CONTENT)
    const [sideBySide, setSideBySide] = React.useState(true)
    // const [showWarning, setShowWarning] = React.useState(false)

    // observe window and switch to side by side if window is wide enough
    useEffect(() => {
      const handleResize = () => {
        setSideBySide(window.innerWidth > 1000)
      }
      window.addEventListener('resize', handleResize)
      handleResize()
      return () => window.removeEventListener('resize', handleResize)
    }, [])

    const onPostTrace = () => {
      postTrace(traceString)
        .then((response: any) => {
          if (response.id) {
            window.location.href = `/trace/${response.id}`
          } else {
            throw new Error('Failed to post trace')
          }
        })
        .catch((err) => {
          alert('Failed to post trace')
        })
    }
    
    const header = <>
        <div className="spacer"></div>
        <button className="primary" onClick={() => onPostTrace()}>
          Upload
        </button>
    </>

    return <div className="panel fullscreen app new">
      {/* {showWarning && <Modal title="Validation Errors" hasWindowControls onClose={() => setShowWarning(false)}>
        <p>
          Your trace contains validation errors, are you sure you want to upload it? Some features may not work as expected. 
        </p>
        <p>
          You cannot edit this trace after uploading.
        </p>
        <div className="buttons">
          <button onClick={() => setShowWarning(false)}>
            Cancel
          </button>
          <button className="primary" onClick={() => postTrace(traceString)}>
            Upload Anyway
          </button>
        </div>
      </Modal>} */}
      <TraceView 
        inputData={traceString} 
        sideBySide={sideBySide} 
        handleInputChange={(input: string | undefined) => setTraceString(input || '')} 
        annotations={{}} 
        header={header} 
        title={"Upload Trace"} 
      />
    </div>
  }