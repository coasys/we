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
import type { ModuleFunction } from '@we/module-shared';

/** What a reply's quote needs of the line it answers. */
export interface ReplyQuote {
  id: string;
  author: string;
  text: string;
}

type Row = Record<string, unknown>;

/**
 * A line with marks, as the one block a renderer draws it from — `[{ _type: 'block', text, marks }]`
 * — or `null` for plain text, which is most lines and is drawn as text. Marks are stored as JSON on
 * the record; one that does not parse is drawn as plain text rather than not at all.
 */
export function lineContent(row: Row): Row[] | null {
  const stored = row.marks;
  if (typeof stored !== 'string' || !stored || stored === '[]') return null;
  try {
    const marks: unknown = JSON.parse(stored);
    if (!Array.isArray(marks) || !marks.length) return null;
    return [{ _type: 'block', text: typeof row.text === 'string' ? row.text : '', marks }];
  } catch {
    return null;
  }
}

const timeOf = (row: Row): number => {
  const value = row.createdAt;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
};

/** Who and what a reply answers, from its included parent — or from the page, where the parent is a bare id on it. */
function quoteOf(row: Row, byId: Map<string, Row>): ReplyQuote | null {
  const parent = Array.isArray(row.respondsTo) ? row.respondsTo[0] : row.respondsTo;
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
  fn: threadLines as (...args: never[]) => unknown,
};
