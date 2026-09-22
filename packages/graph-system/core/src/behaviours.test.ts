import type { BehaviourContext, PointerInput } from '@we/graph-protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  canvasDoubleClickBehaviour,
  connectNodesBehaviour,
  dispatchPointer,
  dragNodeBehaviour,
  marqueeSelectBehaviour,
  nodeDoubleClickBehaviour,
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
    drawMarquee: vi.fn(),
    // The nodes are marks of radius 20, so "overlaps the rectangle" is the box around each centre.
    within: (bounds) =>
      [...positions]
        .filter(
          ([, p]) =>
            p.x + 20 >= bounds.minX && p.x - 20 <= bounds.maxX && p.y + 20 >= bounds.minY && p.y - 20 <= bounds.maxY,
        )
        .map(([id]) => id),
    selectEdge: vi.fn(),
  };
  return Object.assign(base, overrides);
}

function input(x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput {
  // `metaKey` was missing, which the cast hid: the fake did not satisfy the interface it claimed.
  const base: PointerInput = { at: { x, y }, buttons: 1, shiftKey: false, ctrlKey: false, metaKey: false };
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
    const canvas = dragNodeBehaviour({ pin: true });
    canvas.onPointerDown!(input(100, 100), pinned);
    canvas.onPointerMove!(input(150, 100), pinned);
    canvas.onPointerUp!(input(150, 100), pinned);
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

describe('nodeDoubleClickBehaviour', () => {
  it('emits the node that was double-clicked', () => {
    // The gap this closes: `nodeDoubleClick` was declared in the protocol and routed by the adapter
    // and emitted by nothing, so a template binding `onNodeDoubleClick` got silence. Everything
    // typechecked and the gesture simply did nothing.
    const ctx = fakeContext();

    nodeDoubleClickBehaviour().onDoubleClick?.(input(100, 100), ctx);

    expect(ctx.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'nodeDoubleClick', node: expect.objectContaining({ id: 'n1' }) }),
    );
  });

  it('says nothing on empty canvas, leaving it to whatever creates there', () => {
    const ctx = fakeContext();

    nodeDoubleClickBehaviour().onDoubleClick?.(input(640, 480), ctx);

    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it('pairs with canvas-double-click so exactly one of them fires', () => {
    // They divide the gesture by where it landed rather than competing for it, which is why a
    // template can list both and why neither needs to know the other exists.
    const onNode = fakeContext();
    dispatchPointer(
      [nodeDoubleClickBehaviour(), canvasDoubleClickBehaviour()],
      'onDoubleClick',
      input(100, 100),
      onNode,
    );
    expect(onNode.emit).toHaveBeenCalledTimes(1);

    const onCanvas = fakeContext();
    dispatchPointer(
      [nodeDoubleClickBehaviour(), canvasDoubleClickBehaviour()],
      'onDoubleClick',
      input(640, 480),
      onCanvas,
    );
    expect(onCanvas.emit).toHaveBeenCalledTimes(1);
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

/**
 * Behaviour order, which is a real part of the contract and reads like a formatting detail.
 *
 * Dispatch stops at the first behaviour that claims a phase, so a list is a priority order rather
 * than a set. `pan-zoom` claims a press on empty canvas — which is why its own description says to
 * list it last, and why every template that listed it first had a background click that silently
 * stopped clearing the selection. Nothing looked broken: the graph panned, the click did nothing,
 * and the missing thing was an event nobody could see was absent.
 */
describe('pan-zoom and select, in both orders', () => {
  const background = input(10, 10);

  function harness() {
    const selections: string[][] = [];
    const panned: number[][] = [];
    const ctx = fakeContext({
      // Empty canvas: the press lands on nothing, which is the case both behaviours read.
      hitTest: () => [],
      select: (ids) => {
        selections.push(ids);
      },
      pan: (dx, dy) => {
        panned.push([dx, dy]);
      },
    });
    return { ctx, selections, panned };
  }

  it('clears the selection on a background click when select comes first', () => {
    const { ctx, selections } = harness();
    const behaviours = [selectBehaviour(), panZoomBehaviour()];

    dispatchPointer(behaviours, 'onPointerDown', background, ctx);
    dispatchPointer(behaviours, 'onPointerUp', background, ctx);

    expect(selections).toEqual([[]]);
  });

  it('clears nothing when pan-zoom comes first', () => {
    // The regression, pinned: pan-zoom claims the press, `select` never records that one began, and
    // its release handler has nothing to compare against.
    const { ctx, selections } = harness();
    const behaviours = [panZoomBehaviour(), selectBehaviour()];

    dispatchPointer(behaviours, 'onPointerDown', background, ctx);
    dispatchPointer(behaviours, 'onPointerUp', background, ctx);

    expect(selections).toEqual([]);
  });

  it('still pans with select in front of it', () => {
    // The order that fixes the click must not cost the drag: `select` claims nothing on the way
    // down, so the press reaches pan-zoom either way.
    const { ctx, panned } = harness();
    const behaviours = [selectBehaviour(), panZoomBehaviour()];

    dispatchPointer(behaviours, 'onPointerDown', background, ctx);
    dispatchPointer(behaviours, 'onPointerMove', input(40, 30), ctx);

    expect(panned).toEqual([[30, 20]]);
  });
});

describe('marqueeSelectBehaviour', () => {
  /** Records what the sweep drew and selected, over the two-node world the fake context holds. */
  function harness(overrides: Partial<BehaviourContext> = {}) {
    const selections: string[][] = [];
    const drawn: (unknown | null)[] = [];
    const ctx = fakeContext({
      hitTest: () => [],
      select: (ids) => {
        selections.push([...ids].sort());
      },
      drawMarquee: (bounds) => {
        drawn.push(bounds);
      },
      ...overrides,
    });
    return { ctx, selections, drawn };
  }

  it('selects what the rectangle touches, and follows it as it shrinks', () => {
    const { ctx, selections } = harness();
    const behaviour = marqueeSelectBehaviour({ armed: true });

    behaviour.onPointerDown!(input(0, 0), ctx);
    // Out past the second node, then pulled back in — the case an additive sweep cannot express.
    behaviour.onPointerMove!(input(400, 200), ctx);
    behaviour.onPointerMove!(input(150, 200), ctx);

    expect(selections).toEqual([['n1', 'n2'], ['n1']]);
  });

  it('normalises a sweep drawn up and to the left', () => {
    // Without `boundsFromPoints` this rectangle has min > max and matches nothing at all, which
    // reads as the gesture working in two directions out of four.
    const { ctx, selections } = harness();
    const behaviour = marqueeSelectBehaviour({ armed: true });

    behaviour.onPointerDown!(input(200, 200), ctx);
    behaviour.onPointerMove!(input(50, 50), ctx);

    expect(selections).toEqual([['n1']]);
  });

  it('adds to the selection when the modifier is held, and replaces when it is not', () => {
    const held = harness({ selection: () => ['n2'] });
    const extending = marqueeSelectBehaviour();
    extending.onPointerDown!(input(0, 0, { shiftKey: true }), held.ctx);
    extending.onPointerMove!(input(150, 150, { shiftKey: true }), held.ctx);
    expect(held.selections).toEqual([['n1', 'n2']]);

    const plain = harness({ selection: () => ['n2'] });
    const replacing = marqueeSelectBehaviour({ armed: true });
    replacing.onPointerDown!(input(0, 0), plain.ctx);
    replacing.onPointerMove!(input(150, 150), plain.ctx);
    expect(plain.selections).toEqual([['n1']]);
  });

  it('ignores a plain background press unless it is armed', () => {
    const { ctx } = harness();
    expect(marqueeSelectBehaviour().onPointerDown!(input(0, 0), ctx)).toBeUndefined();
    expect(marqueeSelectBehaviour({ armed: true }).onPointerDown!(input(0, 0), ctx)).toBe(true);
    expect(marqueeSelectBehaviour().onPointerDown!(input(0, 0, { ctrlKey: true }), ctx)).toBe(true);
  });

  it('leaves a press on a node alone, so an armed canvas can still drag cards', () => {
    const { ctx } = harness({ hitTest: () => ['n1'] });
    expect(marqueeSelectBehaviour({ armed: true }).onPointerDown!(input(100, 100), ctx)).toBeUndefined();
  });

  it('draws nothing and selects nothing below the drag threshold', () => {
    const { ctx, selections, drawn } = harness();
    const behaviour = marqueeSelectBehaviour({ armed: true });

    behaviour.onPointerDown!(input(0, 0), ctx);
    behaviour.onPointerMove!(input(2, 1), ctx);

    expect(drawn).toEqual([]);
    expect(selections).toEqual([]);
  });

  it('clears the selection on an armed press that went nowhere', () => {
    // `select` never sees the press — this behaviour claimed the pointer-down — so the deselect has
    // to come from here or a canvas with the tool armed cannot be deselected at all.
    const { ctx, selections } = harness();
    const behaviour = marqueeSelectBehaviour({ armed: true });

    behaviour.onPointerDown!(input(0, 0), ctx);
    behaviour.onPointerUp!(input(0, 0), ctx);

    expect(selections).toEqual([[]]);
  });

  it('keeps the selection when a modifier press goes nowhere', () => {
    const { ctx, selections } = harness({ selection: () => ['n2'] });
    const behaviour = marqueeSelectBehaviour();

    behaviour.onPointerDown!(input(0, 0, { shiftKey: true }), ctx);
    behaviour.onPointerUp!(input(0, 0, { shiftKey: true }), ctx);

    expect(selections).toEqual([]);
  });

  it('takes the rectangle down on release and on cancel', () => {
    const { ctx, drawn } = harness();
    const behaviour = marqueeSelectBehaviour({ armed: true });

    behaviour.onPointerDown!(input(0, 0), ctx);
    behaviour.onPointerMove!(input(150, 150), ctx);
    behaviour.onPointerUp!(input(150, 150), ctx);
    expect(drawn.at(-1)).toBeNull();

    behaviour.onPointerDown!(input(0, 0), ctx);
    behaviour.onPointerMove!(input(150, 150), ctx);
    behaviour.onPointerCancel!(input(150, 150), ctx);
    expect(drawn.at(-1)).toBeNull();
  });

  it('abandons the sweep when no button is held', () => {
    // The same dropped-pointer-up guard `drag-node` carries: without it a released sweep follows the
    // cursor around the canvas selecting as it goes.
    const { ctx, drawn } = harness();
    const behaviour = marqueeSelectBehaviour({ armed: true });

    behaviour.onPointerDown!(input(0, 0), ctx);
    behaviour.onPointerMove!(input(150, 150, { buttons: 0 }), ctx);
    expect(drawn).toEqual([null]);

    expect(behaviour.onPointerMove!(input(300, 300), ctx)).toBeUndefined();
  });

  it('must be listed before pan-zoom to see the press at all', () => {
    const { ctx, drawn } = harness();
    const marquee = marqueeSelectBehaviour({ armed: true });

    dispatchPointer([panZoomBehaviour(), marquee], 'onPointerDown', input(0, 0), ctx);
    dispatchPointer([panZoomBehaviour(), marquee], 'onPointerMove', input(150, 150), ctx);
    expect(drawn).toEqual([]);

    dispatchPointer([marquee, panZoomBehaviour()], 'onPointerDown', input(0, 0), ctx);
    dispatchPointer([marquee, panZoomBehaviour()], 'onPointerMove', input(150, 150), ctx);
    expect(drawn).toHaveLength(1);
  });
});
