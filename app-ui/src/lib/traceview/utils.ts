/**
 * Truncate a string to a maximum length.
 */
export function truncate(str: string, n: number) {
    return (str.length > n) ? str.substring(0, n - 1) + '…' : str;
}