import { describe, expect, it } from 'vitest';

import { compileQuery, type FlatQuery, irToFlatQuery, whereUsesCombinator } from './queryCompiler';
import { validateQueryIR } from './queryIR';

describe('compileQuery', () => {
  it('translates a common feed query cleanly (model/where-OR/order/limit/include) with no gaps', () => {
    const legacy: FlatQuery = {
      entity: 'Post',
      where: { OR: [{ title: { contains: 'graph' } }, { content: { contains: 'graph' } }] },
      order: { createdAt: 'desc' },
      limit: 20,
      include: { author: true, comments: { where: { hidden: false }, order: { createdAt: 'asc' } } },
    };
    const { ir, unsupported } = compileQuery(legacy);
    expect(unsupported).toEqual([]);
    expect(validateQueryIR(ir).valid).toBe(true);
    expect(ir.entity).toBe('Post');
    expect(ir.filter).toEqual({
      or: [
        { field: 'title', op: 'contains', value: 'graph' },
        { field: 'content', op: 'contains', value: 'graph' },
      ],
    });
    expect(ir.sort).toEqual([{ by: 'createdAt', dir: 'desc' }]);
    expect(ir.page).toEqual({ limit: 20 });
    expect(ir.include).toEqual({
      author: true,
      comments: { filter: { field: 'hidden', op: 'eq', value: false }, sort: [{ by: 'createdAt', dir: 'asc' }] },
    });
  });

  it('maps the where operator forms (eq / ne / nin / contains / exists) + implicit-AND of siblings', () => {
    const { ir } = compileQuery({
      entity: 'X',
      where: { a: 1, b: { not: 2 }, c: { not: [3, 4] }, d: { contains: 'z' }, e: { exists: true } },
    });
    expect(ir.filter).toEqual({
      and: [
        { field: 'a', op: 'eq', value: 1 },
        { field: 'b', op: 'ne', value: 2 },
        { field: 'c', op: 'nin', value: [3, 4] },
        { field: 'd', op: 'contains', value: 'z' },
        { field: 'e', op: 'exists', value: true },
      ],
    });
  });

  it('maps a count-projection to a top-level aggregate (alias keeps the $ for round-trip reads)', () => {
    const { ir, unsupported } = compileQuery({
      entity: 'Post',
      include: { $likeCount: { from: 'signals', count: true, where: { signalTypeId: 'like' } } },
    });
    expect(unsupported).toEqual([]);
    expect(ir.aggregate).toEqual([
      { as: '$likeCount', over: 'signals', fn: 'count', filter: { field: 'signalTypeId', op: 'eq', value: 'like' } },
    ]);
    expect(ir.include).toBeUndefined();
  });

  it('records subscribe:false as a one-shot query (live:false)', () => {
    const { ir } = compileQuery({ entity: 'Post', subscribe: false });
    expect(ir.live).toBe(false);
  });

  it('maps a single/filtered projection to an aliased include (limit:1 → first, `$` kept for reads)', () => {
    const { ir, unsupported } = compileQuery({
      entity: 'Conversation',
      include: { $myLike: { from: 'signals', where: { author: 'did:me' }, limit: 1 } },
    });
    expect(unsupported).toEqual([]);
    expect(ir.include).toEqual({
      $myLike: { over: 'signals', filter: { field: 'author', op: 'eq', value: 'did:me' }, first: true },
    });
  });

  it('passes a neutral `scope` drill-down straight to the IR (supported — the adapter resolves it)', () => {
    const { ir, unsupported } = compileQuery({
      entity: 'ConversationSubgroup',
      scope: { anchor: 'Conversation', via: 'subgroupEntities', anchorId: 'c1' },
    });
    expect(unsupported).toEqual([]);
    expect(ir.scope).toEqual({ anchor: 'Conversation', via: 'subgroupEntities', anchorId: 'c1' });
  });

  it('maps a multi-instance projection (limit > 1) to an aliased include with a page, not first', () => {
    const { ir, unsupported } = compileQuery({
      entity: 'Post',
      include: { $recentLikes: { from: 'signals', order: { createdAt: 'desc' }, limit: 5 } },
    });
    expect(unsupported).toEqual([]);
    expect(ir.include).toEqual({
      $recentLikes: { over: 'signals', sort: [{ by: 'createdAt', dir: 'desc' }], page: { limit: 5 } },
    });
    expect(ir.include!.$recentLikes).not.toHaveProperty('first');
  });
});

