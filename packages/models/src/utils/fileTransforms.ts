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

/**
 * Encode a JSON value as the FileData a file-storage property is written with — the inverse of
 * {@link decodeFileAsJson}, UTF-8-safe (TextEncoder before btoa, so non-ASCII survives).
 */
export function encodeJsonFileData(
  value: unknown,
  name: string,
): { data_base64: string; name: string; file_type: string } {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { data_base64: btoa(binary), name, file_type: 'application/json' };
}
