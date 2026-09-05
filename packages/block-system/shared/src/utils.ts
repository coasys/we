import type { ContentBlock } from './content';
import { fromPortableText, isContentBlockArray, isContentDocument } from './content';

/**
 * Decode base64 that was produced from UTF-8 — the way `createBlocks` writes the blob. A bare
 * `atob` gives back Latin-1 code units and turns every non-ASCII character in a post into mojibake,
 * which is a bug the fixtures package documented before this existed.
 */
function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Encode a string as base64 of its UTF-8 bytes — the inverse of {@link decodeBase64Utf8}. */
export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Whatever a stored composition arrives as, to content blocks.
 *
 * Accepts the `data:application/json;base64,…` string a resolved file field reads as, an already
 * parsed value, a content document or a bare block array — and answers with the lean in-memory
 * form. Returns null only for something that is none of those.
 */
export function decodeEditorState(input: unknown): ContentBlock[] | null {
  let value: unknown = input;
  if (typeof value === 'string') {
    if (!value.startsWith('data:') || !value.includes(';base64,')) {
      // A raw JSON string is tolerated — a fixture or a test may hand one over.
      try {
        value = JSON.parse(value);
      } catch {
        return null;
      }
    } else {
      try {
        value = JSON.parse(decodeBase64Utf8(value.split(';base64,')[1]));
      } catch {
        return null;
      }
    }
  }
  return contentFromValue(value);
}

/** The parsed-value half of {@link decodeEditorState}. */
export function contentFromValue(value: unknown): ContentBlock[] | null {
  if (isContentDocument(value)) return fromPortableText(value.blocks);
  if (isContentBlockArray(value)) return fromPortableText(value);
  return null;
}
