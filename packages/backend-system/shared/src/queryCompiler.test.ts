import { describe, expect, it } from 'vitest';

import { compileQuery, type FlatQuery, irToFlatQuery } from './queryCompiler';
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

  it('maps some/none to a relation quantifier rather than a comparison against an operator object', () => {
    // The IR has carried `{ rel, some/none }` from the start and no flat spelling could reach it, so
    // "posts with no comments" was not expressible at all — a caller fetched everything with its
    // children and counted in JS.
    expect(compileQuery({ entity: 'Post', where: { comments: { none: {} } } }).ir.filter).toEqual({
      rel: 'comments',
      op: 'none',
    });
    expect(compileQuery({ entity: 'Post', where: { comments: { some: { body: 'spam' } } } }).ir.filter).toEqual({
      rel: 'comments',
      op: 'some',
      where: { field: 'body', op: 'eq', value: 'spam' },
    });
  });

  it('reads a scalar operator object as a comparison, not a quantifier', () => {
    // The two are told apart by the operator name alone — this compiler takes no manifest — so a
    // key carrying `contains` stays a field compare even when it names something relation-shaped.
    expect(compileQuery({ entity: 'Post', where: { comments: { contains: 'x' } } }).ir.filter).toEqual({
      field: 'comments',
      op: 'contains',
      value: 'x',
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
  /**
   * The flag has to survive BOTH halves of the trip: the schema's `include` becoming an aggregate,
   * and the aggregate becoming the backend's flat projection. It was dropped in the first half and
   * the whole suite stayed green — a count that quietly means "direct children" where the caller
   * asked for "everything below" is a plausible number, so nothing downstream complains and no
   * assertion anywhere was about the flag.
   */
  it('carries `transitive` from an include projection through to the flat query', () => {
    const { ir } = compileQuery({
      entity: 'CollectionBlock',
      include: { $descendants: { from: 'comments', count: true, transitive: true } },
    });
    expect(ir.aggregate?.[0]).toMatchObject({ as: '$descendants', over: 'comments', transitive: true });

    const flat = irToFlatQuery(ir);
    expect((flat.include as Record<string, unknown>).$descendants).toMatchObject({
      from: 'comments',
      count: true,
      transitive: true,
    });
  });

  it('leaves an ordinary count projection alone', () => {
    const { ir } = compileQuery({ entity: 'Post', include: { $likes: { from: 'signals', count: true } } });
    expect(ir.aggregate?.[0]).not.toHaveProperty('transitive');
    expect((irToFlatQuery(ir).include as Record<string, unknown>).$likes).not.toHaveProperty('transitive');
  });

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

  it('throws on shapes needing adapter resolution or that the flat dialect cannot express (scope, op, rel-filter, non-count agg)', () => {
    // scope needs binding resolution — the adapter's job, not this translator
    expect(() => irToFlatQuery({ irVersion: 1, entity: 'Post', scope: { via: 'posts', anchorId: 'a1' } })).toThrow(
      /scope \(drill-down\)/,
    );
    // A range bound lowers now that the flat grammar has one; only whether the backend compares that
    // kind of bound natively is left to the adapter's plan.
    expect(
      irToFlatQuery({ irVersion: 1, entity: 'Post', filter: { field: 'likes', op: 'gt', value: 5 } }).where,
    ).toEqual({
      likes: { gt: 5 },
    });
    // A relation `exists` is the one quantifier with no flat spelling — `some`/`none` lower fine.
    expect(() => irToFlatQuery({ irVersion: 1, entity: 'Post', filter: { rel: 'signals', op: 'exists' } })).toThrow(
      /relation `exists`/,
    );
    expect(() =>
      irToFlatQuery({
        irVersion: 1,
        entity: 'Post',
        aggregate: [{ as: 's', over: 'signals', fn: 'sum', field: 'value' }],
      }),
    ).toThrow(/aggregate fn "sum"/);
  });

  // The load-bearing guarantee an adapter rests on: crossing legacy → IR → legacy loses nothing,
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
    // Relation quantifiers, which the flat dialect could not express at all until now: "has none",
    // "has at least one", and one whose nested clause is itself a compound where.
    { entity: 'Post', where: { comments: { none: {} } } },
    { entity: 'Post', where: { comments: { some: {} } } },
    { entity: 'Post', where: { comments: { some: { body: { contains: 'spam' }, hidden: false } } } },
    // Alongside a scalar condition, which is the shape a real feed uses.
    { entity: 'Post', where: { kind: 'post', signals: { some: { signalTypeId: 'like' } } }, limit: 20 },
  ];

  it('round-trips legacy → IR → legacy → IR without drift for every representative shape', () => {
    for (const legacy of samples) {
      const ir1 = compileQuery(legacy).ir;
      const ir2 = compileQuery(irToFlatQuery(ir1)).ir;
      expect(ir2).toEqual(ir1);
    }
  });
});

describe('lowering a where clause back to the flat dialect', () => {
  const irOf = (where: Record<string, unknown>) => compileQuery({ entity: 'Post', where }).ir;
  const flatOf = (where: Record<string, unknown>) => irToFlatQuery(irOf(where));

  it('merges an implicit conjunction back to sibling keys', () => {
    // `where: { a, b }` compiles to an `and` node and has to come back out as sibling keys rather
    // than an explicit AND — the most ordinary query shape there is, and the one a backend handles
    // natively. This used to matter for a sort degradation that is now gone; the merge itself is
    // still what keeps a round trip lossless.
    const where = { type: 'root', textContent: { contains: 'x' } };
    expect(irOf(where).filter).toHaveProperty('and');
    expect(flatOf(where)).toMatchObject({ where: { type: 'root', textContent: { contains: 'x' } } });
  });

  it('emits an explicit AND when the branches collide on a key', () => {
    // Same key on both branches cannot merge into sibling keys without one silently winning.
    expect(flatOf({ AND: [{ title: { contains: 'a' } }, { title: { contains: 'b' } }] })).toHaveProperty('where.AND');
  });
});

describe('range bounds', () => {
  it('compiles a single bound to its operator', () => {
    expect(compileQuery({ entity: 'TaskBlock', where: { dueDate: { lt: '2026-10-01' } } }).ir.filter).toEqual({
      field: 'dueDate',
      op: 'lt',
      value: '2026-10-01',
    });
  });

  it('compiles a pair of bounds on one field to a conjunction, not to whichever was read first', () => {
    const { ir, unsupported } = compileQuery({ entity: 'Listing', where: { price: { gte: 10, lt: 50 } } });
    expect(unsupported).toEqual([]);
    expect(ir.filter).toEqual({
      and: [
        { field: 'price', op: 'lt', value: 50 },
        { field: 'price', op: 'gte', value: 10 },
      ],
    });
    expect(validateQueryIR(ir).valid).toBe(true);
  });

  it('lowers a range back to one operator object beside its siblings', () => {
    const where = { status: 'todo', price: { gte: 10, lt: 50 } };
    expect(irToFlatQuery(compileQuery({ entity: 'Listing', where }).ir).where).toEqual({
      status: 'todo',
      price: { lt: 50, gte: 10 },
    });
  });
});
