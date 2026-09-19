/* eslint-disable @typescript-eslint/no-explicit-any -- result rows are Record<string, unknown>; tests cast to read hydrated relations */
import { describe, expect, it } from 'vitest';

import { compileQuery } from './queryCompiler';
import { executeQueryIR, type InMemoryDataset } from './queryEngine';
import type { QueryIR } from './queryIR';

const data: InMemoryDataset = {
  tables: {
    Agent: [
      { id: 'a1', name: 'Ada' },
      { id: 'a2', name: 'Bo' },
    ],
    Post: [
      { id: 'p1', title: 'Graph theory', content: 'nodes and edges', authorId: 'a1', createdAt: 3 },
      { id: 'p2', title: 'Cooking', content: 'about graphs too', authorId: 'a2', createdAt: 2 },
      { id: 'p3', title: 'Weather', content: 'sunny', authorId: 'a1', createdAt: 1 },
    ],
    Signal: [
      { id: 's1', postId: 'p1', signalTypeId: 'like', value: 5 },
      { id: 's2', postId: 'p1', signalTypeId: 'like', value: 3 },
      { id: 's3', postId: 'p2', signalTypeId: 'like', value: 1 },
      { id: 's4', postId: 'p2', signalTypeId: 'star', value: 9 },
    ],
  },
  relations: {
    Post: {
      author: { target: 'Agent', cardinality: 'one', foreignKey: 'authorId' },
      signals: { target: 'Signal', cardinality: 'many', foreignKey: 'postId' },
    },
    Agent: { posts: { target: 'Post', cardinality: 'many', foreignKey: 'authorId' } },
  },
};

const ids = (rows: { id: unknown }[]) => rows.map((r) => r.id);

