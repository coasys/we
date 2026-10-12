/**
 * The Feed's window: every call's lines and the loose messages merged by time, the replies drawn
 * inline, and what extraction found grouped into rows.
 *
 * The failures here are quiet: two calls that overlapped drawn one after the other rather than
 * interleaved, a page that stops at the end of one call when the next holds older lines, a reply
 * shown out of the order it was said in. Each looks like a feed with less in it.
 */
import type { RecordQuery } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import { groupActivity, nounFor, readFeedWindow } from './feed';
import { lineContent, threadLines } from './thread';

const ROOT = 'root';
const t = (minute: number) => new Date(Date.UTC(2026, 9, 8, 10, minute)).toISOString();

type StoredRow = Record<string, unknown> & { entity: string; in?: string; threadOf?: string };

/**
 * A tiny store answering the Feed's reads: rows by entity, each with the container holding it — or,
 * for a reply, the subject whose thread holds it, which is hydrated when a read includes `thread`.
 */
function store(rows: StoredRow[]) {
  const asked: { entity: string; query: RecordQuery }[] = [];
  const bare = ({ entity: _e, in: _in, threadOf: _t, ...rest }: StoredRow) => rest;
  const find = async (entity: string, query: RecordQuery) => {
    asked.push({ entity, query });
    let out = rows.filter((r) => r.entity === entity && (!query.within || r.in === query.within));
    if (query.where?.kind) out = out.filter((r) => r.kind === query.where?.kind);
    const dir = query.order?.createdAt === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => dir * (Date.parse(String(a.createdAt)) - Date.parse(String(b.createdAt))));
    const withThread = (r: StoredRow) =>
      (query.include as Record<string, unknown> | undefined)?.thread
        ? { ...bare(r), thread: rows.filter((m) => m.threadOf === r.id).map(bare) }
        : bare(r);
    return out.slice(0, query.limit ?? out.length).map(withThread);
  };
  return { find, asked };
}

const line = (id: string, minute: number, within: string, extra: Record<string, unknown> = {}) => ({
  entity: 'TextBlock',
  id,
  in: within,
  createdAt: t(minute),
  author: 'did:ann',
  text: id,
  source: 'spoken',
  ...extra,
});

describe('the feed window', () => {
  const calls = [
    { entity: 'CollectionBlock', id: 'monday', in: ROOT, kind: 'call', title: 'Monday sync', createdAt: t(0) },
    { entity: 'CollectionBlock', id: 'standup', in: ROOT, kind: 'call', title: 'Standup', createdAt: t(5) },
  ];
  const rows = [
    ...calls,
    line('m1', 1, 'monday'),
    line('m2', 7, 'monday'),
    line('s1', 6, 'standup'),
    line('s2', 9, 'standup'),
    line('typed', 8, ROOT, { source: 'typed' }),
  ];

  it('interleaves two calls that overlapped, and the loose messages between them', async () => {
    const { find } = store(rows);
    const { rows: drawn } = await readFeedWindow(find, { root: ROOT, shown: 10, fromStart: false, activityTypes: [] });
    expect(drawn.map((r) => r.id)).toEqual(['s2', 'typed', 'm2', 's1', 'm1']);
    expect(drawn[0]).toMatchObject({ call: 'standup', callTitle: 'Standup' });
    expect(drawn[1]).toMatchObject({ call: '', source: 'typed' });
  });

  it('reads the same from the start, oldest first', async () => {
    const { find } = store(rows);
    const { rows: drawn } = await readFeedWindow(find, { root: ROOT, shown: 10, fromStart: true, activityTypes: [] });
    expect(drawn.map((r) => r.id)).toEqual(['m1', 's1', 'm2', 'typed', 's2']);
  });

  it('crosses from one call into the next as the window grows, and says there is more until it has', async () => {
    const { find } = store(rows);
    const first = await readFeedWindow(find, { root: ROOT, shown: 2, fromStart: true, activityTypes: [] });
    expect(first.rows.map((r) => r.id)).toEqual(['m1', 's1']);
    expect(first.hasMore).toBe(true);
    const all = await readFeedWindow(find, { root: ROOT, shown: 10, fromStart: true, activityTypes: [] });
    expect(all.hasMore).toBe(false);
  });

  it('stops reading calls that cannot reach into a full window, from the start', async () => {
    const { find, asked } = store(rows);
    await readFeedWindow(find, { root: ROOT, shown: 1, fromStart: true, activityTypes: [] });
    // Monday's first line fills the window and Standup began after it, so Standup is never read.
    expect(asked.filter((a) => a.query.within === 'standup')).toEqual([]);
  });

  it('draws a reply after the line it answers, in the order it was said, quoting it', async () => {
    // A reply is a child of nothing: it is in the thread of the line it answers, and names that line.
    const { find } = store([
      ...calls,
      line('q', 1, 'monday'),
      { ...line('a', 4, '', { author: 'did:ben', text: 'answer', source: 'typed', respondsTo: 'q' }), threadOf: 'q' },
      {
        ...line('aa', 5, '', { author: 'did:ann', text: 'and again', source: 'typed', respondsTo: 'a' }),
        threadOf: 'q',
      },
      line('m3', 3, 'monday'),
    ]);
    const { rows: drawn } = await readFeedWindow(find, { root: ROOT, shown: 10, fromStart: true, activityTypes: [] });
    expect(drawn.map((r) => r.id)).toEqual(['q', 'm3', 'a', 'aa']);
    expect(drawn[2]).toMatchObject({ call: 'monday', replyTo: { id: 'q', text: 'q', author: 'did:ann' } });
    // A reply to a reply quotes the reply, which came in the same thread.
    expect(drawn[3]).toMatchObject({ replyTo: { id: 'a', text: 'answer', author: 'did:ben' } });
  });

  it('reads a call held about something, which is in no collection, with the others', async () => {
    // A call about a task is a response to the task: in its thread, and a child of nothing.
    const { find } = store([
      ...calls,
      { entity: 'CollectionBlock', id: 'about', kind: 'call', title: 'About the brief', createdAt: t(2) },
      line('b1', 3, 'about'),
    ]);
    const { rows: drawn } = await readFeedWindow(find, { root: ROOT, shown: 10, fromStart: true, activityTypes: [] });
    expect(drawn.find((r) => r.id === 'b1')).toMatchObject({ call: 'about', callTitle: 'About the brief' });
  });

  it('groups what one call found into one row, and what somebody made into another', async () => {
    const { find } = store([
      ...calls,
      {
        entity: 'TaskBlock',
        id: 't1',
        in: ROOT,
        title: 'Brief',
        createdAt: t(2),
        author: 'did:ann',
        extractedFrom: 'monday',
      },
      {
        entity: 'TaskBlock',
        id: 't2',
        in: ROOT,
        title: 'Venue',
        createdAt: t(2),
        author: 'did:ann',
        extractedFrom: 'monday',
      },
      {
        entity: 'EventBlock',
        id: 'e1',
        in: ROOT,
        title: 'Launch',
        createdAt: t(2),
        author: 'did:ann',
        extractedFrom: { id: 'monday' },
      },
      { entity: 'TaskBlock', id: 'h1', in: ROOT, title: 'By hand', createdAt: t(3), author: 'did:ben' },
    ]);
    const { rows: drawn } = await readFeedWindow(find, {
      root: ROOT,
      shown: 10,
      fromStart: true,
      activityTypes: ['TaskBlock', 'EventBlock'],
      pending: new Set(['t2']),
    });
    const activity = drawn.filter((r) => r.kind === 'activity');
    expect(activity).toHaveLength(2);
    expect(activity[0]).toMatchObject({
      origin: 'monday',
      originTitle: 'Monday sync',
      summary: '2 tasks and 1 event',
      suggested: 1,
    });
    expect(activity[1]).toMatchObject({ origin: '', author: 'did:ben', summary: '1 task' });
  });
});

