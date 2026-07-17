import { describe, expect, it } from 'vitest';

import { type LegacyQuery, translateLegacyQuery } from './legacyQuery';
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

  it('maps parent → scope drill-down and a single/filtered projection → an aliased include (no gaps)', () => {
    const { ir, unsupported } = translateLegacyQuery({
      model: 'Conversation',
      parent: { id: 'ch1', relation: 'conversations' },
      include: { $myLike: { from: 'signals', where: { author: 'did:me' }, limit: 1 } },
    });
    expect(unsupported).toEqual([]);
    // parent → scope (anchor type unknown from legacy, so left unset)
    expect(ir.scope).toEqual({ via: 'conversations', anchorId: 'ch1' });
    // $myLike → aliased include over `signals`, limit:1 → first, `$` kept so `$item.$myLike` still reads
    expect(ir.include).toEqual({
      $myLike: { over: 'signals', filter: { field: 'author', op: 'eq', value: 'did:me' }, first: true },
    });
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