describe('executeQueryIR', () => {
  it('filters a boolean tree (title OR content contains "graph")', () => {
    const q: QueryIR = {
      irVersion: 1,
      entity: 'Post',
      filter: {
        or: [
          { field: 'title', op: 'contains', value: 'graph' },
          { field: 'content', op: 'contains', value: 'graph' },
        ],
      },
    };
    expect(ids(executeQueryIR(q, data))).toEqual(['p1', 'p2']); // p3 excluded
  });

  it('computes a count aggregate and sorts by it (most-liked first)', () => {
    const q: QueryIR = {
      irVersion: 1,
      entity: 'Post',
      aggregate: [
        { as: 'likeCount', over: 'signals', fn: 'count', filter: { field: 'signalTypeId', op: 'eq', value: 'like' } },
      ],
      sort: [{ by: 'likeCount', dir: 'desc' }],
    };
    const rows = executeQueryIR(q, data);
    expect(ids(rows)).toEqual(['p1', 'p2', 'p3']); // p1=2 likes, p2=1, p3=0
    expect(rows.map((r) => r.likeCount)).toEqual([2, 1, 0]);
  });

  it('computes sum/max aggregates over a filtered related set', () => {
    const q: QueryIR = {
      irVersion: 1,
      entity: 'Post',
      filter: { field: 'id', op: 'eq', value: 'p2' },
      aggregate: [
        {
          as: 'likeSum',
          over: 'signals',
          fn: 'sum',
          field: 'value',
          filter: { field: 'signalTypeId', op: 'eq', value: 'like' },
        },
        { as: 'topValue', over: 'signals', fn: 'max', field: 'value' },
      ],
    };
    const [row] = executeQueryIR(q, data);
    expect(row.likeSum).toBe(1); // only s3 (like) = 1
    expect(row.topValue).toBe(9); // s4 star = 9
  });

  it('hydrates a to-one relation (author) and a to-many (signals)', () => {
    const q: QueryIR = {
      irVersion: 1,
      entity: 'Post',
      filter: { field: 'id', op: 'eq', value: 'p1' },
      include: { author: true, signals: true },
    };
    const [row] = executeQueryIR(q, data) as any[];
    expect(row.author.name).toBe('Ada');
    expect(ids(row.signals)).toEqual(['s1', 's2']);
  });

  it('include with filter + first unwraps a to-many to a single object|null', () => {
    const q: QueryIR = {
      irVersion: 1,
      entity: 'Post',
      filter: { field: 'id', op: 'eq', value: 'p2' },
      include: { signals: { filter: { field: 'signalTypeId', op: 'eq', value: 'star' }, first: true } },
    };
    const [row] = executeQueryIR(q, data) as any[];
    expect(row.signals.id).toBe('s4'); // unwrapped single object
  });

  it('sorts by a to-one relation path (author.name)', () => {
    const q: QueryIR = { irVersion: 1, entity: 'Post', sort: [{ by: 'author.name', dir: 'asc' }] };
    // Ada (a1) posts p1,p3 before Bo (a2) post p2; within Ada, stable order p1,p3
    expect(ids(executeQueryIR(q, data))).toEqual(['p1', 'p3', 'p2']);
  });

  it('paginates with offset + limit', () => {
    const q: QueryIR = {
      irVersion: 1,
      entity: 'Post',
      sort: [{ by: 'createdAt', dir: 'desc' }],
      page: { limit: 1, offset: 1 },
    };
    expect(ids(executeQueryIR(q, data))).toEqual(['p2']); // desc: p1,p2,p3 → offset 1, limit 1 → p2
  });

  it('nested include (Agent → posts → signals)', () => {
    const q: QueryIR = {
      irVersion: 1,
      entity: 'Agent',
      filter: { field: 'id', op: 'eq', value: 'a1' },
      include: { posts: { include: { signals: true } } },
    };
    const [agent] = executeQueryIR(q, data) as any[];
    expect(ids(agent.posts)).toEqual(['p1', 'p3']);
    expect(ids(agent.posts[0].signals)).toEqual(['s1', 's2']);
  });

  it('relation filter: posts that have >=1 "star" signal', () => {
    const q: QueryIR = {
      irVersion: 1,
      entity: 'Post',
      filter: { rel: 'signals', op: 'some', where: { field: 'signalTypeId', op: 'eq', value: 'star' } },
    };
    expect(ids(executeQueryIR(q, data))).toEqual(['p2']); // only p2 has a star
  });

  it('select projects scalar props (keeping id + aggregates + includes)', () => {
    const q: QueryIR = {
      irVersion: 1,
      entity: 'Post',
      filter: { field: 'id', op: 'eq', value: 'p1' },
      select: ['title'],
      aggregate: [{ as: 'likeCount', over: 'signals', fn: 'count' }],
      include: { author: true },
    };
    const [row] = executeQueryIR(q, data) as any[];
    expect(Object.keys(row).sort()).toEqual(['author', 'id', 'likeCount', 'title']); // content/authorId/createdAt dropped
    expect(row.title).toBe('Graph theory');
    expect(row.author.name).toBe('Ada');
    expect(row.likeCount).toBe(2);
  });

  it('scope: drills down to an anchor’s related rows (Agent a1 → their posts)', () => {
    const q: QueryIR = { irVersion: 1, entity: 'Post', scope: { via: 'posts', anchorId: 'a1', anchor: 'Agent' } };
    expect(ids(executeQueryIR(q, data))).toEqual(['p1', 'p3']);
  });

  it('scope: resolves the drill-down relation even without an explicit anchor type', () => {
    const q: QueryIR = { irVersion: 1, entity: 'Post', scope: { via: 'posts', anchorId: 'a2' } };
    expect(ids(executeQueryIR(q, data))).toEqual(['p2']);
  });

  it('scope: returns empty when the drill-down relation cannot be resolved (fail closed)', () => {
    const q: QueryIR = { irVersion: 1, entity: 'Post', scope: { via: 'ghost', anchorId: 'a1' } };
    expect(executeQueryIR(q, data)).toEqual([]);
  });

  it('include alias (over): attaches a filtered relation under a $-alias, unwrapped with first', () => {
    const q: QueryIR = {
      irVersion: 1,
      entity: 'Post',
      filter: { field: 'id', op: 'eq', value: 'p2' },
      include: {
        author: true,
        $myStar: { over: 'signals', filter: { field: 'signalTypeId', op: 'eq', value: 'star' }, first: true },
      },
    };
    const [row] = executeQueryIR(q, data) as any[];
    expect(row.author.name).toBe('Bo');
    expect(row.$myStar.id).toBe('s4'); // unwrapped single object under the alias
  });

  it('include alias (over): the same relation can appear twice — plain + aliased', () => {
    const q: QueryIR = {
      irVersion: 1,
      entity: 'Post',
      filter: { field: 'id', op: 'eq', value: 'p1' },
      include: {
        signals: true,
        $likes: { over: 'signals', filter: { field: 'signalTypeId', op: 'eq', value: 'like' } },
      },
    };
    const [row] = executeQueryIR(q, data) as any[];
    expect(ids(row.signals)).toEqual(['s1', 's2']); // plain hydration under the relation name
    expect(ids(row.$likes)).toEqual(['s1', 's2']); // same relation, aliased + filtered separately
  });
});

