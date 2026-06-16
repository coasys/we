/** Decode a file-storage resolved value into a plain string.
 * File-storage properties (resolveLiteral: false) convert stored blobs to "data:<mime>;base64,<b64>" strings. */
export function decodeFileAsString(data: string | null | undefined): string {
  if (typeof data !== 'string' || !data.startsWith('data:') || !data.includes(';base64,')) return '';
  try {
    return atob(data.split(';base64,')[1]);
  } catch {
    return '';
  }
}

/** Decode a file-storage resolved value into a parsed object */
export function decodeFileAsJson(data: string | null | undefined): Record<string, unknown> {
  const raw = decodeFileAsString(data);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
