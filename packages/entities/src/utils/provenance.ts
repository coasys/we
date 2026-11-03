/**
 * provenance — whether a model made a record, and which run did.
 *
 * Two ways a record says so, and this is the one place that knows both:
 *
 * - **`generatedBy`**: the run that wrote it. What WE's own writers mark: a reply in the editor's
 *   chat, a record an agent's data tools created.
 * - **`extractedFrom`**: the call an extraction pass made it from. An extraction pass is run where
 *   the records are written, and the client never learns which records a pass made, only what it
 *   made *or updated*. So those records are marked by the call's `extracted` link instead, and the
 *   run is whichever of the call's runs made it, which no record says.
 *
 * A surface asks here rather than reading either relation itself, so a third way (a backend that
 * marks what its own agents create) is added once.
 */

/** A relation as a record carries it: an id without an `include`, the record with one. */
type RelationValue = string | { id?: unknown } | null | undefined;

/** How a model made a record. */
export type Generated =
  /** A run wrote it, and this is the run. */
  | { by: 'run'; run: string }
  /** An extraction pass made it from this call; which of the call's runs is not recorded. */
  | { by: 'extraction'; from: string };

function idOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return '';
}

/**
 * How a model made this record, or `undefined` when a person did. Reads the record's own
 * `generatedBy` and `extractedFrom`, as ids or included records, so it needs no query of its own.
 */
export function generatedRun(record: {
  generatedBy?: RelationValue;
  extractedFrom?: RelationValue;
}): Generated | undefined {
  const run = idOf(record.generatedBy);
  if (run) return { by: 'run', run };
  const from = idOf(record.extractedFrom);
  if (from) return { by: 'extraction', from };
  return undefined;
}
