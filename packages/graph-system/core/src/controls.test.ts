/**
 * The two controls that have a state.
 *
 * Every other control is a momentary action — zoom, fit, re-run the layout — so `active` and
 * `enabled` had nothing to describe and the renderer had nothing to draw. These are the reason both
 * exist, and the reason they are worth testing away from a browser: what a toggle *says about itself*
 * is as much of its behaviour as what it does, and it is the half that silently rots.
 */
import type { ControlContext } from '@we/graph-protocol';
import { describe, expect, it } from 'vitest';

import { lockControl, pinControl } from './controls';

function fakeContext(overrides: Partial<ControlContext> = {}) {
  const pinned = new Set<string>();
  let locked = false;
  const ctx: ControlContext = {
    zoomBy: () => undefined,
    fit: () => undefined,
    relayout: () => undefined,
    viewport: () => ({ x: 0, y: 0, zoom: 1, width: 800, height: 600 }),
    selection: () => [],
    isPinned: (id) => pinned.has(id),
    setPinned: (ids, next) => ids.forEach((id) => (next ? pinned.add(id) : pinned.delete(id))),
    isLocked: () => locked,
    setLocked: (next) => {
      locked = next;
    },
    ...overrides,
  };
  return { ctx, pinned };
}

describe('the pin control', () => {
  const control = pinControl();

  it('has nothing to act on with nothing selected', () => {
    const { ctx } = fakeContext();
    expect(control.enabled?.(ctx)).toBe(false);
  });

  it('holds the selection where it is', () => {
    const { ctx, pinned } = fakeContext({ selection: () => ['a', 'b'] });
    control.run(ctx);
    expect([...pinned]).toEqual(['a', 'b']);
    expect(control.active?.(ctx)).toBe(true);
  });

  it('releases a selection that is already held', () => {
    const { ctx, pinned } = fakeContext({ selection: () => ['a', 'b'] });
    control.run(ctx);
    control.run(ctx);
    expect([...pinned]).toEqual([]);
  });

  it('pins the rest of a partly held selection rather than releasing what is held', () => {
    // The reading that cannot lose work: someone who has pinned two of five and reaches for the
    // button is asking for the other three, not to undo the two.
    const { ctx, pinned } = fakeContext({ selection: () => ['a', 'b', 'c'] });
    ctx.setPinned(['a'], true);
    expect(control.active?.(ctx)).toBe(false);
    control.run(ctx);
    expect([...pinned].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('the lock control', () => {
  const control = lockControl();

  it('reports its own state, so the button can show it', () => {
    const { ctx } = fakeContext();
    expect(control.active?.(ctx)).toBe(false);
    control.run(ctx);
    expect(control.active?.(ctx)).toBe(true);
  });

  it('says what pressing it will do next, in both directions', () => {
    // A toggle whose tooltip describes its current state rather than its effect is the classic way to
    // make a lock ambiguous — "Locked" reads as both a status and an instruction.
    expect(control.title).toMatch(/^Lock/);
    expect(control.activeTitle).toMatch(/^Unlock/);
    expect(control.activeIcon).toBeDefined();
  });
});
