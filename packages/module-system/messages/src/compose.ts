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
export function messageBlocks(
  text: string,
  marks?: unknown,
  source?: string,
  files: readonly AttachedFile[] = [],
): ContentBlock[] {
  const words = String(text ?? '');
  const ownMarks = marksOf(marks);
  const said: ContentBlock[] =
    source === SPOKEN || source === CORRECTED
      ? [{ _type: 'block', text: words, ...(ownMarks.length ? { marks: ownMarks } : {}) }]
      : words
        ? markdownToBlocks(words, ownMarks)
        : [];
  if (!files.length) return said;
  /*
    The files go in one group after the words: a collection of kind `attachments`, a `FileBlock` each.
    A group rather than loose blocks beside the text, so the files are one thing a reader can act on
    (draw as a set, comment on, reuse) and each is still a record of its own. The bytes are uploaded
    to the dataset's file storage as the message is written, in the same write.
  */
  return [
    ...said,
    {
      _type: 'collection',
      kind: ATTACHMENTS_KIND,
      content: files.map((file) => ({
        _type: 'file',
        name: file.data.name,
        mimeType: file.data.file_type,
        size: file.size,
        url: file.data,
      })),
    },
  ];
}

/** The kind of the group a message's files are in. */
export const ATTACHMENTS_KIND = 'attachments';

/** A file attached to a message: its bytes as the file-storage language takes them, and its size. */
export interface AttachedFile {
  data: { data_base64: string; name: string; file_type: string };
  size: number;
}

/** A browser file as a message carries it — see `AttachedFile`. */
export async function attachedFile(file: Blob & { name: string }): Promise<AttachedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // In slices: one `fromCharCode` over a large file overflows the call stack.
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return {
    data: { data_base64: btoa(binary), name: file.name, file_type: file.type || 'application/octet-stream' },
    size: file.size,
  };
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
