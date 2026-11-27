/**
 * The shell store's drag part: a press that goes nowhere moves nothing, a drag past the threshold
 * carries the card and is offered somewhere to land, a resize stops at the panel's floor, and a press
 * on a tab is a click until it travels. Under each reactivity port.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MIN_FLOAT_PX } from '../src/shared/dockGeometry';
import { dockRegistry, registerHostDockStore, unregisterHostDockStore } from '../src/shared/registries/dockRegistry';
import { buildParts, reactivityPorts } from './support/shellPorts';

const STORE = 'drag-test';
const A = `${STORE}:a`;
const B = `${STORE}:b`;

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  const build = () => {
    const parts = buildParts(makePort());
    disposers.push(parts.dispose);
    return parts;
  };
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/space/test');
    registerHostDockStore(STORE, { edge: () => 'right', float: () => true });
    for (const id of [A, B])
      dockRegistry.register({ id, moduleId: STORE, edge: 'edge', float: 'float', node: { type: 'div' } });
  });
  afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
    dockRegistry.remove(A);
    dockRegistry.remove(B);
    unregisterHostDockStore(STORE);
  });

  it('moves nothing for a press that goes nowhere, and carries the card once it travels', () => {
    const { drag, arrangement } = build();
    drag.members.beginDockMove(A, 500, 300);
    expect(drag.members.movingDock()).toBe(A);
    expect(drag.members.dockResizing()).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--we-chrome-transition')).toBe('0s');
    drag.members.moveDock(A, 2, 1);
    expect(Object.keys(arrangement.placements())).toEqual([]);

    drag.members.moveDock(A, -200, 40);
    expect(arrangement.placements()[A]).toMatchObject({ snap: null });
    expect(drag.members.insertSlots().length).toBeGreaterThan(0);
    drag.members.endDockMove(A);
    expect(drag.members.movingDock()).toBe(null);
    expect(drag.members.insertSlots()).toEqual([]);
    expect(drag.members.dockResizing()).toBe(false);
  });

  it('stops a resize at the panel’s floor', () => {
    const { drag, docks } = build();
    drag.members.beginDockResize(A);
    drag.members.resizeDock(A, 'left', 5000, 0);
    drag.members.endDockResize();
    expect(docks.members.dockPlacement()[A].w).toBe(MIN_FLOAT_PX);
  });

  it('brings a tab forward on a press that goes nowhere, and shows where one dragged would land', () => {
    const { drag, docks, arrangement } = build();
    docks.members.snapDock(A, 'top-left');
    docks.members.snapDock(B, 'bottom-left');
    docks.members.stackDock(B, 0);
    expect(docks.members.dockGeometry()[B].tabs?.map((tab) => tab.id)).toEqual([A, B]);
    expect(arrangement.members.seatFront([A, B])).toBe(B);

    drag.members.beginTabDrag(A, 100, 100);
    drag.members.endTabDrag(A, 100, 100);
    expect(arrangement.members.seatFront([A, B])).toBe(A);

    drag.members.beginTabDrag(B, 100, 100);
    // Centred under the pointer along its width, its titlebar under it.
    drag.members.moveTab(B, 300, 200);
    expect(drag.members.dragGhost()).toMatchObject({ left: '220px', top: '284px' });
    drag.members.endTabDrag(B, 400, 300);
    expect(drag.members.dragGhost()).toBe(null);
  });

  it('offers the eight places to land, without the one a card already holds', () => {
    const { drag } = build();
    drag.members.beginDockMove(A, 500, 300);
    const offered = drag.members.snapTargets().map((target) => target.id);
    expect(offered).not.toContain('right');
    expect(offered).toContain('left');
    drag.members.endDockMove(A);
  });
});
