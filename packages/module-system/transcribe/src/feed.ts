/**
 * The Feed: every message in a space — every call's lines, what was typed outside any call, bot
 * replies — as one stream, with a row for what extraction found as it is found.
 *
 * ## Merged by call, not one sorted query
 *
 * A single "every message, newest first" query would touch every message the space has ever held
 * on every page and on every burst of a live call, because the store has no top-N and no index on
 * time. Calls are natural chunks of it and each already pages cheaply, so a page here is: the space's
 * calls in time order, the newest page of each call that can reach into the window, and the loose
 * messages — merged by time. Each page costs a few call pages and a small top-level read, however
 * many calls there have been.
 *
 * ## When to stop reading calls
 *
 * From the start it is exact: a call's lines all come after it began, so once the window is full and
 * the next call began after the last row in it, nothing later can reach in. From the live end it needs
 * a bound on how long a call runs, because a call that began long ago may still be talking —
 * {@link MAX_CALL_SPAN_MS}. A call longer than that has its later lines found only once the window
 * reaches back to where it began.
 *
 * ## Activity rows
 *
 * What extraction found is drawn among the messages as it arrives, grouped: one row per conversation
 * and pass — "3 tasks and 1 event, from Monday sync" — rather than one per record. The record is the
 * event (its `createdAt`, its author), and `extractedFrom` is where it came from; nothing extra is
 * written. Records nobody extracted are grouped by author the same way: "Ann added a task".
 */
import type { RecordQuery } from '@we/module-shared';

import { lineContent, repliesInclude, threadLines } from './thread';

type Row = Record<string, unknown>;

/** How long a call is assumed to run at most, for reading back from the live end. See above. */
export const MAX_CALL_SPAN_MS = 12 * 60 * 60 * 1000;

/** How many of the space's calls one page may look through. */
export const CALL_WINDOW = 100;

/** Records made within this long of each other, from one source, are one activity row. */
export const ACTIVITY_GROUP_MS = 60 * 1000;

/** The first page, and the step each further one adds. */
export const FEED_FIRST_PAGE = 50;
export const FEED_PAGE = 100;

/** One message, as the Feed draws it. */
export interface FeedLine {
  kind: 'line';
  id: string;
  at: string;
  author: string;
  text: string;
  marks: string;
  /** `spoken`, `typed`, `corrected`, or `''` — which, for a line WE did not write, is a bot's. */
  source: string;
  /** The call it was said in, or `''` for a message typed straight into the space. */
  call: string;
  callTitle: string;
  replyTo: { id: string; author: string; text: string } | null;
  /** The line as one block for a renderer, when it has marks — see `lineContent`. */
  content: Record<string, unknown>[] | null;
}

/** One thing extracted or made, grouped — see the module comment. */
export interface FeedActivity {
  kind: 'activity';
  id: string;
  at: string;
  author: string;
  /** Where the items came from — a call, the space's own messages — or `''` when made by hand. */
  origin: string;
  originTitle: string;
  /** "3 tasks and 1 event". */
  summary: string;
  items: { id: string; entity: string; title: string; pending: boolean }[];
  /** How many are still suggestions nobody has kept. */
  suggested: number;
}

export type FeedRow = FeedLine | FeedActivity;

/** The reads a page needs — the records kernel's `find`, narrowed. */
export type FeedFind = (entity: string, query: RecordQuery) => Promise<Row[]>;

export interface FeedWindowOptions {
  /** The space collection. */
  root: string;
  /** How many rows the window holds. */
  shown: number;
  /** Anchored at the oldest end rather than the newest. */
  fromStart: boolean;
  /** The kinds of record an activity row can be about. Empty draws messages only. */
  activityTypes: string[];
  /** Records still awaiting a decision, by id. */
  pending?: ReadonlySet<string>;
}

const timeOf = (row: Row | FeedRow | undefined): number => {
  const record = row as Row | undefined;
  const value = record?.createdAt ?? record?.at;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
};
const iso = (row: Row): string => new Date(timeOf(row)).toISOString();
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const idOf = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return idOf(value[0]);
  return text((value as { id?: unknown } | null)?.id);
};

