/* eslint-disable @typescript-eslint/no-explicit-any -- result rows are Record<string, unknown>; tests cast to read hydrated relations */
import { describe, expect, it } from 'vitest';

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
