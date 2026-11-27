/**
 * A conversation's lines with replies inline — how a transcript and the feed draw a conversation.
 *
 * ## Where the replies come from
 *
 * A conversation's children are what was said in it at the top level; a reply is a child of nothing.
 * It answers a line (`respondsTo`), and it is in the `thread` of the first line above it that is not
 * itself a reply. So a page of a call's lines is read with `include: { thread: true }`, and this
 * flattens each line's thread in beside it — every reply to that line, at any depth — and sorts the
 * lot by when it was said: a reply to the first line, sent after the third, comes after the third.
 *
 * What a reply answers arrives as an id on it, and its parent is always on the page — the line whose
 * thread it came in, or another reply in that thread — so the quote above it is looked up there.
 * Only the direct parent is quoted: a reply to a reply quotes the reply.
 *
 * A thread holds every response, and a call held about a line is one; it is a conversation of its
 * own, not a line of this one, so it is left out.
 */
import { isTextBlock, markdownToBlocks, marksOf, rowsToBlocks, withFoundLinks } from '@we/block-shared';
import type { ModuleFunction } from '@we/module-shared';

import { CORRECTED, SPOKEN } from './source.ts';

/** What a reply's quote needs of the line it answers. */
export interface ReplyQuote {
  id: string;
  author: string;
  text: string;
}

type Row = Record<string, unknown>;

/**
 * A line as the blocks a renderer draws it from — `[{ _type: 'block', text, marks }]` — or `null`
 * for a line with no words. A typed line is as many blocks as its markdown makes: headings, list
 * items, code (`markdownToBlocks`).
 *
 * ## Every line, not only a marked one
 *
 * This used to answer `null` for a line without marks, which was drawn as plain text instead. That
 * looked like the cheap path and was a second look: plain text folds a line break into a space, so a
 * bot's message with paragraphs and a list read as one block of prose — while the same bot's next
 * message, which happened to mention somebody and so carried a mark, kept every break. One path now.
 *
 * ## Markdown, unless it was said
 *
 * A typed line — a person's or a bot's — is read as markdown, with no flag saying so, as chat apps
 * read every message. What bots write already is markdown in all but name: `- ` lists, numbered
 * steps, blank lines between paragraphs; drawn as plain text those were a column of hyphens. Reading
 * prose as markdown misreads very little: emphasis needs a pair (`*a*`), a heading or a quote a line
 * that starts with `# ` or `> `, and `share_links_mutex` stays a word. Backticks are the way out.
 *
 * A line that was spoken, or spoken and corrected, is drawn as said: a recogniser writes no markdown,
 * and a transcript shows the words, not what a stray symbol in them might mean.
 *
 * The writer's own marks — a bot's mentions, the composer's bold and links — come through the parse
 * on the words they were over (see `markdownToBlocks`).
 *
 * ## URLs nobody marked
 *
 * A line drawn here is linked where its writer left a URL bare (`withFoundLinks`). A bot writing
 * through its own tools never passes through WE's composer, so nothing marked its links. Drawn,
 * never written back: what the writer marked always wins.
 *
 * ## Fresh every time, and that is fine
 *
 * The Feed reads its window again as lines arrive, and the transcript reruns `threadLines` on every
 * change, so this answers a new array for an unchanged line each time. Nothing is redrawn for it: a
 * `$each` keeps a list's rows by id and writes a changed row into the one already drawn, field by
 * field, so content equal to what is on screen never reaches the renderer. The browser harness's
 * `perfFeedLines` case holds that — a message arriving draws the new line and nothing else.
 *
 * Anything in a record's marks that is not a mark is left out (`marksOf`), so a line holding a bad
 * mark is still drawn, as if that mark were not there.
 */
