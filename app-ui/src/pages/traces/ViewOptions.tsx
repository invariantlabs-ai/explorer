/**
 * User-customizable view options for trace views (e.g. collapse behavior, etc.).
 */

import React from "react";

export interface ViewOptions {
  autocollapseTestTraces: boolean;
  autocollapseAll: boolean;
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
    autocollapseAll: false,
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
      <h2>Trace Events</h2>

      <div>
        <div>
          <input
            type="radio"
            name="viewOption"
            checked={
              !viewOptions.autocollapseTestTraces &&
              !viewOptions.autocollapseAll
            }
            id="expanded"
            onChange={() =>
              setViewOptions({
                autocollapseTestTraces: false,
                autocollapseAll: false,
              })
            }
          />
          <label htmlFor="expanded">
            Expanded (default)
            <p>All events are expanded by default.</p>
          </label>
        </div>
        <div>
          <input
            type="radio"
            name="viewOption"
            checked={viewOptions.autocollapseAll}
            id="autocollapse-all"
            onChange={() =>
              setViewOptions({
                autocollapseTestTraces: false,
                autocollapseAll: true,
              })
            }
          />
          <label htmlFor="autocollapse-all">
            Collapsed
            <p>All events are collapsed by default.</p>
          </label>
        </div>
        <div>
          <input
            type="radio"
            name="viewOption"
            checked={
              viewOptions.autocollapseTestTraces && !viewOptions.autocollapseAll
            }
            id="autocollapse-test-traces"
            onChange={() =>
              setViewOptions({
                autocollapseTestTraces: true,
                autocollapseAll: false,
              })
            }
          />
          <label htmlFor="autocollapse-test-traces">
            Collapsed for Tests
            <p>Unit testing traces are collapsed by default.</p>
          </label>
        </div>
      </div>
    </div>
  );

  return {
    viewOptions,
    viewOptionsEditor,
    showViewOptionsModal,
    setShowViewOptionsModal,
  };
}
