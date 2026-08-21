import type { BehaviourContext, PointerInput } from '@we/graph-protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  canvasDoubleClickBehaviour,
  connectNodesBehaviour,
  dispatchPointer,
  dragNodeBehaviour,
  panZoomBehaviour,
  selectBehaviour,
} from './behaviours';

/** A behaviour context whose world is one node ('n1') at (100, 100) with radius 20. */
function fakeContext(overrides: Partial<BehaviourContext> = {}): BehaviourContext {
  const positions = new Map([
    ['n1', { x: 100, y: 100 }],
    ['n2', { x: 300, y: 100 }],
  ]);
  // Annotated and merged rather than cast. Spreading a `Partial` into the literal makes every
  // property possibly-undefined, which is what the `as unknown as` here used to paper over — and
  // that cast also destroyed the contextual typing, so every callback parameter below was an
  // implicit `any` and the fake was free to drift from the interface it stands in for.
  const base: BehaviourContext = {
    hitTest: (at) => {
      for (const [id, p] of positions) {
        if (Math.hypot(p.x - at.x, p.y - at.y) <= 20) return [id];
      }
      return [];
    },
    hitTestEdge: () => null,
    toWorld: (p) => p, // identity camera keeps the arithmetic readable
    positionOf: (id) => positions.get(id) ?? null,
    pan: vi.fn(),
    zoomAt: vi.fn(),
    pin: vi.fn(),
    select: vi.fn(),
    expand: vi.fn(),
    emit: vi.fn(),
    locked: () => false,
    // Three the fake had simply never implemented. Nothing complained, because the cast said the
    // object was a `BehaviourContext` and TypeScript believed it; a behaviour reaching for any of
    // them in a test would have thrown at the call rather than failed to compile.
    selection: () => [],
    collapse: vi.fn(),
    toScreen: (p) => p,
    drawConnection: vi.fn(),
  };
  return Object.assign(base, overrides);
}

