import type { SerializedBlockNode } from './types';

/**
 * Decode an editorState data URL (returned by file-storage resolution) into a
 * SerializedBlockNode (Lexical root node JSON).
 *
 * The ad4m model system resolves FILE_STORAGE_LANGUAGE CIDs into
 * "data:<mime>;base64,<b64>" strings. JS-function @Property transforms
 * are silently dropped by the Rust executor, so consumers must decode
 * the data URL themselves.
 *
 * Returns null if the input is not a valid data URL or the payload is
 * not parseable JSON.
 */
export function decodeEditorState(dataUrl: string | null | undefined): SerializedBlockNode | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:') || !dataUrl.includes(';base64,')) return null;
  try {
    return JSON.parse(atob(dataUrl.split(';base64,')[1]));
  } catch {
    return null;
  }
}
