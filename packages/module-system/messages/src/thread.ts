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
import { isTextBlock, markdownToBlocks, marksOf, withFoundLinks } from '@we/block-shared';
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
  const text = typeof row.text === 'string' ? row.text : '';
  if (!text) return null;
  const marks = marksOf(row.marks);
  if (row.source === SPOKEN || row.source === CORRECTED)
    return [{ _type: 'block', text, marks: withFoundLinks(text, marks) }];
  return markdownToBlocks(text, marks).map((block) =>
    isTextBlock(block) ? { ...block, marks: withFoundLinks(block.text, block.marks ?? []) } : block,
  );
}

const timeOf = (row: Row): number => {
  const value = row.createdAt;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
};

/** Who and what a reply answers, from its included parent — or from the page, where the parent is a bare id on it. */
function quoteOf(row: Row, byId: Map<string, Row>): ReplyQuote | null {
  const parent: unknown = Array.isArray(row.respondsTo) ? row.respondsTo[0] : row.respondsTo;
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
    text: typeof found!.text === 'string' ? found!.text : '',
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
      ...(replyTo ? { replyTo } : {}),
      ...(content ? { content } : {}),
    });
  }
  const newestFirst = options?.newestFirst === true;
  return out.sort((a, b) => (newestFirst ? timeOf(b) - timeOf(a) : timeOf(a) - timeOf(b)));
}

/** The `include` that brings each line's replies with it — its whole thread, at any depth. */
export function repliesInclude(): Record<string, unknown> {
  return { thread: true };
}

export const threadLinesFunction: ModuleFunction = {
  name: 'threadLines',
  params: ['options'],
  doc: 'A page of a conversation’s lines with every reply to them, each once, in time order — newest first when `newestFirst` is true. A reply is a child of nothing: it is in the `thread` of the line it answers, so read the page with `include: { thread: true }` and this flattens each line’s thread in beside it, leaving out any call held about a line. Each reply carries `replyTo: { id, author, text }`, its direct parent, for the quote drawn above it, and a line with marks carries `content` — the one block a BlockRenderer draws it from. Options: rows (the page), newestFirst (boolean).',
  example: 'threadLines({ rows: local.utterances, newestFirst: !modules.transcribe.transcriptFromStart })',
  fn: threadLines,
};
