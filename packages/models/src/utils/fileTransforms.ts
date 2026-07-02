/** Decode a file-storage resolved value into a plain string.
 * resolveLanguage always converts stored blobs to "data:<mime>;base64,<b64>" strings. */
export function decodeFileAsString(data: string | null | undefined): string {
  if (typeof data !== 'string' || !data.startsWith('data:') || !data.includes(';base64,')) return '';
  try {
    const binary = atob(data.split(';base64,')[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
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
