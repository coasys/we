/**
 * provenance — whether a model made a record, and which run did.
 *
 * One way a record says so: **`generatedBy`**, the run that wrote it. Whoever writes a record on a
 * model's behalf marks it, in the same write — the agent's data tools, the transcriber, a backend
 * running an extraction pass (`run` on the interpretation port) — and `kind` on the run says what
 * kind of writing it was.
 *
 * Lineage is a separate question with its own links: `extractedFrom` says which call a record came
 * out of, and is not read here. A record extracted by hand-review or by a standing watch can come
 * from a call without a run naming it.
 *
 * A surface asks here rather than reading the relation itself, so what counts as "a model made this"
 * is decided once.
 */

/** A relation as a record carries it: an id without an `include`, the record with one. */
type RelationValue = string | { id?: unknown } | null | undefined;

/** How a model made a record: the run that wrote it. */
export type Generated = { by: 'run'; run: string };

function idOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return '';
}

/**
 * How a model made this record, or `undefined` when a person did. Reads the record's own
 * `generatedBy`, as an id or an included record, so it needs no query of its own.
 */
export function generatedRun(record: { generatedBy?: RelationValue }): Generated | undefined {
  const run = idOf(record.generatedBy);
  return run ? { by: 'run', run } : undefined;
}
