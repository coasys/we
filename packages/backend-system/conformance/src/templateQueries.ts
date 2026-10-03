/**
 * The queries templates actually send, run against one small space.
 *
 * The rest of the suite asks about a feature at a time. This asks the question closest to what a
 * person sees: does the query a real template sends come back with the right rows? Each case is a
 * `$query` lifted from a shipped template — the file is named beside it — with its expressions
 * replaced by the values they would hold, and routed exactly as the renderer routes it
 * (`routeQuery` through the backend's `$queryAdapter`, then `findAll` on what `$getEntity` returns).
 * A query the backend refuses fails here as it would fail on screen.
 *
 * The expected answers are written by hand, in terms of the space below. The in-memory backend is
 * the reference, so a case it fails is an expectation written wrong; every other backend is held to
 * answers that one has already confirmed.
 *
 * The space is seeded once for all of them, through the same writes the app makes. On a backend
 * where every write is a network round trip, seeding per case would cost more than the cases.
 */
import {
  type DatasetHandle,
  type FlatQuery,
  manifestEntries,
  type RendererDataBindings,
  routeQuery,
} from '@we/backend-shared';
import { getEntity } from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ConformanceHarness, ConformanceSubject } from './index';

export const TEMPLATE_QUERY_CASES = [
  'queries.vocabulary-by-name',
  'queries.blocks-of-a-post',
  'queries.images-of-a-post',
  'queries.calls-in-a-channel',
  'queries.posts-newest-first',
  'queries.posts-most-liked',
  'queries.discussion-root',
  'queries.comment-thread',
  'queries.comment-thread-muted',
  'queries.boards-in-a-channel',
  'queries.columns-of-a-board',
  'queries.tasks-in-a-channel',
  'queries.canvases',
  'queries.space-board',
] as const;

export type TemplateQueryCase = (typeof TEMPLATE_QUERY_CASES)[number];

interface Row {
  id: string;
  [field: string]: unknown;
}

interface Instance extends Row {
  addChildren(child: unknown): Promise<void>;
  addComments(child: unknown): Promise<void>;
  addSignals(child: unknown): Promise<void>;
}

interface Model {
  create(dataset: DatasetHandle, data?: Record<string, unknown>): Promise<Instance>;
}

// ── The space ──────────────────────────────────────────────────────────────
//
//   channel ─┬─ post 1 "hello world"   ─┬─ text 1, text 2, image 1     ♥♥
//            │                          └─ comment 1 ── comment 2
//            ├─ post 2 "hello again"                                    ♥
//            ├─ post 3 "hello there"  (also a reply to post 2)
//            ├─ call "Standup"
//            ├─ board ── column 1, column 2
//            └─ task 1, task 2
//   canvas (on its own) · relationship types beta, alpha, gamma · a space whose board is `board`

type Key =
  | 'channel'
  | 'post1'
  | 'post2'
  | 'post3'
  | 'comment1'
  | 'comment2'
  | 'text1'
  | 'text2'
  | 'image1'
  | 'call'
  | 'board'
  | 'column1'
  | 'column2'
  | 'task1'
  | 'task2'
  | 'canvas'
  | 'alpha'
  | 'beta'
  | 'gamma'
  | 'space';

const model = (name: string) => getEntity(name) as unknown as Model;

/**
 * Enough time between two writes that their `createdAt` differs. A sort on it is the commonest order
 * in the templates, and two rows created in the same millisecond have no right order to check.
 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

async function seed(dataset: DatasetHandle): Promise<Record<Key, string>> {
  const made = {} as Record<Key, Instance>;
  const make = async (key: Key, entity: string, data: Record<string, unknown>) => {
    made[key] = await model(entity).create(dataset, data);
    await tick();
    return made[key];
  };

  const channel = await make('channel', 'CollectionBlock', { kind: 'channel', title: 'General' });
  for (const [key, text] of [
    ['post1', 'hello world'],
    ['post2', 'hello again'],
    ['post3', 'hello there'],
  ] as const) {
    await channel.addChildren(await make(key, 'CollectionBlock', { type: 'root', kind: 'post', textContent: text }));
  }
  await made.post2.addComments(made.post3);

  for (const key of ['text1', 'text2'] as const) {
    await made.post1.addChildren(await make(key, 'TextBlock', { text: key }));
  }
  await made.post1.addChildren(await make('image1', 'ImageBlock', { src: 'image1.png' }));

  await made.post1.addComments(await make('comment1', 'CollectionBlock', { kind: 'comment', textContent: 'a reply' }));
  await made.comment1.addComments(
    await make('comment2', 'CollectionBlock', { kind: 'comment', textContent: 'and another' }),
  );

  for (const post of [made.post1, made.post1, made.post2]) {
    await post.addSignals(await model('Signal').create(dataset, { signalTypeId: 'like', value: 1 }));
  }

  await channel.addChildren(await make('call', 'CollectionBlock', { kind: 'call', title: 'Standup' }));
  const board = await make('board', 'CollectionBlock', { kind: 'board', title: 'Work' });
  await channel.addChildren(board);
  for (const key of ['column1', 'column2'] as const) {
    await board.addChildren(await make(key, 'CollectionBlock', { kind: 'column', title: key }));
  }
  for (const key of ['task1', 'task2'] as const) {
    await channel.addChildren(await make(key, 'TaskBlock', { title: key }));
  }

  await make('canvas', 'CollectionBlock', { kind: 'canvas', title: 'Map' });
  for (const key of ['beta', 'alpha', 'gamma'] as const) await make(key, 'RelationshipType', { name: key });
  // A to-one relation set on the record and saved — the way both backends document. Passing it in
  // `create`'s data is not the same thing everywhere, which is a separate question from this query.
  const space = await make('space', 'Space', { name: 'The space', description: 'For the queries' });
  (space as unknown as { board: string }).board = board.id;
  await (space as unknown as { save(): Promise<void> }).save();

  return Object.fromEntries(Object.entries(made).map(([key, instance]) => [key, instance.id])) as Record<Key, string>;
}

// ── The cases ──────────────────────────────────────────────────────────────
//
// `expect` is what must come back, in the fixture's own words: keys in order, keys as a set, or one
// derived value per row — a count, the record a relation points at — keyed by the row.

interface QueryCase {
  /** The template the query is lifted from, so a failure leads to what it breaks. */
  from: string;
  query: (k: Record<Key, string>, agent: string) => FlatQuery;
  expect:
    | { order: Key[] }
    | { set: Key[] }
    | { field: string; values: Partial<Record<Key, unknown>> }
    | { relation: string; points: Partial<Record<Key, Key>> };
}

