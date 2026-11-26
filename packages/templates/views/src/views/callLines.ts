/**
 * The lines of a call, as the views that read a call's transcript ask for them.
 *
 * A line has two shapes:
 *
 * - A heard line is a bare `TextBlock` under the call, as transcription writes it.
 * - A message typed into the call chat is a composition: a `CollectionBlock` with `kind: 'message'`
 *   (or `'reply'`) under the call. Its words are in `textContent`. Its own `TextBlock` is under the
 *   message, not under the call, so a query for the call's children does not read it.
 *
 * So a reader asks for both entities in one query ({@link CALL_LINE_ENTITIES}), with one order and one
 * limit, and keeps the rows that are lines ({@link callLines}). The query cannot filter `kind` itself:
 * in a union the same `where` goes to each entity, and `kind` would remove every `TextBlock`.
 *
 * `'message'` and `'reply'` are spelled here rather than imported from `@we/messages`, because
 * `templates → modules` is a sideways edge. See `docs/architecture/transcripts.md`.
 */

/** The two entities a line of a call can be. */
export const CALL_LINE_ENTITIES = ['TextBlock', 'CollectionBlock'];

/**
 * An expression: the rows of `rows` that are lines — each `TextBlock`, and each `CollectionBlock`
 * that is a message composition. A `CollectionBlock` of another kind is not a line.
 */
export const callLines = (rows: string): string =>
  `${rows}.filter(r, r.__subjectClass != 'CollectionBlock' || r.kind in ['message', 'reply'])`;

/** An expression: the words of a line `row` — `text` on a bare line, `textContent` on a message. */
export const lineWords = (row: string): string => `${row}.text ?? ${row}.textContent`;
