import { describe, expect, it } from 'vitest';

import { translateLegacyQuery, type LegacyQuery } from './legacyQuery';
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
    const { ir } = translateLegacyQuery({ model: 'Post', subscribe: false, perspective: 'adamStore.currentPerspective' });
    expect(ir.live).toBe(false);
    expect('perspective' in ir).toBe(false);
  });

  it('surfaces the shapes that need a design decision before wiring (parent, single-projection)', () => {
    const { unsupported } = translateLegacyQuery({
      model: 'Conversation',
      parent: { id: 'ch1', relation: 'conversations' },
      include: { $myLike: { from: 'signals', where: { author: 'did:me' }, limit: 1 } },
    });
    expect(unsupported).toContainEqual(expect.stringContaining('parent'));
    expect(unsupported).toContainEqual(expect.stringContaining('single/filtered projection'));
  });
});
