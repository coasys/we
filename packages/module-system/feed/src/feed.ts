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
import { lineContent, repliesInclude, SPOKEN, threadLines } from '@we/messages';
import type { RecordQuery } from '@we/module-shared';

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
  /** The same moment as `at`, and when it was last edited — the names `messageLine` reads. */
  createdAt: string;
  updatedAt: string;
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
  /**
   * Whether a call's spoken lines are in the window — this reader's setting. Off, they are dropped
   * as they are read rather than after the cut: the window is filled with the rows it will draw, so
   * a call that spoke more lines than it holds does not leave it looking empty and unable to page.
   */
  spoken?: boolean;
  /** The kinds of record an activity row can be about. Empty draws messages only. */
  activityTypes: string[];
  /** Records still awaiting a decision, by id. */
  pending?: ReadonlySet<string>;
  /**
   * Whether the answer is no longer wanted — the window moved, or nobody is looking. Asked before
   * each further step, so a read nobody will draw stops instead of running its call pages against
   * the executor alongside the read that replaced it. A stopped read rejects with
   * {@link FeedReadStopped}.
   */
  stopped?: () => boolean;
  /**
   * The person an author speaks for (`ModuleIdentity.person`), so what one person made from two
   * computers is one activity row rather than two. Each author is their own person without it.
   */
  personOf?: (author: string) => string;
}