describe('grouping and naming', () => {
  it('starts a new group after a quiet spell, even from the same source', () => {
    const groups = groupActivity(
      [
        { row: { id: 'a', createdAt: t(0), extractedFrom: 'c' }, entity: 'TaskBlock' },
        { row: { id: 'b', createdAt: t(5), extractedFrom: 'c' }, entity: 'TaskBlock' },
      ],
      new Map(),
    );
    expect(groups).toHaveLength(2);
  });

  it('names a kind of record the way a sentence would', () => {
    expect(nounFor('TaskBlock', 2)).toBe('tasks');
    expect(nounFor('EventBlock', 1)).toBe('event');
    expect(nounFor('Sighting', 3)).toBe('sightings');
  });

  it('flattens each line’s thread in beside it, quoting what each reply answers', () => {
    const flat = threadLines({
      rows: [
        {
          id: 'q',
          createdAt: t(1),
          author: 'did:ann',
          text: 'question',
          thread: [
            { id: 'b', createdAt: t(3), respondsTo: { id: 'a', author: 'did:ben', text: 'answer' } },
            { id: 'a', createdAt: t(2), author: 'did:ben', text: 'answer', respondsTo: 'q' },
            // A call held about the line is a conversation of its own, not a line of this one.
            { id: 'call', createdAt: t(4), kind: 'call', mode: 'feed', respondsTo: 'q' },
          ],
        },
        // Read twice — a page and a subscription can both hand a row over — and drawn once.
        { id: 'a', createdAt: t(2), respondsTo: 'q' },
      ],
    });
    expect(flat.map((r) => r.id)).toEqual(['q', 'a', 'b']);
    expect(flat[1]).toMatchObject({ replyTo: { id: 'q', author: 'did:ann', text: 'question' } });
    expect(flat[2]).toMatchObject({ replyTo: { id: 'a', author: 'did:ben', text: 'answer' } });
  });

  it('keeps the id of a line that holds it on its class, as a model instance does', () => {
    /*
      The Feed reads its lines through the module host, which hands back model instances whose `id`
      is a getter on the class. A spread copies only a row's own properties, so every line the Feed
      drew had an empty id, and a reply to one was written under no parent and went nowhere.
    */
    class Line {
      readonly text = 'lunch?';
      get id() {
        return 'msg-1';
      }
      get author() {
        return 'did:ann';
      }
    }
    const [line] = threadLines({ rows: [new Line()] });
    expect(line).toMatchObject({ id: 'msg-1', author: 'did:ann', text: 'lunch?' });
  });

  it('draws a line with marks from one block, and leaves plain text as text', () => {
    const marks = '[{"start":0,"end":4,"type":"mention","did":"did:ann"}]';
    expect(lineContent({ text: '@Ann can you?', marks })).toEqual([
      { _type: 'block', text: '@Ann can you?', marks: [{ start: 0, end: 4, type: 'mention', did: 'did:ann' }] },
    ]);
    expect(lineContent({ text: 'plain' })).toBeNull();
    expect(lineContent({ text: 'broken', marks: '[{' })).toBeNull();
  });
});
