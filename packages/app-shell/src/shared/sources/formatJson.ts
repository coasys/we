/**
 * JSON as a document rather than as a string.
 *
 * ## Why the host lends this
 *
 * An extraction pass stores what the model was asked and what it answered, verbatim, and both
 * arrive as one unbroken line. Rendered that way a prompt is a single enormous escaped string:
 * unreadable at any width, and it turns whatever box it is put in into a one-line trough with a
 * horizontal scrollbar. Indenting is the whole difference between a document somebody can read and
 * a string they cannot.
 *
 * A schema cannot do it. The expression library is closed by design and has no `JSON.stringify`,
 * and the routing table sends computation the library lacks to a function the host registers rather
 * than to a new operator. The alternatives were both worse: storing the indentation would put
 * whitespace into a field that already replicates to every member of a space, and teaching
 * `CodeEditor` to silently reformat its own content would be a hidden behaviour the next caller
 * would have to discover.
 *
 * The live extraction feed does exactly this in `InterpretationStore`, on the same two fields,
 * because a store *can* call `JSON.stringify`. That copy is why this is not a speculative
 * extraction: the need is already demonstrated one layer down, and the durable log reads the same
 * two fields through a query, where no store is in the way.
 *
 * ## Left alone when it will not parse
 *
 * Deliberately, and it is the case worth keeping rather than swallowing: a model that returned prose,
 * or JSON wrapped in a code fence, is exactly the failure somebody opens this pane to diagnose.
 * Showing the raw text answers their question; showing nothing, or a parse error, does not.
 *
 * Total, like every function an expression can call — anything that is not a string answers with the
 * empty string rather than throwing.
 */
export function formatJson(options: unknown): string {
  const text = (options as { text?: unknown } | undefined)?.text;
  if (typeof text !== 'string' || !text) return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
