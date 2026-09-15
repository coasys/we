/**
 * Getting a panel out of the way, and back into sight — driven through the real shell store.
 *
 * The pure geometry is covered in `dockGeometry.test.ts`. What only the store can show is the
 * sequencing: which panel a drop raises, that a fold reaches every tab in a seat, that a lane put
 * away is one strip with a tab per panel, and that bringing a hidden panel forward says so.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { ShellStoreProvider, useShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { COLLAPSED_PX, STRIP_PX } from '../src/shared/dockGeometry';
import { dockRegistry, registerHostDockStore, unregisterHostDockStore } from '../src/shared/registries/dockRegistry';

/** A host store rather than a module, so nothing gates the panels on a space. */
const STORE = 'docktest';
const A = `${STORE}:a`;
const B = `${STORE}:b`;

function mountShellStore(): ShellStore {
  let store!: ShellStore;
  const Grab = () => {
    store = useShellStore();
    return null;
  };
  render(() => (
    <ShellStoreProvider>
      <Grab />
    </ShellStoreProvider>
  ));
  return store;
}

function openBoth(edge: 'left' | 'top') {
  registerHostDockStore(STORE, { edge: () => edge, float: () => false });
  for (const id of [A, B])
    dockRegistry.register({ id, moduleId: STORE, edge: 'edge', float: 'float', node: { type: 'div' } });
}

/** Stack B into A's seat, on whichever edge they opened. */
function stack(shell: ShellStore, edge: 'left' | 'top') {
  shell.insertDock(B, edge, 0, 'tab', 0);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  dockRegistry.remove(A);
  dockRegistry.remove(B);
  unregisterHostDockStore(STORE);
});

describe('a panel dropped onto another', () => {
  it('lands in front, and its tab flashes', () => {
    openBoth('left');
    const shell = mountShellStore();
    stack(shell, 'left');

    const geometry = shell.dockGeometry();
    expect(geometry[B].hidden).toBe(false);
    expect(geometry[A].hidden).toBe(true);
    expect(geometry[B].tabs?.find((tab) => tab.id === B)).toMatchObject({ active: true, landed: true });
  });
});

describe('bringing a hidden panel into sight', () => {
  it('raises a background tab to the front of its stack and flashes it', () => {
    openBoth('left');
    const shell = mountShellStore();
    stack(shell, 'left');

    shell.revealDock(A);

    const geometry = shell.dockGeometry();
    expect(geometry[A].hidden).toBe(false);
    expect(geometry[A].tabs?.find((tab) => tab.id === A)).toMatchObject({ active: true, landed: true });
  });

  it('opens a lane collapsed to its edge, with the panel asked for in front', () => {
    openBoth('left');
    const shell = mountShellStore();
    stack(shell, 'left');
    shell.toggleStowLane(B);

    shell.revealDock(A);

    const geometry = shell.dockGeometry();
    expect(geometry[A].stowed).toBeFalsy();
    expect(geometry[B].stowed).toBeFalsy();
    expect(geometry[A].hidden).toBe(false);
  });
});

describe('folding a stack along the top', () => {
  it('folds every tab in the seat, and hands the room back once the lane has folded', () => {
    openBoth('top');
    const shell = mountShellStore();
    stack(shell, 'top');

    expect(shell.dockGeometry()[B].canCollapse).toBe(true);
    shell.toggleCollapseDock(B);

    expect(shell.dockPlacement()[A].collapsed).toBe(true);
    expect(shell.dockPlacement()[B].collapsed).toBe(true);
    expect(shell.contentInset().top).toBe(COLLAPSED_PX);
  });
});

describe('a lane collapsed to its edge', () => {
  it('is offered on the lane’s front titlebar, and becomes a strip naming every panel in it', () => {
    openBoth('left');
    const shell = mountShellStore();
    stack(shell, 'left');

    expect(shell.dockGeometry()[B].canStow).toBe(true);
    vi.useFakeTimers();
    shell.toggleStowLane(B);
    // Once the panels have finished shrinking onto the strip.
    vi.runAllTimers();
    vi.useRealTimers();

    const geometry = shell.dockGeometry();
    expect(shell.contentInset().left).toBe(STRIP_PX);
    expect(geometry[A].hidden && geometry[B].hidden).toBe(true);
    const strip = geometry[A].strip ?? geometry[B].strip;
    expect(strip?.tabs.map((tab) => tab.id).sort()).toEqual([A, B].sort());
    // Beneath both panels, which shrink onto it over the top.
    expect(strip?.layer).toBeLessThan(Math.min(geometry[A].layer ?? 0, geometry[B].layer ?? 0));
  });

  it('opens again as a whole, with each seat showing the tab it showed before', () => {
    openBoth('left');
    const shell = mountShellStore();
    stack(shell, 'left');
    shell.toggleStowLane(B);

    // What a press anywhere on the strip calls, on the lane's first member.
    shell.toggleStowLane(A);

    const geometry = shell.dockGeometry();
    expect(geometry[A].stowed || geometry[B].stowed).toBeFalsy();
    // Held at their full size and faded in while the frame eases open — see `laidOutAt`.
    expect(geometry[B].layoutWidth).toBe(geometry[B].width);
    expect(geometry[B].contentsFaded).toBe(true);
    expect(geometry[B].hidden).toBe(false);
    expect(geometry[A].hidden).toBe(true);
    expect(shell.contentInset().left).toBeGreaterThan(STRIP_PX);
  });

  it('keeps each panel where it sits along the edge, so only the thickness moves', () => {
    // Two panels one above the other in one lane, rather than stacked in a seat.
    openBoth('left');
    const shell = mountShellStore();
    shell.insertDock(B, 'left', 1, 'lane', 0);
    const open = shell.dockGeometry();

    shell.toggleStowLane(A);
    const away = shell.dockGeometry();

    expect(away[B].top).toBe(open[B].top);
    expect(away[B].height).toBe(open[B].height);
    expect(away[B].width).toBe(`${STRIP_PX}px`);
  });

  it('stays on screen while it shrinks onto the strip, holding its open size and fading out', () => {
    openBoth('left');
    const shell = mountShellStore();
    stack(shell, 'left');
    const width = shell.dockGeometry()[B].width;

    shell.toggleStowLane(B);

    expect(shell.dockGeometry()[B]).toMatchObject({ hidden: false, contentsFaded: true, layoutWidth: width });
  });

  it('stays anchored to the sides it opens from, so closing eases rather than jumps', () => {
    // A bottom lane is placed from the bottom; a box placed from the top cannot be transitioned to.
    registerHostDockStore(STORE, { edge: () => 'bottom', float: () => false });
    dockRegistry.register({ id: A, moduleId: STORE, edge: 'edge', float: 'float', node: { type: 'div' } });
    const shell = mountShellStore();
    expect(shell.dockGeometry()[A].bottom).toBeDefined();

    shell.toggleStowLane(A);

    const away = shell.dockGeometry()[A];
    expect(away.bottom).toBeDefined();
    expect(away.top).toBeUndefined();
    expect(away.height).toBe(`${STRIP_PX}px`);
  });
});