/** What one entity's records are called in a sentence: `TaskBlock` → task. */
export function nounFor(entity: string, count: number): string {
  const base =
    entity
      .replace(/Block$/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase() || 'record';
  return count === 1 ? base : `${base}s`;
}

function summarise(items: { entity: string }[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.entity, (counts.get(item.entity) ?? 0) + 1);
  const parts = [...counts].map(([entity, n]) => `${n} ${nounFor(entity, n)}`);
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function toLine(row: Row, call: string, callTitle: string): FeedLine {
  return {
    kind: 'line',
    id: text(row.id),
    at: iso(row),
    author: text(row.author),
    text: text(row.text),
    marks: text(row.marks),
    source: text(row.source),
    call,
    callTitle,
    replyTo: (row.replyTo as FeedLine['replyTo']) ?? null,
    content: lineContent(row),
  };
}

/** Group extracted and hand-made records into activity rows — see the module comment. */
export function groupActivity(
  records: { row: Row; entity: string }[],
  titles: ReadonlyMap<string, string>,
  pending: ReadonlySet<string> = new Set(),
): FeedActivity[] {
  const sorted = [...records].sort((a, b) => timeOf(a.row) - timeOf(b.row));
  const groups: { key: string; last: number; rows: { row: Row; entity: string }[] }[] = [];
  for (const record of sorted) {
    const origin = idOf(record.row.extractedFrom);
    const key = origin ? `from:${origin}` : `by:${text(record.row.author)}`;
    const at = timeOf(record.row);
    const open = groups.find((g) => g.key === key && at - g.last <= ACTIVITY_GROUP_MS);
    if (open) {
      open.rows.push(record);
      open.last = at;
    } else groups.push({ key, last: at, rows: [record] });
  }
  return groups.map(({ rows }) => {
    const first = rows[0].row;
    const origin = idOf(first.extractedFrom);
    const items = rows.map(({ row, entity }) => ({
      id: text(row.id),
      entity,
      title: text(row.title) || text(row.name) || text(row.label) || nounFor(entity, 1),
      pending: pending.has(text(row.id)),
    }));
    return {
      kind: 'activity' as const,
      id: `activity:${items[0].id}`,
      // The newest item's time, so a group reads where its last record landed.
      at: iso(rows[rows.length - 1].row),
      author: text(first.author),
      origin,
      originTitle: origin ? (titles.get(origin) ?? '') : '',
      summary: summarise(items),
      items,
      suggested: items.filter((item) => item.pending).length,
    };
  });
}

/**
 * One window of the Feed: the rows to draw, in the order the window grows (newest first from the
 * live end, oldest first from the start), and whether there is more beyond it.
 */
export async function readFeedWindow(
  find: FeedFind,
  options: FeedWindowOptions,
): Promise<{ rows: FeedRow[]; hasMore: boolean }> {
  const { root, shown, fromStart } = options;
  if (!root) return { rows: [], hasMore: false };
  const order: 'asc' | 'desc' = fromStart ? 'asc' : 'desc';
  const before = (a: number, b: number) => (fromStart ? a < b : a > b);
  const page = (within: string): RecordQuery => ({
    within,
    order: { createdAt: order },
    limit: shown,
    include: repliesInclude(),
  });

  const [loose, calls, ...extracted] = await Promise.all([
    find('TextBlock', page(root)),
    find('CollectionBlock', {
      within: root,
      where: { kind: 'call' },
      order: { createdAt: order },
      limit: CALL_WINDOW,
    }),
    ...options.activityTypes.map((entity) =>
      find(entity, { within: root, order: { createdAt: order }, limit: shown, include: { extractedFrom: true } }).then(
        (rows) => rows.map((row) => ({ row, entity })),
      ),
    ),
  ]);

  const titles = new Map<string, string>(calls.map((call) => [text(call.id), text(call.title) || 'A call']));
  titles.set(root, 'the space');

  // A source that filled its page may hold more than it answered with.
  let filled = loose.length >= shown;
  let lines: FeedLine[] = threadLines({ rows: loose, newestFirst: !fromStart }).map((row) => toLine(row, '', ''));
  let reachedCalls = 0;
  for (const call of calls) {
    const sorted = [...lines].sort((a, b) => (fromStart ? timeOf(a) - timeOf(b) : timeOf(b) - timeOf(a)));
    if (sorted.length >= shown) {
      const edge = timeOf(sorted[shown - 1] as unknown as Row);
      const began = timeOf(call);
      // Nothing this call said can reach into a full window — see "When to stop reading calls".
      const outOfReach = fromStart ? began > edge : began + MAX_CALL_SPAN_MS < edge;
      if (outOfReach) break;
    }
    reachedCalls += 1;
    const callId = text(call.id);
    const said = await find('TextBlock', page(callId));
    if (said.length >= shown) filled = true;
    lines = lines.concat(
      threadLines({ rows: said, newestFirst: !fromStart }).map((row) => toLine(row, callId, titles.get(callId) ?? '')),
    );
  }

  const activity = groupActivity(extracted.flat(), titles, options.pending);
  const merged: FeedRow[] = [...lines, ...activity].sort((a, b) =>
    before(timeOf(a as unknown as Row), timeOf(b as unknown as Row)) ? -1 : 1,
  );
  const hasMore = merged.length > shown || filled || reachedCalls < calls.length || calls.length >= CALL_WINDOW;
  return { rows: merged.slice(0, shown), hasMore };
}
