import { describe, expect, it } from 'vitest';

import { pruneUnresolvedWhere, resolveQueryProp } from './query';

describe('resolveQueryProp', () => {
  it('passes a plain entity name through', () => {
    expect(resolveQueryProp({ $query: { entity: 'TaskBlock' } }).entity).toBe('TaskBlock');
  });

  /*
    An entity may be an expression, and this resolver must leave it alone.

    Resolving it needs stores and the row's bindings, which only the framework layer holds — the
    same reason `where` and `order` values travel through as tokens. Casting it to a string here is
    what it used to do, and it is why a feed could not list records of a type its author had never
    heard of: the name had to be known before the template ran.
  */
  it('leaves an expression entity unresolved, for the framework layer to answer', () => {
    const descriptor = resolveQueryProp({ $query: { entity: { $: 'target' }, limit: 5 } });
    expect(descriptor.entity).toEqual({ $: 'target' });
    // And nothing else about the query is disturbed by it.
    expect(descriptor.params).toEqual({ limit: 5 });
  });
});

describe('pruneUnresolvedWhere', () => {
  it('drops operator conditions whose operand is unresolved', () => {
    // The reload-into-a-space bug: currentDatasetCid not loaded yet →
    // { not: undefined } serialized as the empty condition {} → backend 500.
    expect(
      pruneUnresolvedWhere({
        url: { not: undefined },
        name: { contains: 'we' },
      }),
    ).toEqual({ name: { contains: 'we' } });
  });

  it('keeps null operands — null is a value, undefined is unresolved', () => {
    expect(pruneUnresolvedWhere({ deletedAt: null, author: { not: null } })).toEqual({
      deletedAt: null,
      author: { not: null },
    });
  });

  it('prunes inside OR/AND branches and drops emptied combinators', () => {
    expect(
      pruneUnresolvedWhere({
        OR: [{ name: { contains: 'x' } }, { description: { contains: undefined } }],
      }),
    ).toEqual({ OR: [{ name: { contains: 'x' } }] });

    expect(pruneUnresolvedWhere({ OR: [{ name: { contains: undefined } }] })).toBeUndefined();
  });

  it('prunes NOT clauses and bare undefined fields', () => {
    expect(pruneUnresolvedWhere({ NOT: { name: undefined }, status: 'open' })).toEqual({ status: 'open' });
    expect(pruneUnresolvedWhere({ id: undefined })).toBeUndefined();
  });

  it('keeps multi-operator objects partially when only one operand is unresolved', () => {
    expect(pruneUnresolvedWhere({ name: { contains: 'a', not: undefined } })).toEqual({
      name: { contains: 'a' },
    });
  });

  it('leaves fully resolved clauses untouched', () => {
    const where = {
      url: { not: 'cid-1' },
      OR: [{ name: { contains: '' } }, { description: { contains: '' } }],
    };
    expect(pruneUnresolvedWhere(where)).toEqual(where);
  });
});
