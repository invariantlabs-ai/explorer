import * as CodeHighlighter from './plugins/code-highlighter';
import * as ImageViewer from './plugins/image-viewer';

// globally-enabled rendering plugins
let PLUGINS = [
    CodeHighlighter,
    ImageViewer,
];

let DISABLED_PLUGINS: string[] = [];

export class Plugins {
    static disable(pluginName: string) {
        if (!DISABLED_PLUGINS.includes(pluginName)) {
            DISABLED_PLUGINS.push(pluginName);
        }
    }

    static getPlugins() {
        // check window['$invariant_viewer_plugins'] for plugins
        if (window['$invariant_viewer_plugins']) {
            return window['$invariant_viewer_plugins'].filter((plugin) => {
                return !DISABLED_PLUGINS.includes(plugin.name);
            });
        } else {
            return [];
        }
    }
}

/**
 * Register a plugin to be used in the invariant viewer (a plugin for rendering a specific type of content).
 * 
 * Example usage:
 * 
 * ```
 * register_plugin({
 *   // name of the plugin
 *   name: 'code-highlighter',
 *   // component factory
 *   component: (props) => <CodeHighlightedView {...props} />,
 *   // function to determine if the plugin should be used for a given piece of content
 *   isCompatible: (address: string, msg: object, content: string) => { 
 *      return address.endsWith('.content') || address.endsWith('.code');
 *   }
 * });
 * ```
 * 
 * In addition to this, make sure the `register_plugin` function is called (the file must be imported in the main app).
}
 */
export function register_plugin(plugin) {
    let plugins = window['$invariant_viewer_plugins'] || [];
    plugins.push(plugin);
    window['$invariant_viewer_plugins'] = plugins;
}