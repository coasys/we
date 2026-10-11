/**
 * A conversation's lines with replies inline — how a transcript and the feed draw a conversation.
 *
 * ## A reply is a line too
 *
 * A reply said in a conversation is two things at once: a response to the line it answers
 * (`respondsTo`), and a line of that conversation — the host files it as a child of the feed the
 * answered line lives in. So a page of a call's lines already holds its replies, in the order they
 * were said: a reply to the first line, sent after the third, comes after the third. What a page
 * does not carry is who each reply answers, which is what the quote above it draws — so the page is
 * read with `include: { respondsTo: true }`, and this turns that into `replyTo`.
 *
 * Only the direct parent is quoted: a reply to a reply quotes the reply.
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

/**
 * Every line on a page, once each, in time order — newest first when asked, as a page read from the
 * live end arrives — each reply carrying the quote of what it answers.
 */
export function threadLines(options: { rows?: unknown; newestFirst?: unknown } | undefined): Row[] {
  const rows = Array.isArray(options?.rows) ? (options.rows as Row[]) : [];
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

/** The `include` that brings each line's parent with it, for the quote a reply draws. */
export function repliesInclude(): Record<string, unknown> {
  return { respondsTo: true };
}

export const threadLinesFunction: ModuleFunction = {
  name: 'threadLines',
  params: ['options'],
  doc: 'A page of a conversation’s lines, every one once, in time order — newest first when `newestFirst` is true. A reply said in a conversation is one of its lines, so the page already holds it; each reply carries `replyTo: { id, author, text }`, its direct parent, for the quote drawn above it, and a line with marks carries `content` — the one block a BlockRenderer draws it from. Read the page with `include: { respondsTo: true }` so each reply arrives knowing what it answers. Options: rows (the page), newestFirst (boolean).',
  example: 'threadLines({ rows: local.utterances, newestFirst: !modules.transcribe.transcriptFromStart })',
  fn: threadLines as (...args: never[]) => unknown,
};
