/**
 * Writing a message: the blocks a line is made of, and correcting one.
 *
 * A line is a composition — a collection holding its blocks, written through the host's documents
 * (`RecordsKernel.documents`) exactly as a post is — so both modules that write lines build its
 * blocks here, and the difference between a typed line and a heard one lives in one place.
 */
import { type ContentBlock, markdownToBlocks, marksOf } from '@we/block-shared';
import type { CreateDocumentOptions, DatasetTarget, RecordsKernel } from '@we/module-shared';

import { CORRECTED, sourceAfterEdit, SPOKEN } from './source.ts';

/**
 * The blocks a line is made of. Typed words are markdown, parsed now — headings, lists, code — the
 * way an agent's `write_post` parses them, so a reader draws the blocks as stored. Heard words are
 * one block of what was said: a recogniser writes no markdown.
 */
export function messageBlocks(text: string, marks?: unknown, source?: string): ContentBlock[] {
  const words = String(text ?? '');
  const ownMarks = marksOf(marks);
  if (source === SPOKEN || source === CORRECTED) {
    return [{ _type: 'block', text: words, ...(ownMarks.length ? { marks: ownMarks } : {}) }];
  }
  return markdownToBlocks(words, ownMarks);
}

/** Where a line goes: in a collection (a call, a channel, the space), or answering another line. */
export type LinePlace = { container: string } | { respondsTo: string };

/**
 * How a line is written as a document: a message in a collection, a reply answering a line, how it
 * arrived, and no stored copy of itself — a line is read with its parts.
 */
export function lineDocumentOptions(
  place: LinePlace,
  source: string,
  extra: Omit<CreateDocumentOptions, 'kind' | 'container' | 'respondsTo' | 'fields' | 'storeDocument'> = {},
): CreateDocumentOptions {
  return {
    ...extra,
    ...('respondsTo' in place
      ? { kind: 'reply', respondsTo: place.respondsTo }
      : { kind: 'message', container: place.container }),
    fields: source ? { source } : {},
    storeDocument: false,
  };
}

/**
 * Correct the words of a line. A message gets its blocks again from the corrected words, and a heard
 * one is marked `corrected` (see `sourceAfterEdit`); a bare text block — a line from before lines
 * were messages, or from a writer that knows nothing of them — has its text set, as it always had.
 */
export async function correctLine(
  records: Pick<RecordsKernel, 'find' | 'update' | 'documents'>,
  id: string,
  text: string,
  was?: string,
  target?: DatasetTarget,
): Promise<void> {
  const words = String(text ?? '').trim();
  if (!id || !words) return;
  const source = sourceAfterEdit(was);
  const [message] = await records.find('CollectionBlock', { where: { id }, select: ['id'], limit: 1 }, target);
  if (!message) {
    await records.update('TextBlock', id, { text: words, ...(source ? { source } : {}) }, target);
    return;
  }
  await records.documents.update(id, messageBlocks(words, undefined, source ?? was), target);
  if (source) await records.update('CollectionBlock', id, { source }, target);
}