/** What {@link readFeedWindow} rejects with when `stopped` says its answer is no longer wanted. */
export class FeedReadStopped extends Error {
  constructor() {
    super('the feed read was stopped');
    this.name = 'FeedReadStopped';
  }
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
    createdAt: iso(row),
    updatedAt: text(row.updatedAt),
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
  personOf: (author: string) => string = (author) => author,
): FeedActivity[] {
  const sorted = [...records].sort((a, b) => timeOf(a.row) - timeOf(b.row));
  const groups: { key: string; last: number; rows: { row: Row; entity: string }[] }[] = [];
  for (const record of sorted) {
    const origin = idOf(record.row.extractedFrom);
    const key = origin ? `from:${origin}` : `by:${personOf(text(record.row.author))}`;
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
 * The same rows with each activity item marked by whether it is still a suggestion — so the
 * suggestions settling re-marks what is on screen rather than reading the window again. A row whose
 * marks did not move is returned as it was, and so is the list when none did, so nothing redraws.
 */
export function markPending(rows: FeedRow[], pending: ReadonlySet<string>): FeedRow[] {
  let moved = false;
  const marked = rows.map((row) => {
    if (row.kind !== 'activity' || row.items.every((item) => item.pending === pending.has(item.id))) return row;
    moved = true;
    const items = row.items.map((item) => ({ ...item, pending: pending.has(item.id) }));
    return { ...row, items, suggested: items.filter((item) => item.pending).length };
  });
  return moved ? marked : rows;
}

/**
 * One window of the Feed: the rows to draw, in the order the window grows (newest first from the
 * live end, oldest first from the start), and whether there is more beyond it.
 */
export async function readFeedWindow(
  find: FeedFind,
  options: FeedWindowOptions,
): Promise<{ rows: FeedRow[]; hasMore: boolean; parts?: FeedWindowParts }> {
  const { root, shown, fromStart } = options;
  if (!root) return { rows: [], hasMore: false };
  const order: 'asc' | 'desc' = fromStart ? 'asc' : 'desc';
  const page = (within: string): RecordQuery => ({
    within,
    order: { createdAt: order },
    limit: shown,
    include: repliesInclude(),
  });

  const [loose, calls, ...extracted] = await Promise.all([
    find('TextBlock', page(root)),
    /*
      The calls in the space collection itself — a call about nothing. A call held about something
      is a response to it and a child of nothing, so it is not here: it belongs with what it is
      about. Drawing those too means reading every call in the space and choosing by context, which
      is a decision about what the Feed is for rather than a query to widen.
    */
    find('CollectionBlock', {
      within: root,
      where: { kind: 'call' },
      order: { createdAt: order },
      limit: CALL_WINDOW,
    }),
    /*
      What extraction found, per kind. No `include`: a row carries `extractedFrom` as the source's
      id unasked, which is all an activity row reads — its title comes from `calls` above. Including
      it hydrated the source into every row, and the source is usually a call holding every line said
      in it: about 18 KB a row, near a megabyte a page, re-read on every refresh.
    */
    ...options.activityTypes.map((entity) =>
      find(entity, { within: root, order: { createdAt: order }, limit: shown })
        .then((rows) => rows.map((row) => ({ row, entity })))
        /*
          One kind that cannot be read drops only its own rows. A class the space lists as an
          extraction target can be one this client cannot resolve, and the finds all landing in the
          same Promise.all used to make one bad class the whole read: the window drew nothing at
          all. The message and call finds above still fail the read — a Feed without its lines is
          wrong in a way a missing activity row is not.
        */
        .catch((error: unknown) => {
          console.warn(`[feed] could not read ${entity}`, error);
          return [];
        }),
    ),
  ]);

  const stop = () => {
    if (options.stopped?.()) throw new FeedReadStopped();
  };
  stop();
  const titles = new Map<string, string>(calls.map((call) => [text(call.id), text(call.title) || 'A call']));
  titles.set(root, 'the space');

  // A source that filled its page may hold more than it answered with.
  let filled = loose.length >= shown;
  /*
    A spoken line this reader keeps hidden goes here, before the cut — only what the window can
    draw counts toward filling it (and toward a later call being out of reach). A reply stays: its
    `typed` or empty source is not `spoken`, and its quote was resolved from the spoken parent on
    the page just now.
  */
  const drawn = (row: FeedLine) => options.spoken !== false || row.source !== SPOKEN;
  let lines: FeedLine[] = threadLines({ rows: loose, newestFirst: !fromStart })
    .map((row) => toLine(row, '', ''))
    .filter(drawn);
  let reachedCalls = 0;
  for (const call of calls) {
    const sorted = [...lines].sort((a, b) => (fromStart ? timeOf(a) - timeOf(b) : timeOf(b) - timeOf(a)));
    if (sorted.length >= shown) {
      const edge = timeOf(sorted[shown - 1]);
      const began = timeOf(call);
      // Nothing this call said can reach into a full window — see "When to stop reading calls".
      const outOfReach = fromStart ? began > edge : began + MAX_CALL_SPAN_MS < edge;
      if (outOfReach) break;
    }
    reachedCalls += 1;
    const callId = text(call.id);
    stop();
    const said = await find('TextBlock', page(callId));
    if (said.length >= shown) filled = true;
    lines = lines.concat(
      threadLines({ rows: said, newestFirst: !fromStart })
        .map((row) => toLine(row, callId, titles.get(callId) ?? ''))
        .filter(drawn),
    );
  }

  const parts: FeedWindowParts = {
    lines,
    records: extracted.flat(),
    titles,
    shown,
    fromStart: !!fromStart,
    more: filled || reachedCalls < calls.length || calls.length >= CALL_WINDOW,
  };
  return { ...arrangeFeedWindow(parts, options.pending, options.personOf), parts };
}

/**
 * What one read of the window found, before it was grouped and cut to size — kept so the window can
 * be arranged again (a person arriving for two devices' records) without asking the backend again.
 */
export interface FeedWindowParts {
  lines: FeedLine[];
  /** The extracted and hand-made records, ungrouped. */
  records: { row: Row; entity: string }[];
  titles: ReadonlyMap<string, string>;
  shown: number;
  fromStart: boolean;
  /** A source held more than the read took, whatever the arrangement. */
  more: boolean;
}

/** The rows a read's parts draw as: activity grouped, merged with the lines, in window order, cut to `shown`. */
export function arrangeFeedWindow(
  parts: FeedWindowParts,
  pending?: ReadonlySet<string>,
  personOf?: (author: string) => string,
): { rows: FeedRow[]; hasMore: boolean } {
  const { lines, records, titles, shown, fromStart } = parts;
  const before = (a: number, b: number) => (fromStart ? a < b : a > b);
  const activity = groupActivity(records, titles, pending, personOf);
  const merged: FeedRow[] = [...lines, ...activity].sort((a, b) => (before(timeOf(a), timeOf(b)) ? -1 : 1));
  return { rows: merged.slice(0, shown), hasMore: merged.length > shown || parts.more };
}
