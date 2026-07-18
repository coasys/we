import { describe, expect, it } from 'vitest';

import { irToLegacyQuery, type LegacyQuery, translateLegacyQuery } from './legacyQuery';
import { validateQueryIR } from './queryIR';

describe('translateLegacyQuery', () => {
  it('translates a common feed query cleanly (model/where-OR/order/limit/include) with no gaps', () => {
    const legacy: LegacyQuery = {
      model: 'Post',
      where: { OR: [{ title: { contains: 'graph' } }, { content: { contains: 'graph' } }] },
      order: { createdAt: 'desc' },
      limit: 20,
      include: { author: true, comments: { where: { hidden: false }, order: { createdAt: 'asc' } } },
    };
    const { ir, unsupported } = translateLegacyQuery(legacy);
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
    const { ir } = translateLegacyQuery({
      model: 'X',
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
    const { ir, unsupported } = translateLegacyQuery({
      model: 'Post',
      include: { $likeCount: { from: 'signals', count: true, where: { signalTypeId: 'like' } } },
    });
    expect(unsupported).toEqual([]);
    expect(ir.aggregate).toEqual([
      { as: '$likeCount', over: 'signals', fn: 'count', filter: { field: 'signalTypeId', op: 'eq', value: 'like' } },
    ]);
    expect(ir.include).toBeUndefined();
  });

  it('records subscribe:false as one-shot, and drops perspective', () => {
    const { ir } = translateLegacyQuery({
      model: 'Post',
      subscribe: false,
      perspective: 'adamStore.currentPerspective',
    });
    expect(ir.live).toBe(false);
    expect('perspective' in ir).toBe(false);
  });

  it('flags parent (drill-down) as needing an anchor type, while a single/filtered projection still maps', () => {
    const { ir, unsupported } = translateLegacyQuery({
      model: 'Conversation',
      parent: { id: 'ch1', relation: 'conversations' },
      include: { $myLike: { from: 'signals', where: { author: 'did:me' }, limit: 1 } },
    });
    // parent can't become a neutral scope without the anchor *type* → flagged, no scope emitted
    expect(unsupported).toContainEqual(expect.stringContaining('parent (drill-down)'));
    expect(ir.scope).toBeUndefined();
    // the single/filtered projection still maps losslessly, `$` kept so `$item.$myLike` still reads
    expect(ir.include).toEqual({
      $myLike: { over: 'signals', filter: { field: 'author', op: 'eq', value: 'did:me' }, first: true },
    });
  });

  it('flags the raw-predicate parent form too (the AD4M-physical escape hatch)', () => {
    const { unsupported } = translateLegacyQuery({
      model: 'ConversationSubgroup',
      parent: { id: 'c1', predicate: 'ad4m://has_child' },
    });
    expect(unsupported).toContainEqual(expect.stringContaining('parent (drill-down)'));
  });

  it('maps a multi-instance projection (limit > 1) to an aliased include with a page, not first', () => {
    const { ir, unsupported } = translateLegacyQuery({
      model: 'Post',
      include: { $recentLikes: { from: 'signals', order: { createdAt: 'desc' }, limit: 5 } },
    });
    expect(unsupported).toEqual([]);
    expect(ir.include).toEqual({
      $recentLikes: { over: 'signals', sort: [{ by: 'createdAt', dir: 'desc' }], page: { limit: 5 } },
    });
    expect(ir.include!.$recentLikes).not.toHaveProperty('first');
  });
});

describe('irToLegacyQuery', () => {
  it('maps aggregate → count projection and alias → single projection', () => {
    const legacy = irToLegacyQuery({
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
    expect(legacy.model).toBe('Post');
    expect(legacy.include).toEqual({
      author: true,
      $myLike: { from: 'signals', where: { author: 'did:me' }, limit: 1 },
      $likeCount: { from: 'signals', count: true, where: { signalTypeId: 'like' } },
    });
  });

  it('throws on shapes needing adapter resolution or that AD4M cannot express (scope, op, rel-filter, non-count agg)', () => {
    // scope needs binding resolution — the adapter's job, not this translator
    expect(() => irToLegacyQuery({ irVersion: 1, entity: 'Post', scope: { via: 'posts', anchorId: 'a1' } })).toThrow(
      /scope \(drill-down\)/,
    );
    expect(() =>
      irToLegacyQuery({ irVersion: 1, entity: 'Post', filter: { field: 'likes', op: 'gt', value: 5 } }),
    ).toThrow(/operator "gt"/);
    expect(() => irToLegacyQuery({ irVersion: 1, entity: 'Post', filter: { rel: 'signals', op: 'some' } })).toThrow(
      /relation filters/,
    );
    expect(() =>
      irToLegacyQuery({
        irVersion: 1,
        entity: 'Post',
        aggregate: [{ as: 's', over: 'signals', fn: 'sum', field: 'value' }],
      }),
    ).toThrow(/aggregate fn "sum"/);
  });

  // The load-bearing guarantee the AD4M adapter rests on: crossing legacy → IR → legacy loses nothing,
  // proven by re-deriving the IR from the reconstructed legacy and getting the identical IR back.
  const samples: LegacyQuery[] = [
    {
      model: 'Post',
      where: { OR: [{ title: { contains: 'x' } }, { content: { contains: 'x' } }] },
      order: { createdAt: 'desc' },
      limit: 20,
      include: { author: true, comments: { where: { hidden: false }, order: { createdAt: 'asc' } } },
    },
    { model: 'X', where: { a: 1, b: { not: 2 }, c: { not: [3, 4] }, d: { contains: 'z' }, e: { exists: true } } },
    {
      model: 'Post',
      limit: 10,
      offset: 20,
      include: { $likeCount: { from: 'signals', count: true, where: { signalTypeId: 'like' } } },
    },
    { model: 'Post', include: { $myLike: { from: 'signals', where: { author: 'did:me' }, limit: 1 } } },
    { model: 'Post', subscribe: false, order: { createdAt: 'desc', title: 'asc' } },
    { model: 'Channel', include: { conversations: { include: { messages: { limit: 20 } } } } },
  ];

  it('round-trips legacy → IR → legacy → IR without drift for every representative shape', () => {
    for (const legacy of samples) {
      const ir1 = translateLegacyQuery(legacy).ir;
      const ir2 = translateLegacyQuery(irToLegacyQuery(ir1)).ir;
      expect(ir2).toEqual(ir1);
    }
  });
});
