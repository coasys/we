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

import type { DatasetTarget, RecordsKernel } from '@we/module-shared';

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

/** The record reads and writes {@link mendLine} uses: `find` and `update` of a records kernel. */
export interface LineRecords {
  update: RecordsKernel['update'];
  find?: RecordsKernel['find'];
}

/**
 * Write new words onto a line, bare or composition.
 *
 * - A message composition holds its words two times: in its first `TextBlock` and in its own
 *   `textContent`, which readers draw first. This changes both.
 * - A bare line is its own `TextBlock`, so this changes its `text`.
 * - `source` goes with the words, when the edit changes how the line arrived (see `sourceAfterEdit`).
 *
 * The line is a composition when a `CollectionBlock` with a message kind has its id. When `find` is
 * not there, the line is written as a bare line.
 */
export async function mendLine(
  records: LineRecords,
  id: string,
  words: string,
  source: string | undefined,
  target?: DatasetTarget,
): Promise<void> {
  const marked = source ? { source } : {};
  // The target only when there is one, so a caller that gives none makes the same calls as before.
  const at: [] | [DatasetTarget] = target ? [target] : [];
  const [message] =
    (await records.find?.('CollectionBlock', { where: { id, kind: MESSAGE_KINDS }, limit: 1 }, ...at)) ?? [];
  if (!message) {
    await records.update('TextBlock', id, { text: words, ...marked }, ...at);
    return;
  }
  const [part] =
    (await records.find?.(
      'TextBlock',
      { within: id, order: { createdAt: 'asc' }, limit: 1, select: ['text'] },
      ...at,
    )) ?? [];
  if (typeof part?.id === 'string' && part.id)
    await records.update('TextBlock', part.id, { text: words, ...marked }, ...at);
  await records.update('CollectionBlock', id, { textContent: words, ...marked }, ...at);
}
