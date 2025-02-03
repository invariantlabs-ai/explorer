// @ts-ignore (only works in container with mounted config file)
import EXPLORER_CONFIG from "../config/explorer.config.yml";

/**
 * Returns the value of the given key from the explorer.config.yml file.
 *
 * @param key The key to retrieve from the config file.
 * @returns The value of the given key (string, number, object, etc.).
 */
export function config(key: string): any {
  return EXPLORER_CONFIG[key];
}
