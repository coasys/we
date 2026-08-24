import { describe, expect, it } from 'vitest';

import { resolveProp } from './dispatcher';
import { markReactive } from './reactive';
import type { Props } from './types';

describe('$plural', () => {
  /**
   * A memo that hands back the thunk rather than calling it — what a framework injects.
   *
   * The default `noMemo` evaluates eagerly, so `$plural` resolves to a plain string there. Both are
   * correct and the tests below cover each: a non-reactive consumer sees what it always saw, and a
   * renderer gets an accessor that re-picks the word.
   */
  const keepThunk = (fn: () => unknown) => fn;

  it('picks the singular at one and the plural otherwise', () => {
    // Default eager memo: a plain string, as a non-reactive consumer has always seen.
    expect(resolveProp({ $plural: { count: 1, one: 'record', other: 'records' } }, {}, {})).toBe('record');
    expect(resolveProp({ $plural: { count: 4, one: 'record', other: 'records' } }, {}, {})).toBe('records');
    // Zero takes the plural, which is what English does: "0 records".
    expect(resolveProp({ $plural: { count: 0, one: 'record', other: 'records' } }, {}, {})).toBe('records');
  });

  it('re-picks the word when a live count changes', () => {
    /*
      The regression this exists for.

      `$plural` used to resolve its count once and return a plain string, so the word was chosen on
      first render and never revisited — while a sibling `{ $store: … }` printing the same count
      updated normally. A row that first appeared at one item read "2 extraction processed" and
      "2 Member": the number right, the noun frozen at whatever it was when the row appeared.

      Anything reading a live count was affected, which is most uses of this token — a plural exists
      to agree with a number, and a number worth pluralising usually changes.
    */
    let count = 1;
    const stores: Props = { s: { n: markReactive(() => count) } };
    const resolved = resolveProp(
      { $plural: { count: { $store: 's.n' }, one: 'record', other: 'records' } },
      stores,
      {},
      keepThunk,
    );

    expect(typeof resolved).toBe('function');
    expect((resolved as () => string)()).toBe('record');

    count = 2;
    expect((resolved as () => string)()).toBe('records');
  });

  it('reads a count that arrives through a context reference', () => {
    expect(resolveProp({ $plural: { count: '$row.n', one: 'record', other: 'records' } }, {}, { row: { n: 5 } })).toBe(
      'records',
    );
  });
});
