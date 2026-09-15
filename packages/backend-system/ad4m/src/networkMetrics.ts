/**
 * Holochain's network metrics, made readable.
 *
 * The executor serializes the conductor's metrics with serde, and a Holochain hash reaches JSON as
 * its raw bytes: an array of 39 numbers where anyone reading it expects `uhCAk…`. An agent key a
 * person could search a log for is unrecognisable in that form, and the metrics are nearly all
 * hashes. Decoding them here rather than in the shell because the shell cannot know what a byte
 * array means: a hash is a Holochain concept, and the port promises only a diagnostic blob.
 *
 * The launcher did the same with `@spartan-hc/holo-hash`. That library also recomputes and checks
 * each hash's DHT location, which matters when constructing a hash and not when displaying one the
 * conductor already produced, so a prefix match is enough here and costs no dependency.
 */

/**
 * The middle byte of each Holochain hash type's three-byte prefix, `[0x84, type, 0x24]`.
 *
 * Holochain's own table (`holo_hash::hash_type::primitive`). Matching on the type byte as well as
 * the two constant ends is what separates a hash from any other 39-number array the metrics might
 * one day carry.
 */
const HASH_TYPES = new Set([
  0x20, // agent
  0x21, // entry
  0x22, // network id
  0x24, // DHT op
  0x29, // action
  0x2a, // wasm
  0x2c, // warrant
  0x2d, // DNA
  0x2f, // external
]);

/** Prefix, 32-byte core, 4-byte DHT location. */
const HASH_LENGTH = 39;

function isHashBytes(value: unknown[]): value is number[] {
  if (value.length !== HASH_LENGTH) return false;
  if (!value.every((byte) => Number.isInteger(byte) && (byte as number) >= 0 && (byte as number) <= 255)) return false;
  return value[0] === 0x84 && value[2] === 0x24 && HASH_TYPES.has(value[1] as number);
}

/** A hash's canonical string form: multibase `u`, then unpadded base64url — what `holochain/client` writes. */
function encodeHash(bytes: number[]): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return `u${base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

function decodeHashes(value: unknown): unknown {
  if (Array.isArray(value)) return isHashBytes(value) ? encodeHash(value) : value.map(decodeHashes);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, decodeHashes(inner)]));
  }
  return value;
}

/**
 * Indented JSON, with any array of plain numbers kept on one line.
 *
 * `JSON.stringify(value, null, 2)` puts every element of an array on a line of its own, so a byte
 * array that is not a hash — a key, a bitfield — becomes a column of numbers taller than the screen.
 * The launcher kept those arrays inline, and folding in the viewer is for the structure, not for them.
 */
function render(value: unknown, indent: string): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((item) => typeof item === 'number')) return `[${value.join(', ')}]`;
    return `[\n${value.map((item) => inner + render(item, inner)).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const lines = entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${render(item, inner)}`);
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The executor's metrics JSON, indented and with hashes as strings.
 *
 * Text that does not parse is returned unchanged: an executor that answered with an error message,
 * or with a format this does not know, is still worth showing exactly as it came.
 */
export function formatNetworkMetrics(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  return render(decodeHashes(parsed), '');
}