const inChannel = (k: Record<Key, string>) => ({ anchor: 'CollectionBlock', via: 'children', anchorId: k.channel });

const CASES: Record<TemplateQueryCase, QueryCase> = {
  'queries.vocabulary-by-name': {
    from: 'templates/shell/src/spaces/vocabulary/RelationshipTypesSection.ts',
    query: () => ({ entity: 'RelationshipType', order: { name: 'asc' } }),
    expect: { order: ['alpha', 'beta', 'gamma'] },
  },
  'queries.blocks-of-a-post': {
    from: 'templates/views/src/views/CardsView/BlocksList.ts',
    query: (k) => ({
      entity: 'TextBlock',
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: k.post1 },
      order: { createdAt: 'asc' },
      limit: 20,
    }),
    expect: { order: ['text1', 'text2'] },
  },
  'queries.images-of-a-post': {
    from: 'templates/views/src/views/CardsView/BlocksList.ts',
    query: (k) => ({
      entity: 'ImageBlock',
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: k.post1 },
      order: { createdAt: 'desc' },
      limit: 20,
    }),
    expect: { order: ['image1'] },
  },
  'queries.calls-in-a-channel': {
    from: 'templates/views/src/views/CardsView/CallsList.ts',
    query: (k) => ({
      entity: 'CollectionBlock',
      where: { kind: 'call' },
      scope: inChannel(k),
      limit: 20,
      order: { createdAt: 'desc' },
    }),
    expect: { order: ['call'] },
  },
  'queries.posts-newest-first': {
    // Post 3 says "hello" too, and is left out for being a reply — the `none` is doing the work.
    from: 'templates/views/src/views/CardsView/PostsList.ts',
    query: (k) => ({
      entity: 'CollectionBlock',
      where: { type: 'root', inReplyTo: { none: {} }, textContent: { contains: 'hello' } },
      scope: inChannel(k),
      limit: 20,
      order: { createdAt: 'desc' },
    }),
    expect: { order: ['post2', 'post1'] },
  },
  'queries.posts-most-liked': {
    from: 'templates/views/src/views/CardsView/PostsList.ts',
    query: (k) => ({
      entity: 'CollectionBlock',
      where: { type: 'root', inReplyTo: { none: {} } },
      scope: inChannel(k),
      limit: 20,
      order: { $likeCount: 'desc' },
      include: { $likeCount: { from: 'signals', count: true } },
    }),
    expect: { field: '$likeCount', values: { post1: 2, post2: 1 } },
  },
  'queries.discussion-root': {
    from: 'templates/views/src/views/CardsView/PostsList.ts',
    query: (k) => ({ entity: 'CollectionBlock', where: { id: k.post1 }, include: { signals: true }, limit: 1 }),
    expect: { field: 'signals', values: { post1: 2 } },
  },
  'queries.comment-thread': {
    from: 'templates/views/src/views/GraphView/EdgeDetail.ts',
    query: (k) => ({
      entity: 'CollectionBlock',
      where: { author: { not: ['did:test:somebody-muted'] } },
      scope: { anchor: 'CollectionBlock', via: 'comments', anchorId: k.post1, levels: [10, 5, 3] },
      order: { createdAt: 'asc' },
      include: { inReplyTo: true },
    }),
    expect: { relation: 'inReplyTo', points: { comment1: 'post1', comment2: 'comment1' } },
  },
  'queries.comment-thread-muted': {
    // The same thread with its author muted: everything in it is theirs, so nothing is left.
    from: 'templates/views/src/views/GraphView/EdgeDetail.ts',
    query: (k, agent) => ({
      entity: 'CollectionBlock',
      where: { author: { not: [agent] } },
      scope: { anchor: 'CollectionBlock', via: 'comments', anchorId: k.post1, levels: [10, 5, 3] },
      order: { createdAt: 'asc' },
    }),
    expect: { order: [] },
  },
  'queries.boards-in-a-channel': {
    from: 'templates/views/src/views/BoardsView/index.ts',
    query: (k) => ({
      entity: 'CollectionBlock',
      where: { kind: 'board' },
      scope: inChannel(k),
      order: { createdAt: 'asc' },
      limit: 50,
    }),
    expect: { order: ['board'] },
  },
  'queries.columns-of-a-board': {
    from: 'templates/views/src/views/BoardsView/index.ts',
    query: (k) => ({
      entity: 'CollectionBlock',
      where: { kind: 'column' },
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: k.board },
    }),
    expect: { set: ['column1', 'column2'] },
  },
  'queries.tasks-in-a-channel': {
    from: 'templates/views/src/views/BoardsView/index.ts',
    query: (k) => ({ entity: 'TaskBlock', scope: inChannel(k), order: { createdAt: 'asc' } }),
    expect: { order: ['task1', 'task2'] },
  },
  'queries.canvases': {
    from: 'templates/views/src/views/GraphView/index.ts',
    query: () => ({ entity: 'CollectionBlock', where: { kind: 'canvas' }, order: { createdAt: 'asc' } }),
    expect: { order: ['canvas'] },
  },
  'queries.space-board': {
    from: 'templates/views/src/views/BoardsView/index.ts',
    query: () => ({ entity: 'Space', include: { board: true }, limit: 1 }),
    expect: { relation: 'board', points: { space: 'board' } },
  },
};

