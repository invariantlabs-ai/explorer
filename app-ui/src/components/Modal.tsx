import React from "react";

/**
 * Renders a overlayed modal dialog on top of the current screen.
 *
 * @param {string} title - The title of the modal dialog.
 * @param {boolean} hasWindowControls - Whether the modal dialog has window controls (e.g. close button).
 * @param {boolean} hasFooter - Whether the modal dialog has a footer.
 * @param {string} cancelText - The text to display on the cancel button.
 * @param {function} onClose - The function to call when the modal dialog is closed.
 * @param {string} className - The class name to apply to the modal dialog.
 *
 * @param {React.ReactNode} children - The content of the modal dialog.
 *
 * Example:
 *
 * <Modal title='My Modal' onClose={() => console.log('closed')} hasWindowControls={true} hasFooter={true}>
 *  <p>Modal content here</p>
 * </Modal>
 */
export function Modal(props) {
  // on escape key
  React.useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape" && props.hasWindowControls) {
        props.onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  return (
    <div className="app-modal">
      <div className="modal-background" onClick={props.onClose} />
      <div className={"modal-content " + (props.className || "")}>
        {props.hasWindowControls && (
          <header className="window-controls">
            <button onClick={props.onClose}>
              {props.cancelText || "Cancel"}
            </button>
          </header>
        )}
        <h1>{props.title}</h1>
        {props.children}

        {props.hasFooter && (
          <footer>
            <button onClick={props.onClose}>Dismiss</button>
          </footer>
        )}
      </div>
    </div>
  );
}
