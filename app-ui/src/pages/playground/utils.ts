export function clearTerminalControlCharacters(str: string): string {
  // remove control characters like [31m
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[\d+m/g, "");
}

export function beautifyJson(jsonString: string): string {
  try {
    const parsedJson = JSON.parse(jsonString);
    return JSON.stringify(parsedJson, null, 2); // 2-space indentation
  } catch {
    return jsonString; // If it's not valid JSON, return the original string
  }
}

export function isDigit(str: string): boolean {
  return /^\d+$/.test(str);
}