describe('untyped relations', () => {
  /**
   * A relation with no declared target holds children *of any type* — `CollectionBlock.children` is
   * the case, since a collection mixes text, images and embeds. Reading that as an empty table made
   * every projection over it resolve to null, so a media grid (which drops posts with no image
   * rather than showing blank tiles) rendered as nothing at all.
   */
  const data = {
    tables: {
      Post: [{ id: 'p1' }, { id: 'p2' }],
      TextBlock: [{ id: 't1', __Post_children: 'p1', text: 'hello' }],
      ImageBlock: [
        { id: 'i1', __Post_children: 'p1', src: 'a.png' },
        { id: 'i2', __Post_children: 'p2', src: 'b.png' },
      ],
    },
    relations: { Post: { children: { target: '', cardinality: 'many' as const, foreignKey: '__Post_children' } } },
  };

  it('hydrates children from every table', () => {
    const [first] = executeQueryIR(
      { entity: 'Post', include: { children: true }, filter: { field: 'id', op: 'eq', value: 'p1' } } as never,
      data,
    );
    expect((first.children as Array<{ id: string }>).map((c) => c.id).sort()).toEqual(['i1', 't1']);
  });

  it('still filters a projection over one, which is what a cover image is', () => {
    const rows = executeQueryIR(
      {
        entity: 'Post',
        include: { $cover: { over: 'children', filter: { field: 'src', op: 'exists', value: true }, first: true } },
      } as never,
      data,
    );
    expect((rows[0].$cover as { id: string }).id).toBe('i1');
    expect((rows[1].$cover as { id: string }).id).toBe('i2');
  });
});