function input(x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput {
  // `metaKey` was missing, which the cast hid: the fake did not satisfy the interface it claimed.
  const base: PointerInput = { at: { x, y }, buttons: 1, shiftKey: false, metaKey: false };
  return Object.assign(base, extra);
}

describe('panZoomBehaviour', () => {
  it('claims background presses and pans by the pointer delta', () => {
    const ctx = fakeContext();
    const behaviour = panZoomBehaviour();

    expect(behaviour.onPointerDown!(input(0, 0), ctx)).toBe(true);
    behaviour.onPointerMove!(input(30, 10), ctx);
    expect(ctx.pan).toHaveBeenCalledWith(30, 10);
  });

  it('refuses presses on a node', () => {
    const ctx = fakeContext();
    const behaviour = panZoomBehaviour();
    expect(behaviour.onPointerDown!(input(100, 100), ctx)).toBeUndefined();
    behaviour.onPointerMove!(input(130, 110), ctx);
    expect(ctx.pan).not.toHaveBeenCalled();
  });

  it('zooms exponentially about the cursor', () => {
    const ctx = fakeContext();
    panZoomBehaviour({ zoomSpeed: 0.001 }).onWheel!(input(50, 50, { delta: -100 }), ctx);
    expect(ctx.zoomAt).toHaveBeenCalledWith({ x: 50, y: 50 }, Math.exp(0.1));
  });
});

describe('dragNodeBehaviour', () => {
  it('preserves the grab offset so the node moves with the hand', () => {
    const ctx = fakeContext();
    const behaviour = dragNodeBehaviour();

    // Grab the node near its edge (115,100) — 15 to the right of centre.
    expect(behaviour.onPointerDown!(input(115, 100), ctx)).toBe(true);
    behaviour.onPointerMove!(input(215, 150), ctx);
    // The node's centre keeps the same offset from the pointer: (215-15, 150-0).
    expect(ctx.pin).toHaveBeenCalledWith('n1', { x: 200, y: 150 });
  });

  it('releases the pin on drop unless pin: true, and emits where the node ended up', () => {
    const ctx = fakeContext();
    const behaviour = dragNodeBehaviour();
    behaviour.onPointerDown!(input(100, 100), ctx);
    behaviour.onPointerMove!(input(150, 100), ctx);
    behaviour.onPointerUp!(input(150, 100), ctx);

    expect(ctx.pin).toHaveBeenLastCalledWith('n1', null);
    expect(ctx.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'nodeDragEnd', position: { x: 150, y: 100 } }),
    );

    const pinned = fakeContext();
    const board = dragNodeBehaviour({ pin: true });
    board.onPointerDown!(input(100, 100), pinned);
    board.onPointerMove!(input(150, 100), pinned);
    board.onPointerUp!(input(150, 100), pinned);
    expect(pinned.pin).not.toHaveBeenCalledWith('n1', null);
  });

  it('a click without movement emits nothing', () => {
    const ctx = fakeContext();
    const behaviour = dragNodeBehaviour();
    behaviour.onPointerDown!(input(100, 100), ctx);
    behaviour.onPointerUp!(input(100, 100), ctx);
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it('drops the drag when no button is held (pointer left the window)', () => {
    const ctx = fakeContext();
    const behaviour = dragNodeBehaviour();
    behaviour.onPointerDown!(input(100, 100), ctx);
    behaviour.onPointerMove!(input(150, 100, { buttons: 0 }), ctx);
    expect(ctx.pin).not.toHaveBeenCalled();
  });

  it('refuses to start while the engine is locked', () => {
    const ctx = fakeContext({ locked: () => true });
    expect(dragNodeBehaviour().onPointerDown!(input(100, 100), ctx)).toBeUndefined();
  });
});

describe('selectBehaviour', () => {
  it('click selects, shift-click toggles, background clears', () => {
    const ctx = fakeContext();
    const behaviour = selectBehaviour();

    behaviour.onPointerDown!(input(100, 100), ctx);
    behaviour.onPointerUp!(input(100, 100), ctx);
    expect(ctx.select).toHaveBeenCalledWith(['n1'], 'replace');
    expect(ctx.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'nodeClick' }));

    behaviour.onPointerDown!(input(100, 100, { shiftKey: true }), ctx);
    behaviour.onPointerUp!(input(100, 100, { shiftKey: true }), ctx);
    expect(ctx.select).toHaveBeenLastCalledWith(['n1'], 'toggle');

    behaviour.onPointerDown!(input(0, 0), ctx);
    behaviour.onPointerUp!(input(0, 0), ctx);
    expect(ctx.select).toHaveBeenLastCalledWith([]);
  });

  it('a drag that ends on a node is not a click on it', () => {
    const ctx = fakeContext();
    const behaviour = selectBehaviour();
    behaviour.onPointerDown!(input(100, 100), ctx);
    behaviour.onPointerUp!(input(160, 100), ctx); // travelled 60px
    expect(ctx.select).not.toHaveBeenCalled();
  });
});

