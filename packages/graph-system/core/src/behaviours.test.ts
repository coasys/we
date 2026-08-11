/**
 * Behaviour tests.
 *
 * Interactions are the part of this system nobody notices until they feel wrong, and "feels wrong" is
 * exactly what a test suite is bad at catching — so the ones worth pinning are the two that have a
 * precise, checkable definition: a drag preserves where you took hold, and a behaviour that claims an
 * event stops the ones behind it seeing it.
 */
import type { Behaviour, BehaviourContext, GraphEvent, Point } from '@we/graph-protocol';
import { describe, expect, it, vi } from 'vitest';

import { dispatchPointer, dragNodeBehaviour, panZoomBehaviour, selectBehaviour } from './behaviours';

/** A stand-in scene: one node at a known place, world coordinates equal to screen coordinates. */
function fakeContext(overrides: Partial<BehaviourContext> = {}) {
  const positions = new Map<string, Point>([['n1', { x: 100, y: 100 }]]);
  const events: GraphEvent[] = [];
  const pinned: { id: string; at: Point | null }[] = [];

  const ctx: BehaviourContext = {
    // A generous radius so a grab 20px off-centre is still a hit.
    hitTest: (at) => (Math.hypot(at.x - 100, at.y - 100) <= 30 ? ['n1'] : []),
    select: () => undefined,
    selection: () => [],
    expand: () => undefined,
    collapse: () => undefined,
    pin: (id, at) => {
      pinned.push({ id, at });
      if (at) positions.set(id, at);
    },
    positionOf: (id) => positions.get(id) ?? null,
    pan: () => undefined,
    zoomAt: () => undefined,
    toWorld: (at) => at,
    toScreen: (at) => at,
    emit: (event) => events.push(event),
    ...overrides,
  };
  return { ctx, events, pinned };
}

const at = (x: number, y: number) => ({ at: { x, y }, buttons: 1, shiftKey: false, metaKey: false });

describe('drag-node', () => {
  it('moves the node by the pointer delta, not to the pointer', () => {
    // Grab 20px right of centre and drag 50px. The node should end 50px along — *not* centred under
    // the cursor, which is the jump that reads as a glitch.
    const drag = dragNodeBehaviour();
    const { ctx, pinned } = fakeContext();

    drag.onPointerDown?.(at(120, 100), ctx);
    drag.onPointerMove?.(at(170, 100), ctx);

    expect(pinned.at(-1)?.at).toEqual({ x: 150, y: 100 });
  });

  it('keeps the offset for the whole drag', () => {
    const drag = dragNodeBehaviour();
    const { ctx, pinned } = fakeContext();

    drag.onPointerDown?.(at(80, 120), ctx);
    drag.onPointerMove?.(at(180, 220), ctx);
    drag.onPointerMove?.(at(280, 320), ctx);

    // Offset was (+20, -20) at grab; it must still be (+20, -20) at the end.
    expect(pinned.at(-1)?.at).toEqual({ x: 300, y: 300 });
  });

  it('reports where the node ended up, not where the pointer did', () => {
    const drag = dragNodeBehaviour({ pin: true });
    const { ctx, events } = fakeContext();

    drag.onPointerDown?.(at(120, 100), ctx);
    drag.onPointerMove?.(at(170, 100), ctx);
    drag.onPointerUp?.(at(170, 100), ctx);

    const dropped = events.find((e) => e.type === 'nodeDragEnd');
    // A board persists this: it has to be the node's position or every save is off by the grab offset.
    expect(dropped && 'position' in dropped && dropped.position).toEqual({ x: 150, y: 100 });
  });

  it('releases the pin on drop unless asked to keep it', () => {
    const explorer = dragNodeBehaviour();
    const { ctx, pinned } = fakeContext();
    explorer.onPointerDown?.(at(100, 100), ctx);
    explorer.onPointerMove?.(at(140, 100), ctx);
    explorer.onPointerUp?.(at(140, 100), ctx);
    // Left pinned, a dragged node fights the layout on every later expansion.
    expect(pinned.at(-1)?.at).toBeNull();

    const board = dragNodeBehaviour({ pin: true });
    const second = fakeContext();
    board.onPointerDown?.(at(100, 100), second.ctx);
    board.onPointerMove?.(at(140, 100), second.ctx);
    board.onPointerUp?.(at(140, 100), second.ctx);
    expect(second.pinned.at(-1)?.at).not.toBeNull();
  });

  it('ignores a press that did not land on a node', () => {
    const drag = dragNodeBehaviour();
    const { ctx, pinned } = fakeContext();

    drag.onPointerDown?.(at(500, 500), ctx);
    drag.onPointerMove?.(at(520, 520), ctx);

    expect(pinned).toEqual([]);
  });
});

describe('dispatch order', () => {
  it('stops at the first behaviour that claims the event', () => {
    // How drag-node takes precedence over pan-canvas without either knowing the other exists.
    const { ctx } = fakeContext();
    const later = { id: 'later', onPointerDown: vi.fn() } satisfies Behaviour;

    dispatchPointer([dragNodeBehaviour(), later], 'onPointerDown', at(100, 100), ctx);

    expect(later.onPointerDown).not.toHaveBeenCalled();
  });

  it('falls through when the first behaviour passes', () => {
    const { ctx } = fakeContext();
    const later = { id: 'later', onPointerDown: vi.fn() } satisfies Behaviour;

    // Nothing under the pointer, so drag-node declines and pan gets its turn.
    dispatchPointer([dragNodeBehaviour(), later], 'onPointerDown', at(500, 500), ctx);

    expect(later.onPointerDown).toHaveBeenCalled();
  });

  it('lets pan-zoom claim only the background', () => {
    const { ctx } = fakeContext();
    const pan = panZoomBehaviour();

    expect(pan.onPointerDown?.(at(100, 100), ctx)).not.toBe(true);
    expect(pan.onPointerDown?.(at(500, 500), ctx)).toBe(true);
  });
});

describe('select', () => {
  it('does not treat the end of a drag as a click', () => {
    const select = selectBehaviour();
    const selected: string[][] = [];
    const { ctx } = fakeContext({ select: (ids) => selected.push(ids) });

    select.onPointerDown?.(at(100, 100), ctx);
    select.onPointerUp?.(at(160, 100), ctx);

    expect(selected).toEqual([]);
  });

  it('selects on a press and release in the same place', () => {
    const select = selectBehaviour();
    const selected: string[][] = [];
    const { ctx } = fakeContext({ select: (ids) => selected.push(ids) });

    select.onPointerDown?.(at(100, 100), ctx);
    select.onPointerUp?.(at(101, 100), ctx);

    expect(selected).toEqual([['n1']]);
  });
});
