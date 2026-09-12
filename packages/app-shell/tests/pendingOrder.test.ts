/**
 * When an optimistic arrangement should be believed, and when it must stop being.
 *
 * The rule that matters is the settling one, and it is not the obvious one. "Hold until the data
 * equals what I wrote" hangs forever under a concurrent drag, because an ordered relation on AD4M
 * merges rather than replaces and the converged answer can be neither party's list. So these pin the
 * rule that is actually used — the data has *moved* from what it read when the write was issued —
 * and the cases where that differs visibly from equality.
 */
import { describe, expect, it } from 'vitest';

import {
  dropOrder,
  holdOrder,
  orderToDraw,
  PENDING_ORDER_TTL_MS,
  type PendingOrders,
  spentOrders,
} from '../src/shared/shapes/pendingOrder';

const T0 = 1_000_000;
const held = (before: string[], ids: string[]): PendingOrders => holdOrder({}, 'col-1', 'arranges', ids, before, T0);

describe('while the write is in flight', () => {
  it('draws the order that was asked for, not the one that is stored', () => {
    const pending = held(['a', 'b'], ['b', 'a']);

    expect(orderToDraw(pending, 'col-1', 'arranges', ['a', 'b'], T0 + 50)).toEqual(['b', 'a']);
  });

  it('says nothing about a relation nobody arranged', () => {
    const pending = held(['a', 'b'], ['b', 'a']);

    expect(orderToDraw(pending, 'col-2', 'arranges', ['x'], T0 + 50)).toBeUndefined();
    expect(orderToDraw(pending, 'col-1', 'children', ['x'], T0 + 50)).toBeUndefined();
  });

  it('keeps two arrangements on one record apart', () => {
    let pending = holdOrder({}, 'board-1', 'children', ['c2', 'c1'], ['c1', 'c2'], T0);
    pending = holdOrder(pending, 'board-1', 'arranges', ['k2', 'k1'], ['k1', 'k2'], T0);

    expect(orderToDraw(pending, 'board-1', 'children', ['c1', 'c2'], T0 + 1)).toEqual(['c2', 'c1']);
    expect(orderToDraw(pending, 'board-1', 'arranges', ['k1', 'k2'], T0 + 1)).toEqual(['k2', 'k1']);
  });
});

describe('when the answer arrives', () => {
  it('stops drawing the overlay as soon as the data moves', () => {
    const pending = held(['a', 'b'], ['b', 'a']);

    expect(orderToDraw(pending, 'col-1', 'arranges', ['b', 'a'], T0 + 900)).toBeUndefined();
  });

  it('stops even when the answer is not what was asked for — a peer won, and that is the truth', () => {
    // The case exact-equality settling gets wrong: this order is neither `before` nor `ids`, and it
    // is what the merge produced. Holding out for `ids` here would pin the card indefinitely.
    const pending = held(['a', 'b'], ['b', 'a']);

    expect(orderToDraw(pending, 'col-1', 'arranges', ['a', 'c', 'b'], T0 + 900)).toBeUndefined();
  });

  it('goes on drawing while the data still reads as it did — a push that carried something else', () => {
    // Subscriptions re-fire for reasons that have nothing to do with this column. A push whose
    // `arranges` is unchanged is not the answer to this write and must not release the overlay.
    const pending = held(['a', 'b'], ['b', 'a']);

    expect(orderToDraw(pending, 'col-1', 'arranges', ['a', 'b'], T0 + 900)).toEqual(['b', 'a']);
  });
});

describe('the backstop', () => {
  it('disbelieves an overlay that has stood too long, whatever the data says', () => {
    const pending = held(['a', 'b'], ['b', 'a']);

    expect(orderToDraw(pending, 'col-1', 'arranges', ['a', 'b'], T0 + PENDING_ORDER_TTL_MS + 1)).toBeUndefined();
  });

  it('still believes it a moment before that', () => {
    const pending = held(['a', 'b'], ['b', 'a']);

    expect(orderToDraw(pending, 'col-1', 'arranges', ['a', 'b'], T0 + PENDING_ORDER_TTL_MS - 1)).toEqual(['b', 'a']);
  });
});

describe('reporting what is spent', () => {
  const observedBy = (map: Record<string, string[]>) => (recordId: string, relation: string) =>
    map[`${recordId}.${relation}`];

  it('names an entry the data has overtaken', () => {
    const pending = held(['a', 'b'], ['b', 'a']);

    expect(spentOrders(pending, observedBy({ 'col-1.arranges': ['b', 'a'] }), T0 + 900)).toEqual([
      { recordId: 'col-1', relation: 'arranges' },
    ]);
  });

  it('leaves an entry the data has not caught up with', () => {
    const pending = held(['a', 'b'], ['b', 'a']);

    expect(spentOrders(pending, observedBy({ 'col-1.arranges': ['a', 'b'] }), T0 + 900)).toEqual([]);
  });

  it('says nothing about a record that was not drawn this pass', () => {
    // Absence is not evidence: a column scrolled out of a filtered view is not a column whose write
    // has landed, and dropping the overlay on that would put the card back mid-flight.
    const pending = held(['a', 'b'], ['b', 'a']);

    expect(spentOrders(pending, observedBy({}), T0 + 900)).toEqual([]);
  });

  it('names one that has timed out even though nothing was drawn for it', () => {
    const pending = held(['a', 'b'], ['b', 'a']);

    expect(spentOrders(pending, observedBy({}), T0 + PENDING_ORDER_TTL_MS + 1)).toEqual([
      { recordId: 'col-1', relation: 'arranges' },
    ]);
  });

  it('splits the key at the last dot, so a record id containing one still resolves', () => {
    // AD4M ids are URIs; assuming the first dot is the separator would truncate one.
    const pending = holdOrder({}, 'ad4m://obj/a.b.c', 'arranges', ['x'], ['y'], T0);

    expect(spentOrders(pending, observedBy({ 'ad4m://obj/a.b.c.arranges': ['x'] }), T0 + 1)).toEqual([
      { recordId: 'ad4m://obj/a.b.c', relation: 'arranges' },
    ]);
  });
});

describe('dropping by hand', () => {
  it('forgets one relation and leaves the others', () => {
    let pending = holdOrder({}, 'col-1', 'arranges', ['b', 'a'], ['a', 'b'], T0);
    pending = holdOrder(pending, 'col-2', 'arranges', ['d', 'c'], ['c', 'd'], T0);

    const next = dropOrder(pending, 'col-1', 'arranges');

    expect(orderToDraw(next, 'col-1', 'arranges', ['a', 'b'], T0 + 1)).toBeUndefined();
    expect(orderToDraw(next, 'col-2', 'arranges', ['c', 'd'], T0 + 1)).toEqual(['d', 'c']);
  });

  it('returns the same object when there was nothing to drop, so a signal does not re-render', () => {
    const pending = held(['a', 'b'], ['b', 'a']);

    expect(dropOrder(pending, 'col-9', 'arranges')).toBe(pending);
  });
});