describe('an ordered relation', () => {
  // Children deliberately sit in the table in an order nobody chose, with the parent recording the
  // order somebody did choose. Reading by foreign key alone gives the first; that is the bug.
  const ordered: InMemoryDataset = {
    tables: {
      Collection: [{ id: 'c1', children: ['b3', 'b1', 'b2'] }],
      Block: [
        { id: 'b1', collectionId: 'c1', text: 'first written' },
        { id: 'b2', collectionId: 'c1', text: 'second written' },
        { id: 'b3', collectionId: 'c1', text: 'third written' },
      ],
    },
    relations: {
      Collection: { children: { target: 'Block', cardinality: 'many', foreignKey: 'collectionId', ordered: true } },
    },
  };

  const childrenOf = (data: InMemoryDataset) =>
    (executeQueryIR({ irVersion: 1, entity: 'Collection', include: { children: true } }, data)[0] as any).children.map(
      (c: { id: string }) => c.id,
    );

  it('reads back in the order the parent recorded, not the order the members were written', () => {
    expect(childrenOf(ordered)).toEqual(['b3', 'b1', 'b2']);
  });

  it('keeps a member the order does not mention, at the end', () => {
    // Position and membership are separate facts, so an unlisted member is still a member. This is
    // the partially-migrated collection: some order written, the rest not yet.
    const partial = structuredClone(ordered);
    partial.tables.Block.push({ id: 'b4', collectionId: 'c1', text: 'never positioned' });
    expect(childrenOf(partial)).toEqual(['b3', 'b1', 'b2', 'b4']);
  });

  it('ignores an id in the order that is no longer a member', () => {
    const stale = structuredClone(ordered);
    (stale.tables.Collection[0].children as string[]).unshift('deleted');
    expect(childrenOf(stale)).toEqual(['b3', 'b1', 'b2']);
  });

  it('reads exactly as before when no order has been recorded', () => {
    // The migration case: a collection that predates ordering must not change what it shows.
    const unwritten = structuredClone(ordered);
    delete unwritten.tables.Collection[0].children;
    expect(childrenOf(unwritten)).toEqual(['b1', 'b2', 'b3']);
  });

  it('leaves an unordered relation alone', () => {
    const unordered = structuredClone(ordered);
    delete unordered.relations!.Collection.children.ordered;
    expect(childrenOf(unordered)).toEqual(['b1', 'b2', 'b3']);
  });
});

/**
 * The engine has always evaluated relation quantifiers and nothing could reach them: the flat
 * dialect had no spelling, so `compileQuery` never produced one. These drive the whole chain a
 * template now takes — a flat `where` in, rows out — rather than handing the engine an IR built by
 * hand, because the half that was missing is the translation and an IR fixture would skip it.
 */
describe('relation quantifiers, from the flat where a template writes', () => {
  const run = (where: Record<string, unknown>) => ids(executeQueryIR(compileQuery({ entity: 'Post', where }).ir, data));

  it('finds records with none of a relation, and with any of it', () => {
    // p3 is the only post nobody signalled — previously answerable only by fetching every post with
    // its signals and counting client-side.
    expect(run({ signals: { none: {} } })).toEqual(['p3']);
    expect(run({ signals: { some: {} } })).toEqual(['p1', 'p2']);
  });

  it('filters on a property of the related record', () => {
    expect(run({ signals: { some: { signalTypeId: 'star' } } })).toEqual(['p2']);
    // "nobody starred this" is the negation of the above, not of `some: {}` — p1 has signals, just
    // no stars, so it belongs in the answer.
    expect(run({ signals: { none: { signalTypeId: 'star' } } })).toEqual(['p1', 'p3']);
  });

  it('composes with a scalar condition on the parent', () => {
    expect(run({ title: { contains: 'graph' }, signals: { some: { signalTypeId: 'like' } } })).toEqual(['p1']);
  });

  it('reaches a relation of the related record', () => {
    // Agents who wrote something somebody liked — a quantifier whose nested clause is itself one.
    expect(
      ids(
        executeQueryIR(
          compileQuery({ entity: 'Agent', where: { posts: { some: { signals: { some: {} } } } } }).ir,
          data,
        ),
      ),
    ).toEqual(['a1', 'a2']);
  });
});

describe('range bounds in the engine', () => {
  const tasks: InMemoryDataset = {
    tables: {
      TaskBlock: [
        { id: 't1', dueDate: '2026-09-14', estimate: 2 },
        { id: 't2', dueDate: '2026-09-30T18:00', estimate: 5 },
        { id: 't3', dueDate: '2026-10-02', estimate: '8' },
        { id: 't4', estimate: 13 },
      ],
    },
  };
  const ids = (where: Record<string, unknown>) =>
    executeQueryIR(compileQuery({ entity: 'TaskBlock', where }).ir, tasks).map((r) => r.id);

  it('compares ISO dates as text, so a day bound works against a value carrying a time', () => {
    expect(ids({ dueDate: { gte: '2026-09-15', lt: '2026-10-01' } })).toEqual(['t2']);
  });

  it('compares numbers numerically and refuses a mixed pair rather than coercing it', () => {
    // t3 stores its estimate as the string '8'; t4 has no due date at all.
    expect(ids({ estimate: { gt: 4 } })).toEqual(['t2', 't4']);
    expect(ids({ dueDate: { lt: '2027' } })).toEqual(['t1', 't2', 't3']);
  });
});

