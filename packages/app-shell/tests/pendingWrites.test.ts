/**
 * When to stop believing an optimistic write.
 *
 * The pending map is what lets a board card change on the gesture rather than on the round trip, and
 * the only hard part is letting go of it at the right moment. Too early and the card flicks back to
 * the old value for as long as the write takes; too late and it keeps showing something that never
 * got stored.
 */
import { dropAllPending, dropPending, holdPending } from '@shared/shapes/pendingWrites';
import { describe, expect, it } from 'vitest';

describe('dropAllPending', () => {
  it('forgets the records it is given and leaves the rest', () => {
    const pending = { c1: { width: 320 }, c2: { color: 'danger-100' } };

    expect(dropAllPending(pending, ['c1'])).toEqual({ c2: { color: 'danger-100' } });
  });

  it('ignores an id with nothing pending', () => {
    const pending = { c1: { width: 320 } };

    expect(dropAllPending(pending, ['c2'])).toEqual(pending);
  });

  it('returns the same object when nothing changed', () => {
    // This runs whenever the graph draws; a fresh object each time would re-render every card on a
    // board whose data had not moved.
    const pending = { c1: { width: 320 } };

    expect(dropAllPending(pending, ['c2'])).toBe(pending);
  });

  it('forgets several at once', () => {
    expect(dropAllPending({ c1: { width: 1 }, c2: { width: 2 }, c3: { width: 3 } }, ['c1', 'c3'])).toEqual({
      c2: { width: 2 },
    });
  });
});

describe('holdPending', () => {
  it('merges with what is already in flight for that record', () => {
    // Two gestures in a row — resize then recolour — must not have the second forget the first, or
    // the card would snap back to its old size while the colour write was still out.
    const held = holdPending({ c1: { width: 320 } }, 'c1', { color: 'warning-100' });

    expect(held.c1).toEqual({ width: 320, color: 'warning-100' });
  });

  it('replaces a field written twice', () => {
    expect(holdPending({ c1: { width: 320 } }, 'c1', { width: 400 }).c1).toEqual({ width: 400 });
  });
});

describe('dropPending', () => {
  it('forgets one record and leaves the rest', () => {
    expect(dropPending({ c1: { width: 320 }, c2: { width: 400 } }, 'c1')).toEqual({ c2: { width: 400 } });
  });

  it('returns the same object for a record with nothing pending', () => {
    const pending = { c1: { width: 320 } };
    expect(dropPending(pending, 'c2')).toBe(pending);
  });
});