describe('connectNodesBehaviour', () => {
  it('emits both ends when a drag lands on another node', () => {
    const ctx = fakeContext();
    const behaviour = connectNodesBehaviour();

    behaviour.onPointerDown?.(input(100, 100), ctx);
    behaviour.onPointerMove?.(input(200, 100), ctx);
    behaviour.onPointerUp?.(input(300, 100), ctx);

    expect(ctx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'edgeCreate',
        source: expect.objectContaining({ id: 'n1' }),
        target: expect.objectContaining({ id: 'n2' }),
      }),
    );
  });

  it('follows the pointer while dragging, and takes the line down at the end', () => {
    // A drag with nothing following the pointer is the difference between a gesture and a guess.
    const ctx = fakeContext();
    const behaviour = connectNodesBehaviour();

    behaviour.onPointerDown?.(input(100, 100), ctx);
    behaviour.onPointerMove?.(input(220, 140), ctx);
    expect(ctx.drawConnection).toHaveBeenCalledWith('n1', { x: 220, y: 140 });

    behaviour.onPointerUp?.(input(300, 100), ctx);
    expect(ctx.drawConnection).toHaveBeenLastCalledWith(null);
  });

  it('says nothing when the drag ends on empty canvas', () => {
    // An abandoned gesture must not open a dialog about a connection nobody made.
    const ctx = fakeContext();
    const behaviour = connectNodesBehaviour();

    behaviour.onPointerDown?.(input(100, 100), ctx);
    behaviour.onPointerUp?.(input(700, 700), ctx);

    expect(ctx.emit).not.toHaveBeenCalled();
    expect(ctx.drawConnection).toHaveBeenLastCalledWith(null);
  });

  it('refuses to connect a node to itself', () => {
    const ctx = fakeContext();
    const behaviour = connectNodesBehaviour();

    behaviour.onPointerDown?.(input(100, 100), ctx);
    behaviour.onPointerUp?.(input(105, 105), ctx);

    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it('claims nothing when disarmed, so the press reaches drag-node', () => {
    const ctx = fakeContext();
    const behaviour = connectNodesBehaviour({ armed: false });

    expect(behaviour.onPointerDown?.(input(100, 100), ctx)).toBeUndefined();
  });

  it('drops the gesture when no button is held', () => {
    // A dropped pointer-up otherwise leaves a line following the cursor around the canvas.
    const ctx = fakeContext();
    const behaviour = connectNodesBehaviour();

    behaviour.onPointerDown?.(input(100, 100), ctx);
    behaviour.onPointerMove?.(input(200, 100, { buttons: 0 }), ctx);
    behaviour.onPointerUp?.(input(300, 100), ctx);

    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it('takes the press before drag-node, so an armed graph connects rather than moves', () => {
    // Ordering is the whole of arming: listed after drag-node the toggle would do nothing at all.
    const ctx = fakeContext();
    const connect = connectNodesBehaviour();
    const drag = dragNodeBehaviour();

    dispatchPointer([connect, drag], 'onPointerDown', input(100, 100), ctx);
    dispatchPointer([connect, drag], 'onPointerMove', input(200, 100), ctx);

    expect(ctx.drawConnection).toHaveBeenCalled();
    expect(ctx.pin).not.toHaveBeenCalled();
  });
});

describe('canvasDoubleClickBehaviour', () => {
  it('reports the world point of a double-click on empty canvas', () => {
    // The position is the whole message: on a surface where position is the data, "make something"
    // is not a request anybody can act on and "make something here" is.
    const ctx = fakeContext();

    canvasDoubleClickBehaviour().onDoubleClick?.(input(640, 480), ctx);

    expect(ctx.emit).toHaveBeenCalledWith({ type: 'canvasDoubleClick', at: { x: 640, y: 480 } });
  });

  it('says nothing when the double-click landed on a node', () => {
    // So it composes with expand-on-double-click rather than competing: opening a node and creating
    // beside one are the same gesture in two places, and they must never both fire.
    const ctx = fakeContext();

    canvasDoubleClickBehaviour().onDoubleClick?.(input(100, 100), ctx);

    expect(ctx.emit).not.toHaveBeenCalled();
  });
});

describe('dispatchPointer', () => {
  it('the first claimer stops later behaviours — except on gesture-ending phases', () => {
    const calls: string[] = [];
    const claimer = {
      id: 'a',
      onPointerDown: () => {
        calls.push('a-down');
        return true;
      },
      onPointerUp: () => {
        calls.push('a-up');
        return true;
      },
    };
    const watcher = {
      id: 'b',
      onPointerDown: () => {
        calls.push('b-down');
        return undefined;
      },
      onPointerUp: () => {
        calls.push('b-up');
        return undefined;
      },
    };

    const ctx = fakeContext();
    dispatchPointer([claimer, watcher], 'onPointerDown', input(0, 0), ctx);
    // Down is claimed — b never sees it.
    expect(calls).toEqual(['a-down']);

    dispatchPointer([claimer, watcher], 'onPointerUp', input(0, 0), ctx);
    // Up broadcasts even though a claimed it: a behaviour holding gesture state
    // must learn the gesture ended, or (the original bug) a clicked node stays
    // latched to the cursor with no button held.
    expect(calls).toEqual(['a-down', 'a-up', 'b-up']);
  });
});
