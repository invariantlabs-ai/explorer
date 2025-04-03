/**
 * User-customizable view options for trace views (e.g. collapse behavior, etc.).
 */

import React, { useEffect } from "react";
import { AnnotationCounterBadge } from "../../lib/traceview/traceview";

export interface ViewOptions {
  autocollapseTestTraces: boolean;
  autocollapseAll: boolean;
  showUserBadges: boolean;
  showAnalyzerModelBadge: boolean;
  showGuardrailsErrorBadge: boolean;
}

// all listeners that are registered to be notified when view options change
const GLOBAL_VIEW_OPTIONS_LISTENERS = new Set<() => void>();

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
    showUserBadges: true,
    showAnalyzerModelBadge: true,
    showGuardrailsErrorBadge: true,
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

    // notify all listeners that the view options have changed
    GLOBAL_VIEW_OPTIONS_LISTENERS.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error("Failed to notify view options listener", e);
      }
    });
  };

  // register as view options listener
  useEffect(() => {
    // listen for GLOBAL_VIEW_OPTIONS_LISTENERS and update via setViewOptions
    const handler = () => {
      const localStorageOptions = localStorage.getItem(LOCAL_STORAGE_KEY);
      let options = {
        autocollapseTestTraces: false,
        autocollapseAll: false,
        showUserBadges: true,
        showAnalyzerModelBadge: true,
        showGuardrailsErrorBadge: true,
      };
      try {
        options = JSON.parse(localStorageOptions || "{}");
      } catch (e) {
        console.error("Failed to parse view options from local storage", e);
      }
      _setViewOptions(options);
    };

    GLOBAL_VIEW_OPTIONS_LISTENERS.add(handler);

    return () => {
      GLOBAL_VIEW_OPTIONS_LISTENERS.delete(handler);
    };
  }, []);

  const viewOptionsEditor = (
    <div className="options">
      <h2>Trace Events</h2>

      <div>
        <div className="radio-block">
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
        <div className="radio-block">
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
        <div className="radio-block">
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
      <h2>Trace Badges</h2>
      <h3>Customize the badges shown on traces in the sidebar.</h3>
      <div>
        <div>
          <input
            type="checkbox"
            name="viewOption"
            checked={viewOptions.showUserBadges}
            id="user-badges"
            onChange={(e) =>
              setViewOptions({
                showUserBadges: e.target.checked, // Use the actual checkbox state
              })
            }
          />
          <AnnotationCounterBadge count={1} type="user" />
          <label htmlFor="user-badges">User annotations.</label>
        </div>

        <div>
          <input
            type="checkbox"
            name="viewOption"
            checked={viewOptions.showAnalyzerModelBadge}
            id="analyzer-model-badges"
            onChange={(e) =>
              setViewOptions({
                showAnalyzerModelBadge: e.target.checked, // Use the actual checkbox state
              })
            }
          />
          <AnnotationCounterBadge count={1} type="analyzer-model" />
          <label htmlFor="analyzer-model-badges">
            Analyzer Model annotations.
          </label>
        </div>

        <div className="badge-checkbox-group">
          <input
            type="checkbox"
            name="viewOption"
            checked={viewOptions.showGuardrailsErrorBadge}
            id="guardrail-badges"
            onChange={(e) =>
              setViewOptions({
                showGuardrailsErrorBadge: e.target.checked, // Use the actual checkbox state
              })
            }
          />
          <AnnotationCounterBadge count={1} type="guardrails-error" />
          <label htmlFor="guardrail-badges">Guardrails annotations.</label>
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