// ── Comparing ──────────────────────────────────────────────────────────────

/** A relation reads back as the record, or as its id, depending on whether it was included. */
const idOf = (value: unknown): string | undefined =>
  value && typeof value === 'object' ? String((value as { id?: unknown }).id) : value ? String(value) : undefined;

function answer(rows: Row[], expected: QueryCase['expect'], keyOf: (id: string) => string): unknown {
  if ('order' in expected) return rows.map((r) => keyOf(r.id));
  if ('set' in expected) return rows.map((r) => keyOf(r.id)).sort();
  if ('field' in expected) {
    return Object.fromEntries(
      rows.map((r) => {
        const value = r[expected.field];
        return [keyOf(r.id), Array.isArray(value) ? value.length : Number(value ?? 0)];
      }),
    );
  }
  return Object.fromEntries(
    rows.map((r) => {
      const target = idOf(
        Array.isArray(r[expected.relation]) ? (r[expected.relation] as unknown[])[0] : r[expected.relation],
      );
      return [keyOf(r.id), target ? keyOf(target) : null];
    }),
  );
}

function wanted(expected: QueryCase['expect']): unknown {
  if ('order' in expected) return expected.order;
  if ('set' in expected) return [...expected.set].sort();
  if ('field' in expected) return expected.values;
  return expected.points;
}

// ── Run ────────────────────────────────────────────────────────────────────

export function describeTemplateQueries(name: string, harness: ConformanceHarness, timeout: number): void {
  describe(`template queries: ${name}`, () => {
    let subject: ConformanceSubject;
    let bindings: RendererDataBindings;
    let keys: Record<Key, string>;
    let keyOf: (id: string) => string;

    beforeAll(async () => {
      subject = await harness.setup();
      bindings = subject.ports.dataBindings({
        currentDataset: () => subject.dataset,
        // What the shell passes: the dataset's foreign entities, which a fresh one has none of, and
        // the host's core vocabulary — which a `scope` is resolved against.
        currentDatasetEntities: () => manifestEntries(CORE_MANIFEST),
        profiles: () => [],
        fetchProfile: () => {},
        ephemeral: subject.ports.ephemeral,
      });
      keys = await seed(subject.dataset);
      const byId = new Map(Object.entries(keys).map(([key, id]) => [id, key]));
      keyOf = (id) => byId.get(id) ?? `unknown:${id}`;
    }, timeout * 6);

    afterAll(async () => {
      if (subject) await harness.teardown?.(subject);
    }, timeout);

    for (const id of TEMPLATE_QUERY_CASES) {
      const c = CASES[id];
      const gap = harness.knownGaps?.[id];
      const title = `${id.slice('queries.'.length)} (${c.from.split('/').slice(-2).join('/')})`;
      const body = async () => {
        const routed = routeQuery(c.query(keys, subject.agent), bindings.$queryAdapter!);
        if (!routed.ok) expect.fail(`the backend refuses this template's query: ${routed.error}`);
        const query = c.query(keys, subject.agent);
        const reader = bindings.$getEntity!(query.entity) as unknown as {
          findAll(dataset: DatasetHandle, options: unknown): Promise<Row[]>;
        };
        const rows = await reader.findAll(subject.dataset, routed.options);
        expect(answer(rows, c.expect, keyOf)).toEqual(wanted(c.expect));
      };
      if (gap) it.fails(`${title} [known gap: ${gap}]`, body, timeout);
      else it(title, body, timeout);
    }
  });
}
