/**
 * A message as a composition: a `CollectionBlock` that holds the words and the files sent with them.
 *
 * ## The shape
 *
 * - The message is a `CollectionBlock` with `kind: 'message'` — or `'reply'`, when it answers a line.
 *   Its `textContent` holds the words, and its `source` says how they got here (`typed`, …).
 * - Its first child is a `TextBlock` with the words, their marks and the same `source`.
 * - When files were sent, its second child is a `CollectionBlock` with `kind: 'attachments'`, and
 *   that group holds one `FileBlock` for each file.
 *
 * Every link is `children` (containment). A message with no files has one child.
 *
 * ## Why the words are also on the message
 *
 * A reader of a conversation reads many lines in one query. With the words on the message, that
 * query is enough to draw the line, quote it in a reply and give it to interpretation. Only the marks
 * and the files need the children, and a reader gets those for its window only.
 *
 * A line can also be a bare `TextBlock`: every line written before messages were compositions, and
 * every line a call hears. Readers accept both. Use {@link lineText} to get the words of either.
 */

type Row = Record<string, unknown>;

/** `kind` of a message composition said into a conversation. */
export const MESSAGE_KIND = 'message';
/** `kind` of a message composition that answers a line. */
export const REPLY_KIND = 'reply';
/** Both kinds of message composition — for `where: { kind: MESSAGE_KINDS }`. */
export const MESSAGE_KINDS: string[] = [MESSAGE_KIND, REPLY_KIND];
/** `kind` of the group of files a message holds, as its second child. */
export const ATTACHMENTS_KIND = 'attachments';

/** Whether a row is a message composition rather than a bare `TextBlock` line. */
export function isMessageComposition(row: Row | null | undefined): boolean {
  return !!row && (row.kind === MESSAGE_KIND || row.kind === REPLY_KIND);
}

/** The words of a line: `text` on a bare `TextBlock`, `textContent` on a message composition. */
export function lineText(row: Row | null | undefined): string {
  if (!row) return '';
  if (typeof row.text === 'string' && row.text) return row.text;
  return isMessageComposition(row) && typeof row.textContent === 'string' ? row.textContent : '';
}
