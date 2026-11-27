/**
 * The id a record created by an operation gets: the same on every run of the same invocation, and
 * on every implementation.
 *
 * Derived from the invocation and the step that creates the record, so a replay of an invocation
 * names the records the first run made (and is refused as `recordExists` rather than duplicating
 * them), and a later step can address a record an earlier one is about to create without reading it.
 *
 * ## The derivation, exactly
 *
 * The input is the invocation id followed by each segment of the step's path, each written as its
 * UTF-8 byte length in decimal, a colon, then its UTF-8 bytes (`36:3f2b…` `1:0` `3:k=a`). Length
 * prefixes rather than a separator, so no key, whatever it contains, can make two paths read alike.
 * The id is `urn:uuid:` and the first 16 bytes of the input's SHA-256, formatted as a version-8 UUID
 * (RFC 9562: version nibble 8, variant bits 10), lowercase.
 *
 * A path's segments: each step's index from the root (`0`, `1`, …); for each `forEach` level, `k=`
 * and the item's key as text; for each `call`, `c=` and the called operation's qualified name. A
 * forEach contributes the item's key, never its position, so reordering a list does not move which
 * id each item's record gets.
 */

const encoder = new TextEncoder();

function framed(parts: readonly string[]): Uint8Array {
  let text = '';
  for (const part of parts) text += `${encoder.encode(part).length}:${part}`;
  return encoder.encode(text);
}

/** A UUID formatted from 16 bytes, with the version-8 and variant bits set. */
function uuidV8(bytes: Uint8Array): string {
  const b = bytes.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function deriveRecordId(invocationId: string, path: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', framed([invocationId, ...path]) as BufferSource);
  return `urn:uuid:${uuidV8(new Uint8Array(digest))}`;
}

/** The path segment a forEach item contributes. */
export const keySegment = (key: string) => `k=${key}`;
/** The path segment a call contributes. */
export const callSegment = (qualifiedName: string) => `c=${qualifiedName}`;