describe('irToFlatQuery', () => {
  it('maps aggregate → count projection and alias → single projection', () => {
    const legacy = irToFlatQuery({
      irVersion: 1,
      entity: 'Post',
      aggregate: [
        { as: '$likeCount', over: 'signals', fn: 'count', filter: { field: 'signalTypeId', op: 'eq', value: 'like' } },
      ],
      include: {
        author: true,
        $myLike: { over: 'signals', filter: { field: 'author', op: 'eq', value: 'did:me' }, first: true },
      },
    });
    expect(legacy.entity).toBe('Post');
    expect(legacy.include).toEqual({
      author: true,
      $myLike: { from: 'signals', where: { author: 'did:me' }, limit: 1 },
      $likeCount: { from: 'signals', count: true, where: { signalTypeId: 'like' } },
    });
  });

  it('throws on shapes needing adapter resolution or that AD4M cannot express (scope, op, rel-filter, non-count agg)', () => {
    // scope needs binding resolution — the adapter's job, not this translator
    expect(() => irToFlatQuery({ irVersion: 1, entity: 'Post', scope: { via: 'posts', anchorId: 'a1' } })).toThrow(
      /scope \(drill-down\)/,
    );
    expect(() =>
      irToFlatQuery({ irVersion: 1, entity: 'Post', filter: { field: 'likes', op: 'gt', value: 5 } }),
    ).toThrow(/operator "gt"/);
    expect(() => irToFlatQuery({ irVersion: 1, entity: 'Post', filter: { rel: 'signals', op: 'some' } })).toThrow(
      /relation filters/,
    );
    expect(() =>
      irToFlatQuery({
        irVersion: 1,
        entity: 'Post',
        aggregate: [{ as: 's', over: 'signals', fn: 'sum', field: 'value' }],
      }),
    ).toThrow(/aggregate fn "sum"/);
  });

  // The load-bearing guarantee the AD4M adapter rests on: crossing legacy → IR → legacy loses nothing,
  // proven by re-deriving the IR from the reconstructed legacy and getting the identical IR back.
  const samples: FlatQuery[] = [
    {
      entity: 'Post',
      where: { OR: [{ title: { contains: 'x' } }, { content: { contains: 'x' } }] },
      order: { createdAt: 'desc' },
      limit: 20,
      include: { author: true, comments: { where: { hidden: false }, order: { createdAt: 'asc' } } },
    },
    { entity: 'X', where: { a: 1, b: { not: 2 }, c: { not: [3, 4] }, d: { contains: 'z' }, e: { exists: true } } },
    {
      entity: 'Post',
      limit: 10,
      offset: 20,
      include: { $likeCount: { from: 'signals', count: true, where: { signalTypeId: 'like' } } },
    },
    { entity: 'Post', include: { $myLike: { from: 'signals', where: { author: 'did:me' }, limit: 1 } } },
    { entity: 'Post', subscribe: false, order: { createdAt: 'desc', title: 'asc' } },
    { entity: 'Channel', include: { conversations: { include: { messages: { limit: 20 } } } } },
  ];

  it('round-trips legacy → IR → legacy → IR without drift for every representative shape', () => {
    for (const legacy of samples) {
      const ir1 = compileQuery(legacy).ir;
      const ir2 = compileQuery(irToFlatQuery(ir1)).ir;
      expect(ir2).toEqual(ir1);
    }
  });
});

describe('whereUsesCombinator', () => {
  const irOf = (where: Record<string, unknown>) => compileQuery({ entity: 'Post', where }).ir;
  const filterOf = (where: Record<string, unknown>) => irOf(where).filter;
  const flatOf = (where: Record<string, unknown>) => irToFlatQuery(irOf(where));

  it('is false for an implicit conjunction — sibling where keys merge back to sibling keys', () => {
    // The regression this guards: `where: { a, b }` compiles to an `and` node, so testing
    // `'and' in filter` on the IR wrongly reports a combinator for the most ordinary query
    // shape there is — and that flagged a capability gap on every multi-key filter + sort.
    const where = { type: 'root', textContent: { contains: 'x' } };
    expect(filterOf(where)).toHaveProperty('and');
    expect(flatOf(where)).toMatchObject({ where: { type: 'root', textContent: { contains: 'x' } } });
    expect(whereUsesCombinator(filterOf(where))).toBe(false);
  });

  it('is false for a single field condition, and for no filter at all', () => {
    expect(whereUsesCombinator(filterOf({ type: 'root' }))).toBe(false);
    expect(whereUsesCombinator(undefined)).toBe(false);
  });

  it('is true for an explicit OR / NOT that survives lowering', () => {
    expect(whereUsesCombinator(filterOf({ OR: [{ a: 1 }, { b: 2 }] }))).toBe(true);
    expect(whereUsesCombinator(filterOf({ NOT: { a: 1 } }))).toBe(true);
  });

  it('is true for a conjunction that collides on a key (lowers to an explicit AND)', () => {
    // Same key on both branches cannot merge into sibling keys, so `whereFromFilter` emits `AND`.
    const where = { AND: [{ title: { contains: 'a' } }, { title: { contains: 'b' } }] };
    expect(flatOf(where)).toHaveProperty('where.AND');
    expect(whereUsesCombinator(filterOf(where))).toBe(true);
  });

  it('is true when a nested OR is merged in among sibling keys', () => {
    expect(whereUsesCombinator(filterOf({ type: 'root', OR: [{ a: 1 }, { b: 2 }] }))).toBe(true);
  });
});