export function lineContent(row: Row): Row[] | null {
  const parts = partsOf(row);
  if (parts.length) {
    /*
      A message: its parts, drawn as they were stored. A typed message was parsed into blocks when
      it was written (headings, lists, code), and a spoken one is one block of what was said, so
      neither is parsed again here — parsing what is already blocks would read a literal `*` in a
      heading as emphasis. Its files come too, in the group they were attached in.
    */
    // The files are drawn as the line's attachments (`attachmentsOf`), not as blocks.
    const blocks = rowsToBlocks(parts.filter((part) => !isAttachments(part))).map((block) =>
      isTextBlock(block) ? { ...block, marks: withFoundLinks(block.text, block.marks ?? []) } : block,
    );
    return blocks.length ? blocks : null;
  }
  // A line with no parts on hand: a bare text block (a line written before messages were
  // compositions, or by a writer that knows nothing of them), or a message read without its parts.
  const text = lineText(row);
  if (!text) return null;
  const marks = marksOf(row.marks);
  if (row.source === SPOKEN || row.source === CORRECTED)
    return [{ _type: 'block', text, marks: withFoundLinks(text, marks) }];
  return markdownToBlocks(text, marks).map((block) =>
    isTextBlock(block) ? { ...block, marks: withFoundLinks(block.text, block.marks ?? []) } : block,
  );
}

/**
 * Whether a row is a message — a collection holding its parts — rather than a bare text block. A
 * message carries its words as `textContent`; a bare line as `text`.
 */
export const isMessage = (row: Row): boolean => typeof row.textContent === 'string' && typeof row.text !== 'string';

/** A message's parts as the read handed them back: only the hydrated ones (an id alone draws nothing). */
function partsOf(row: Row): Row[] {
  if (!isMessage(row) || !Array.isArray(row.children)) return [];
  return (row.children as unknown[]).filter((c): c is Row => !!c && typeof c === 'object');
}

/** The group a message's files are in — see `messageBlocks`. */
const isAttachments = (part: Row): boolean => part.kind === 'attachments';

/** A file a line carries, as the line draws it: named and sized, its bytes fetched when saved. */
export interface LineAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** The size as people read it — "2.4 MB". */
  sizeLabel: string;
}

/** A size as people read it. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The files in a message's attachment group, as its read handed them back. */
export function attachmentsOf(row: Row): LineAttachment[] {
  const group = partsOf(row).find(isAttachments);
  const files = Array.isArray(group?.children) ? (group.children as unknown[]) : [];
  return files
    .filter((f): f is Row => !!f && typeof f === 'object' && typeof (f as Row).id === 'string')
    .map((f) => {
      const size = Number(f.size) || 0;
      return {
        id: f.id as string,
        name: typeof f.name === 'string' && f.name ? f.name : typeof f.title === 'string' ? f.title : 'File',
        mimeType: typeof f.mimeType === 'string' ? f.mimeType : '',
        size,
        sizeLabel: sizeLabel(size),
      };
    });
}

/** A line's words: a bare line's `text`, a message's `textContent`. */
export function lineText(row: Row): string {
  if (typeof row.text === 'string') return row.text;
  return typeof row.textContent === 'string' ? row.textContent : '';
}

const timeOf = (row: Row): number => {
  const value = row.createdAt;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
};

/** Who and what a reply answers, from its included parent — or from the page, where the parent is a bare id on it. */
function quoteOf(row: Row, byId: Map<string, Row>): ReplyQuote | null {
  const parent: unknown = row.respondsTo;
  const found: Row | undefined =
    parent && typeof parent === 'object'
      ? (parent as Row)
      : typeof parent === 'string' && parent
        ? (byId.get(parent) ?? { id: parent })
        : undefined;
  const id = found ? (typeof found.id === 'string' ? found.id : '') : '';
  if (!id) return null;
  return {
    id,
    author: typeof found!.author === 'string' ? found!.author : '',
    text: lineText(found!),
  };
}

/** A conversation of its own — a call held about a line — rather than something said in this one. */
const isConversation = (row: Row): boolean => row.mode === 'feed';

