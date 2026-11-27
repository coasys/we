/**
 * What a `json` property accepts on a write, decided once for every backend.
 *
 * A `json` property holds a structured value — a list, an object, a number or a boolean — and how
 * that is stored is each backend's business. What a caller may hand one is not: the same write
 * must mean the same thing on every backend, or a record written by one host reads differently on
 * another. See `WriteValue` in `recordContract.ts` for the rule in full.
 */

/** A write to a `json` property that cannot be stored as one. */
export class JsonValueError extends Error {
  constructor(field: string, why: string) {
    super(`${field} is a json property: ${why}`);
    this.name = 'JsonValueError';
  }
}

/**
 * The value a write to the `json` property `field` stores: `undefined` for an empty write (`''`,
 * `null` or nothing, which clear it), otherwise a copy of the structured value, so the caller's own
 * object is never the stored one.
 *
 * Text is read as JSON — what a caller holding a serialised value hands over — and refused when it
 * is not JSON. A value that is itself a string is refused too: read back, it could not be told
 * from text that still needs parsing, so the two would come apart between backends.
 */
export function writtenJsonValue(field: string, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  let structured: unknown = value;
  if (typeof value === 'string') {
    try {
      structured = JSON.parse(value) as unknown;
    } catch {
      throw new JsonValueError(field, `"${value.slice(0, 40)}" is not JSON`);
    }
  }
  if (typeof structured === 'string') {
    throw new JsonValueError(field, 'it holds a list, an object, a number or a boolean, not text');
  }
  if (structured === null) return undefined;
  let text: string | undefined;
  try {
    text = JSON.stringify(structured);
  } catch (cause) {
    throw new JsonValueError(field, `the value cannot be written as JSON (${String(cause)})`);
  }
  if (text === undefined) throw new JsonValueError(field, 'the value cannot be written as JSON');
  return JSON.parse(text) as unknown;
}

/**
 * A stored `json` value as it reads: the value, parsed when a backend hands back text, or
 * `undefined` — reported once per `field` — when the text does not parse. Never thrown: one bad
 * value must not take the record it is on out of every list that reads it.
 */
export function readJsonValue(field: string, stored: unknown): unknown {
  if (typeof stored !== 'string') return stored;
  if (stored === '') return undefined;
  try {
    return JSON.parse(stored) as unknown;
  } catch {
    if (!reportedUnparsable.has(field)) {
      reportedUnparsable.add(field);
      console.warn(`${field} holds text that is not JSON, and reads as absent until it is written again`);
    }
    return undefined;
  }
}

const reportedUnparsable = new Set<string>();
