import type { FileData } from './imageHelpers';

/** Decode a file-storage blob (base64 or raw string) into a plain string */
export function decodeFileAsString(data: FileData | string | null | undefined): string {
  if (data && typeof data === 'object' && 'data_base64' in data) {
    try {
      return atob(data.data_base64);
    } catch {
      return '';
    }
  }
  if (typeof data === 'string') return data;
  return '';
}

/** Decode a file-storage blob (base64 JSON or raw JSON string) into a parsed object */
export function decodeFileAsJson(data: FileData | string | null | undefined): Record<string, unknown> {
  const raw = decodeFileAsString(data);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
