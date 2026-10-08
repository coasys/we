/**
 * Lines and the replies under them, as one list in time order — how a transcript and the feed draw a
 * conversation with replies inline.
 *
 * ## Why replies need flattening at all
 *
 * A reply is linked from what it answers (`we://comment`), not contained by the conversation, and
 * that is deliberate: one reply mechanism across WE, kept apart from a node's own parts. So a page of
 * a call's lines arrives with each line's replies nested under it (`include: { comments: … }`), and a
 * chat reads them in the order they were said — a reply to the first line, sent after the third,
 * belongs after the third, quoting the first.
 *
 * Each reply carries `replyTo` — who and what it answers — for the quote drawn above it. Only its
 * direct parent: a reply to a reply quotes the reply.
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

/**
 * Every line and every reply under it, once each, in time order — newest first when asked, as a page
 * read from the live end arrives.
 */
export function threadLines(options: { rows?: unknown; newestFirst?: unknown } | undefined): Row[] {
  const rows = Array.isArray(options?.rows) ? (options.rows as Row[]) : [];
  const seen = new Set<string>();
  const out: Row[] = [];
  const walk = (row: Row, parent: Row | null) => {
    const id = typeof row?.id === 'string' ? row.id : '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    const replyTo: ReplyQuote | null = parent
      ? {
          id: String(parent.id),
          author: typeof parent.author === 'string' ? parent.author : '',
          text: typeof parent.text === 'string' ? parent.text : '',
        }
      : null;
    const content = lineContent(row);
    out.push({ ...row, ...(replyTo ? { replyTo } : {}), ...(content ? { content } : {}) });
    for (const reply of Array.isArray(row.comments) ? row.comments : []) {
      if (reply && typeof reply === 'object') walk(reply as Row, row);
    }
  };
  for (const row of rows) walk(row, null);
  const newestFirst = options?.newestFirst === true;
  return out.sort((a, b) => (newestFirst ? timeOf(b) - timeOf(a) : timeOf(a) - timeOf(b)));
}

/** How deep a page's read follows replies — a reply, a reply to it, and one more. */
export const REPLY_DEPTH = 3;

/** The `include` that brings a line's replies with it, {@link REPLY_DEPTH} levels down. */
export function repliesInclude(depth = REPLY_DEPTH): Record<string, unknown> {
  return { comments: depth <= 1 ? true : { include: repliesInclude(depth - 1) } };
}

export const threadLinesFunction: ModuleFunction = {
  name: 'threadLines',
  params: ['options'],
  doc: 'A page of lines with the replies under each flattened in, every one once, in time order — newest first when `newestFirst` is true. Each reply carries `replyTo: { id, author, text }`, its direct parent, for the quote drawn above it, and a line with marks carries `content` — the one block a BlockRenderer draws it from. Read the page with `include: { comments: { include: { comments: { include: { comments: true } } } } }` so the replies arrive with it. Options: rows (the page), newestFirst (boolean).',
  example: 'threadLines({ rows: local.utterances, newestFirst: !modules.transcribe.transcriptFromStart })',
  fn: threadLines as (...args: never[]) => unknown,
};
