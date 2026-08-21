/**
 * When to stop believing an optimistic write.
 *
 * The pending map is what lets a board card change on the gesture rather than on the round trip, and
 * the only hard part is letting go of it at the right moment. Too early and the card flicks back to
 * the old value for as long as the write takes; too late and it keeps showing something that never
 * got stored.
 */
import { confirmPending, dropPending, holdPending } from '@shared/shapes/pendingWrites';
import { describe, expect, it } from 'vitest';

const byNode = (row: Record<string, unknown>) => (typeof row.node === 'string' ? row.node : undefined);

describe('confirmPending', () => {
  it('drops a patch a row confirms', () => {
    const pending = { c1: { width: 320, color: 'warning-100' } };

    const next = confirmPending(pending, [{ node: 'c1', width: 320, color: 'warning-100' }], byNode);

    expect(next).toEqual({});
  });

  it('keeps a patch a row only half confirms', () => {
    // A read that has caught up on the colour but not the size is still a read the optimistic size
    // is needed for — clearing here would put the old width back until the rest arrived.
    const pending = { c1: { width: 320, color: 'warning-100' } };

    const next = confirmPending(pending, [{ node: 'c1', width: 180, color: 'warning-100' }], byNode);

    expect(next).toEqual(pending);
  });

  it('ignores rows for records with nothing pending', () => {
    const pending = { c1: { width: 320 } };

    expect(confirmPending(pending, [{ node: 'c2', width: 999 }], byNode)).toEqual(pending);
  });

  it('ignores a row it cannot identify', () => {
    // A placement whose node never linked names no record, so it can confirm nothing.
    const pending = { c1: { width: 320 } };

    expect(confirmPending(pending, [{ width: 320 }], byNode)).toEqual(pending);
  });

  it('returns the same object when nothing changed', () => {
    // A signal set from this runs on every read the graph makes; a fresh object each time would
    // re-render every card on a board whose data had not moved.
    const pending = { c1: { width: 320 } };

    expect(confirmPending(pending, [{ node: 'c1', width: 180 }], byNode)).toBe(pending);
  });

  it('confirms one record without touching another still in flight', () => {
    const pending = { c1: { width: 320 }, c2: { color: 'danger-100' } };

    const next = confirmPending(pending, [{ node: 'c1', width: 320 }], byNode);

    expect(next).toEqual({ c2: { color: 'danger-100' } });
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
