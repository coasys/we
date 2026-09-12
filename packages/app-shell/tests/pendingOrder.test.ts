/**
 * When an optimistic arrangement should be believed, and when it must stop being.
 *
 * Two rules, and neither is the obvious one.
 *
 * **Settling** is not "hold until the data equals what I wrote" — that hangs forever under a
 * concurrent drag, because an ordered relation on AD4M merges rather than replaces and the converged
 * answer can be neither party's list. It is "hold until the data has *moved* from what it read when
 * the write went out", which a peer winning satisfies as surely as your own write landing.
 *
 * **The baseline** it is measured against is not supplied at hold time but taken from the first
 * draw. Knowing it earlier would mean reading the record first, and the card sits visibly at its old
 * position for the whole of that read — which is the flash this exists to remove, in miniature.
 */
import { describe, expect, it } from 'vitest';

import {
  dropOrder,
  holdOrder,
  orderToDraw,
  PENDING_ORDER_TTL_MS,
  type PendingOrders,
  reconcileOrders,
} from '../src/shared/shapes/pendingOrder';

const T0 = 1_000_000;

const observedBy =
  (map: Record<string, string[]>) =>
  (recordId: string, relation: string): readonly string[] | undefined =>
    map[`${recordId}.${relation}`];

/** Held, then drawn once against `before` — which is how an entry acquires its baseline. */
const settled = (before: string[], ids: string[], at = T0): PendingOrders =>
  reconcileOrders(holdOrder({}, 'col-1', 'arranges', ids, at), observedBy({ 'col-1.arranges': before }), at);

describe('the moment it is held, before anything has been drawn', () => {
  it('is believed, because nothing can have answered a write issued this tick', () => {
    const pending = holdOrder({}, 'col-1', 'arranges', ['b', 'a'], T0);

    // Whatever the data says. It has not been consulted yet, and asking it would cost the round trip
    // this timing exists to avoid.
    expect(orderToDraw(pending, 'col-1', 'arranges', ['a', 'b'], T0)).toEqual(['b', 'a']);
    expect(orderToDraw(pending, 'col-1', 'arranges', ['q', 'z'], T0)).toEqual(['b', 'a']);
  });

  it('takes its baseline from the first draw', () => {
    const pending = reconcileOrders(
      holdOrder({}, 'col-1', 'arranges', ['b', 'a'], T0),
      observedBy({ 'col-1.arranges': ['a', 'b'] }),
      T0,
    );

    expect(pending['col-1.arranges'].before).toEqual(['a', 'b']);
  });

  it('does not take one from a draw that did not include the record', () => {
    const pending = reconcileOrders(holdOrder({}, 'col-1', 'arranges', ['b', 'a'], T0), observedBy({}), T0);

    expect(pending['col-1.arranges'].before).toBeUndefined();
  });
});

describe('while the write is in flight', () => {
  it('draws the order that was asked for, not the one that is stored', () => {
    expect(orderToDraw(settled(['a', 'b'], ['b', 'a']), 'col-1', 'arranges', ['a', 'b'], T0 + 50)).toEqual(['b', 'a']);
  });

  it('says nothing about a relation nobody arranged', () => {
    const pending = settled(['a', 'b'], ['b', 'a']);

    expect(orderToDraw(pending, 'col-2', 'arranges', ['x'], T0 + 50)).toBeUndefined();
    expect(orderToDraw(pending, 'col-1', 'children', ['x'], T0 + 50)).toBeUndefined();
  });

  it('keeps two arrangements on one record apart', () => {
    let pending = holdOrder({}, 'board-1', 'children', ['c2', 'c1'], T0);
    pending = holdOrder(pending, 'board-1', 'arranges', ['k2', 'k1'], T0);
    pending = reconcileOrders(
      pending,
      observedBy({ 'board-1.children': ['c1', 'c2'], 'board-1.arranges': ['k1', 'k2'] }),
      T0,
    );

    expect(orderToDraw(pending, 'board-1', 'children', ['c1', 'c2'], T0 + 1)).toEqual(['c2', 'c1']);
    expect(orderToDraw(pending, 'board-1', 'arranges', ['k1', 'k2'], T0 + 1)).toEqual(['k2', 'k1']);
  });
});

describe('when the answer arrives', () => {
  it('stops drawing the overlay as soon as the data moves', () => {
    expect(orderToDraw(settled(['a', 'b'], ['b', 'a']), 'col-1', 'arranges', ['b', 'a'], T0 + 900)).toBeUndefined();
  });

  it('stops even when the answer is not what was asked for — a peer won, and that is the truth', () => {
    // The case exact-equality settling gets wrong: this order is neither the baseline nor what was
    // written, and it is what the merge produced. Holding out for the latter would pin the card.
    expect(
      orderToDraw(settled(['a', 'b'], ['b', 'a']), 'col-1', 'arranges', ['a', 'c', 'b'], T0 + 900),
    ).toBeUndefined();
  });

  it('goes on drawing while the data still reads as it did — a push that carried something else', () => {
    // Subscriptions re-fire for reasons that have nothing to do with this column; on a real board the
    // fingerprint changed because `updatedAt` moved. A push whose order is unchanged is not the
    // answer to this write.
    expect(orderToDraw(settled(['a', 'b'], ['b', 'a']), 'col-1', 'arranges', ['a', 'b'], T0 + 900)).toEqual(['b', 'a']);
  });
});