/** A page's lines and every reply in their threads, in page order — each line followed by its thread. */
function flatten(page: Row[]): Row[] {
  const out: Row[] = [];
  for (const row of page) {
    if (!row || typeof row !== 'object') continue;
    out.push(row);
    const thread = Array.isArray(row.thread) ? (row.thread as unknown[]) : [];
    for (const member of thread) {
      if (member && typeof member === 'object' && !isConversation(member as Row)) out.push(member as Row);
    }
  }
  return out;
}

/**
 * Every line on a page and every reply in their threads, once each, in time order — newest first
 * when asked, as a page read from the live end arrives — each reply carrying the quote of what it
 * answers.
 */
export function threadLines(options: { rows?: unknown; newestFirst?: unknown } | undefined): Row[] {
  const rows = flatten(Array.isArray(options?.rows) ? (options.rows as Row[]) : []);
  const byId = new Map<string, Row>();
  for (const row of rows) if (typeof row?.id === 'string' && row.id) byId.set(row.id, row);
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const row of rows) {
    const id = typeof row?.id === 'string' ? row.id : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const replyTo = quoteOf(row, byId);
    const content = lineContent(row);
    /*
      The identity fields named, not only spread.

      A spread copies a row's own properties, and a row can be a model instance whose `id` — and,
      depending on the backend, `author` and its timestamps — are getters on its class. A `$query`
      hands the renderer plain objects, so the transcript never noticed; the Feed reads through the
      module host, which hands back instances, and every line it drew had an empty `id`. Nothing
      failed: a reply to one was written under no parent and silently went nowhere.
    */
    out.push({
      ...row,
      id,
      author: row.author,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      // A message's words under the name a bare line has them, so what draws, quotes and edits a
      // line reads one field whichever it is.
      text: lineText(row),
      attachments: attachmentsOf(row),
      ...(replyTo ? { replyTo } : {}),
      ...(content ? { content } : {}),
    });
  }
  const newestFirst = options?.newestFirst === true;
  return out.sort((a, b) => (newestFirst ? timeOf(b) - timeOf(a) : timeOf(a) - timeOf(b)));
}

/**
 * The `include` that brings a message's parts: its blocks, and the files in the group inside it.
 * Both untyped, each member read as the entity it is. A file by what draws it — its name, type and
 * size — never its `url`, which for a stored file is the whole file: a page of lines would read
 * every attachment's bytes on each refresh. They are fetched when somebody saves one.
 */
export function partsInclude(): Record<string, unknown> {
  return { children: { include: { children: { select: ['name', 'title', 'mimeType', 'size'] } } } };
}

/** The `include` that brings each line's replies with it — its whole thread, at any depth — each with its parts. */
export function repliesInclude(): Record<string, unknown> {
  return { thread: { include: partsInclude() } };
}

/** The `include` a page of lines is read with: each line's parts, and its replies with theirs. */
export function lineInclude(): Record<string, unknown> {
  return { ...partsInclude(), ...repliesInclude() };
}

export const threadLinesFunction: ModuleFunction = {
  name: 'threadLines',
  params: ['options'],
  doc: 'A page of a conversation’s lines with every reply to them, each once, in time order — newest first when `newestFirst` is true. A line is a message: a CollectionBlock (kind message, or reply) holding its blocks, the files attached to it in a group among them. A reply is a child of nothing: it is in the `thread` of the line it answers, so read the page with `include: { children: { include: { children: true } }, thread: { include: { children: { include: { children: true } } } } }` and this flattens each line’s thread in beside it, leaving out any call held about a line. Each line carries `text` (its words), `content` (the blocks a BlockRenderer draws it from, files included), and a reply `replyTo: { id, author, text }`, its direct parent, for the quote drawn above it. A bare TextBlock line, from a writer that knows nothing of messages, is drawn the same way from its own text. Options: rows (the page), newestFirst (boolean).',
  example: 'threadLines({ rows: local.utterances, newestFirst: !modules.transcribe.transcriptFromStart })',
  fn: threadLines,
};
