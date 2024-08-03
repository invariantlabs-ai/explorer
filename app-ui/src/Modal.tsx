import React from 'react'

export function Modal(props) {
  // on escape key
  React.useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && props.hasWindowControls) {
        props.onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [props.onClose])

  return <div className="app-modal">
    <div className="modal-background" onClick={props.onClose}/>
    <div className="modal-content">
      {props.hasWindowControls && <header className='window-controls'>
        <button onClick={props.onClose}>{props.cancelText || 'Cancel'}</button>
      </header>}
      <h1>{props.title}</h1>
      {props.children}

      {props.hasFooter && <footer>
        <button onClick={props.onClose}>Close</button>
      </footer>}
    </div>
  </div>
}