describe('the backstop', () => {
  it('disbelieves an overlay that has stood too long, whatever the data says', () => {
    const pending = settled(['a', 'b'], ['b', 'a']);

    expect(orderToDraw(pending, 'col-1', 'arranges', ['a', 'b'], T0 + PENDING_ORDER_TTL_MS + 1)).toBeUndefined();
  });

  it('still believes it a moment before that', () => {
    const pending = settled(['a', 'b'], ['b', 'a']);

    expect(orderToDraw(pending, 'col-1', 'arranges', ['a', 'b'], T0 + PENDING_ORDER_TTL_MS - 1)).toEqual(['b', 'a']);
  });
});

describe('reconciling against what was drawn', () => {
  it('drops an entry the data has overtaken', () => {
    const next = reconcileOrders(
      settled(['a', 'b'], ['b', 'a']),
      observedBy({ 'col-1.arranges': ['b', 'a'] }),
      T0 + 900,
    );

    expect(next['col-1.arranges']).toBeUndefined();
  });

  it('keeps an entry the data has not caught up with', () => {
    const next = reconcileOrders(
      settled(['a', 'b'], ['b', 'a']),
      observedBy({ 'col-1.arranges': ['a', 'b'] }),
      T0 + 900,
    );

    expect(next['col-1.arranges']).toBeDefined();
  });

  it('keeps one belonging to a record that was not drawn this pass', () => {
    // Absence is not evidence: a column scrolled out of a filtered view is not a column whose write
    // has landed, and dropping the overlay on that would put the card back mid-flight.
    const next = reconcileOrders(settled(['a', 'b'], ['b', 'a']), observedBy({}), T0 + 900);

    expect(next['col-1.arranges']).toBeDefined();
  });

  it('drops one that has timed out even though nothing was drawn for it', () => {
    const next = reconcileOrders(settled(['a', 'b'], ['b', 'a']), observedBy({}), T0 + PENDING_ORDER_TTL_MS + 1);

    expect(next['col-1.arranges']).toBeUndefined();
  });

  it('returns the same object when nothing changed, so a signal does not re-render the world', () => {
    const pending = settled(['a', 'b'], ['b', 'a']);

    expect(reconcileOrders(pending, observedBy({ 'col-1.arranges': ['a', 'b'] }), T0 + 900)).toBe(pending);
  });

  it('splits the key at the last dot, so a record id containing one still resolves', () => {
    // AD4M ids are URIs; assuming the first dot is the separator would truncate one.
    const pending = holdOrder({}, 'ad4m://obj/a.b.c', 'arranges', ['x'], T0);
    const next = reconcileOrders(pending, observedBy({ 'ad4m://obj/a.b.c.arranges': ['y'] }), T0 + 1);

    expect(next['ad4m://obj/a.b.c.arranges'].before).toEqual(['y']);
  });

  it('compares orders element by element, not by joining them', () => {
    // A join is a comparison that is almost always right; the failure needs an id containing the
    // separator, which is exactly the kind nobody reproduces.
    const pending = reconcileOrders(
      holdOrder({}, 'col-1', 'arranges', ['z'], T0),
      observedBy({ 'col-1.arranges': ['a b', 'c'] }),
      T0,
    );

    expect(orderToDraw(pending, 'col-1', 'arranges', ['a', 'b c'], T0 + 1)).toBeUndefined();
    expect(orderToDraw(pending, 'col-1', 'arranges', ['a b', 'c'], T0 + 1)).toEqual(['z']);
  });
});

describe('dropping by hand', () => {
  it('forgets one relation and leaves the others', () => {
    let pending = holdOrder({}, 'col-1', 'arranges', ['b', 'a'], T0);
    pending = holdOrder(pending, 'col-2', 'arranges', ['d', 'c'], T0);
    pending = reconcileOrders(pending, observedBy({ 'col-1.arranges': ['a', 'b'], 'col-2.arranges': ['c', 'd'] }), T0);

    const next = dropOrder(pending, 'col-1', 'arranges');

    expect(orderToDraw(next, 'col-1', 'arranges', ['a', 'b'], T0 + 1)).toBeUndefined();
    expect(orderToDraw(next, 'col-2', 'arranges', ['c', 'd'], T0 + 1)).toEqual(['d', 'c']);
  });

  it('returns the same object when there was nothing to drop', () => {
    const pending = settled(['a', 'b'], ['b', 'a']);

    expect(dropOrder(pending, 'col-9', 'arranges')).toBe(pending);
  });
});