/**
 * Bounded traversal — several anchors, a transitive walk, the inverse direction, and a per-anchor
 * limit. The reference implementation answers all four, so a store's tests are about the store
 * rather than about which backend happens to be underneath it.
 */
describe('executeQueryIR — bounded traversal', () => {
  /**
   * A comment tree, self-referential through `parentId`:
   *
   * ```text
   * root ── c1 ── r1 ── rr1
   *   │      └─── r2
   *   ├──── c2
   *   └──── c3
   * ```
   */
  const tree: InMemoryDataset = {
    tables: {
      Comment: [
        { id: 'c1', parentId: 'root', text: 'one' },
        { id: 'c2', parentId: 'root', text: 'two' },
        { id: 'c3', parentId: 'root', text: 'three' },
        { id: 'r1', parentId: 'c1', text: 'reply one' },
        { id: 'r2', parentId: 'c1', text: 'reply two' },
        { id: 'rr1', parentId: 'r1', text: 'deep' },
      ],
    },
    relations: {
      Comment: { comments: { target: 'Comment', cardinality: 'many', foreignKey: 'parentId' } },
    },
  };

  const run = (scope: QueryIR['scope']) => ids(executeQueryIR({ irVersion: 1, entity: 'Comment', scope }, tree));

  it('answers for every anchor in one query', () => {
    expect(run({ via: 'comments', anchorId: ['c1', 'r1'], anchor: 'Comment' }).sort()).toEqual(['r1', 'r2', 'rr1']);
  });

  it('walks the whole subtree when transitive, excluding the anchor', () => {
    expect(run({ via: 'comments', anchorId: 'root', anchor: 'Comment', transitive: true }).sort()).toEqual([
      'c1',
      'c2',
      'c3',
      'r1',
      'r2',
      'rr1',
    ]);
  });

  it('stays one step when not transitive', () => {
    expect(run({ via: 'comments', anchorId: 'root', anchor: 'Comment' }).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('finds the parent when reading inward', () => {
    expect(run({ via: 'comments', anchorId: 'rr1', anchor: 'Comment', direction: 'in' })).toEqual(['rr1']);
  });

  /**
   * Per anchor, not overall: two anchors with a limit of one must give one *each*, where a global
   * limit of two could legitimately take both from the same anchor.
   */
  it('keeps the limit per anchor rather than across the result', () => {
    const rows = run({ via: 'comments', anchorId: ['root', 'c1'], anchor: 'Comment', limitPerAnchor: 1 });
    expect(rows).toHaveLength(2);
    expect(rows).toContain('c1');
    expect(rows).toContain('r1');
  });

  /**
   * The failure worth guarding: an empty anchor list must not read as "no scope" and return the
   * whole entity. It arises whenever a level reads the ids of the level above and that level is
   * empty or has not arrived yet.
   */
  it('answers with nothing for an empty anchor list', () => {
    expect(run({ via: 'comments', anchorId: [], anchor: 'Comment' })).toEqual([]);
  });

  it('terminates on a cycle rather than walking it forever', () => {
    const cyclic: InMemoryDataset = {
      tables: {
        Comment: [
          { id: 'x', parentId: 'y' },
          { id: 'y', parentId: 'x' },
        ],
      },
      relations: { Comment: { comments: { target: 'Comment', cardinality: 'many', foreignKey: 'parentId' } } },
    };
    const rows = executeQueryIR(
      {
        irVersion: 1,
        entity: 'Comment',
        scope: { via: 'comments', anchorId: 'x', anchor: 'Comment', transitive: true },
      },
      cyclic,
    );
    expect(ids(rows).sort()).toEqual(['x', 'y']);
  });
});
