/**
 * User-customizable view options for trace views (e.g. collapse behavior, etc.).
 */

import React from "react";

export interface ViewOptions {
  autocollapseTestTraces: boolean;
}

export function useViewOptions(): {
  viewOptions: ViewOptions;
  viewOptionsEditor: JSX.Element;
  showViewOptionsModal: boolean;
  setShowViewOptionsModal: (show: boolean) => void;
} {
  /**
   * View options are stored in local storage, so that they persist across page reloads.
   *
   * The returned editor component can be used to display the options in a modal.
   *
   * The options are stored in local storage under the key "explorer.viewOptions".
   */
  const LOCAL_STORAGE_KEY = "explorer.viewOptions";
  const localStorageOptions = localStorage.getItem(LOCAL_STORAGE_KEY);
  let options = {
    autocollapseTestTraces: false,
  };
  try {
    options = JSON.parse(localStorageOptions || "{}");
  } catch (e) {
    console.error("Failed to parse view options from local storage", e);
  }

  const [viewOptions, _setViewOptions] = React.useState(options);
  const [showViewOptionsModal, setShowViewOptionsModal] = React.useState(false);

  const setViewOptions = (newOptions: any) => {
    const updatedOptions = { ...viewOptions, ...newOptions };
    _setViewOptions(updatedOptions);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedOptions));
  };

  const viewOptionsEditor = (
    <div className="options">
      <input
        type="checkbox"
        checked={viewOptions.autocollapseTestTraces}
        id="show-annotations"
        onChange={(e) =>
          setViewOptions({ autocollapseTestTraces: e.target.checked })
        }
      />
      <label htmlFor="show-annotations">Auto-Collapse Test Traces</label>
      <p>
        Automatically collapses all messages, except for the initial user
        message, when opening a test trace.
      </p>
    </div>
  );

  return {
    viewOptions,
    viewOptionsEditor,
    showViewOptionsModal,
    setShowViewOptionsModal,
  };
}
