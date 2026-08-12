import { describe, expect, it } from 'vitest';

import { pruneUnresolvedWhere } from './query';

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
