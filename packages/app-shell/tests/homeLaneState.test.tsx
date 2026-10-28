/**
 * A home lane as the reader leaves it — dragged to a width, folded away — driven through the real
 * shell store: kept per template, kept across a reload, part of a saved layout, and undone by a reset.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import PanelLane from '../src/frameworks/solid/components/PanelLane';
import type { ShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { ShellStoreProvider, useShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { setTemplatePanels } from '../src/shared/registries/templatePanels';

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

const tree = { id: 'tree', node: { type: 'div' }, home: 'tree' };

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/space/test');
  setTemplatePanels([tree], 'coasys-space');
});

afterEach(() => {
  cleanup();
  setTemplatePanels(undefined);
});

describe('a home lane', () => {
  it('keeps the width it was dragged to, for this template, across a reload', () => {
    const shell = mountShellStore();
    expect(shell.laneWidth('tree')).toBeUndefined();
    shell.setLaneWidth('tree', 312.4);
    expect(shell.laneWidth('tree')).toBe(312);

    cleanup();
    const again = mountShellStore();
    expect(again.laneWidth('tree')).toBe(312);

    // Another template's lane of the same name is its own.
    setTemplatePanels([tree], 'other-template');
    expect(again.laneWidth('tree')).toBeUndefined();
  });

  it('refuses a width that is not one', () => {
    const shell = mountShellStore();
    shell.setLaneWidth('tree', Number.NaN);
    shell.setLaneWidth('tree', -10);
    expect(shell.laneWidth('tree')).toBeUndefined();
  });

  it('folds away and back, as flipped or as said', () => {
    const shell = mountShellStore();
    expect(shell.collapsedLanes()).toEqual([]);
    shell.toggleLane('tree');
    expect(shell.collapsedLanes()).toEqual(['tree']);
    shell.toggleLane('tree');
    expect(shell.collapsedLanes()).toEqual([]);
    shell.setLaneCollapsed('tree', true);
    shell.setLaneCollapsed('tree', true);
    expect(shell.collapsedLanes()).toEqual(['tree']);
  });

  it('counts as a change to the layout, is kept by a saved layout, and is undone by a reset', () => {
    const shell = mountShellStore();
    expect(shell.layoutDirty()).toBe(false);
    shell.setLaneWidth('tree', 300);
    shell.setLaneCollapsed('tree', true);
    expect(shell.layoutDirty()).toBe(true);

    shell.saveLayout('Reading');
    shell.resetTemplateLayout();
    expect(shell.laneWidth('tree')).toBeUndefined();
    expect(shell.collapsedLanes()).toEqual([]);
    expect(shell.layoutDirty()).toBe(false);

    shell.applyLayout('Reading');
    expect(shell.laneWidth('tree')).toBe(300);
    expect(shell.collapsedLanes()).toEqual(['tree']);
  });
});

describe('customising the layout', () => {
  it('shows every grip, then goes back to showing them on hover', () => {
    const shell = mountShellStore();
    expect(shell.customisingLayout()).toBe(false);
    shell.toggleCustomiseLayout();
    expect(shell.customisingLayout()).toBe(true);
    shell.toggleCustomiseLayout();
    expect(shell.customisingLayout()).toBe(false);
  });
});

/*
  Folding slides: the lane narrows to nothing while what is in it keeps its width, so it moves out
  past the edge rather than being squeezed — and a folded lane can be neither seen nor tabbed into.
  It was `display: none`, which cannot be animated: the tree vanished and the view jumped across.
  The motion itself is the browser's; this pins the arrangement that makes it a slide.
*/
describe('a home lane folding', () => {
  function mountLane() {
    let store!: ShellStore;
    const Grab = () => {
      store = useShellStore();
      return null;
    };
    const { container } = render(() => (
      <ShellStoreProvider>
        <Grab />
        <PanelLane lane="side" width="280px" resize="end" />
      </ShellStoreProvider>
    ));
    const lane = container.firstElementChild as HTMLElement;
    const content = lane.firstElementChild!.firstElementChild as HTMLElement;
    return { store, lane, content };
  }

  it('narrows to nothing around content that keeps its width, and is inert once folded', () => {
    const { store, lane, content } = mountLane();
    expect(lane.style.width).toBe('280px');
    expect(lane.inert).toBe(false);

    store.setLaneCollapsed('side', true);

    expect(lane.style.width).toBe('0px');
    expect(content.style.width).toBe('280px');
    expect(lane.inert).toBe(true);
    expect(lane.style.visibility).toBe('hidden');
    // Width animates, and visibility waits for it, so the lane is seen leaving.
    expect(lane.style.transition).toContain('width');
    expect(lane.style.transition).toMatch(/visibility 0s linear var\(--we-transition-300\)/);
  });

  it('is shown at once on the way back, so it is seen arriving', () => {
    const { store, lane } = mountLane();
    store.setLaneCollapsed('side', true);
    store.setLaneCollapsed('side', false);

    expect(lane.style.width).toBe('280px');
    expect(lane.inert).toBe(false);
    expect(lane.style.visibility).toBe('visible');
    expect(lane.style.transition).toMatch(/visibility 0s linear 0s/);
  });

  it('can still be resized after it has been folded and unfolded', () => {
    const { store, lane } = mountLane();
    store.setLaneCollapsed('side', true);
    store.setLaneCollapsed('side', false);

    const handle = lane.querySelector('we-resize-handle')!;
    handle.dispatchEvent(new CustomEvent('resizestart', { detail: { delta: 0 } }));
    handle.dispatchEvent(new CustomEvent('resize', { detail: { delta: 200 } }));
    handle.dispatchEvent(new CustomEvent('resizeend', { detail: { delta: 200 } }));
    expect(store.laneWidth('side')).toBeDefined();
  });

  // An inspector's lane, folded while nothing is selected — by the template, without writing the reader's fold.
  it("folds when its template says so, and unfolds to the reader's own state", () => {
    const [folded, setFolded] = createSignal(true);
    let store!: ShellStore;
    const Grab = () => {
      store = useShellStore();
      return null;
    };
    const { container } = render(() => (
      <ShellStoreProvider>
        <Grab />
        <PanelLane lane="inspector" width="320px" resize="start" collapsed={folded()} />
      </ShellStoreProvider>
    ));
    const lane = container.firstElementChild as HTMLElement;
    expect(lane.style.width).toBe('0px');
    expect(lane.inert).toBe(true);
    expect(store.collapsedLanes()).toEqual([]);

    setFolded(false);
    expect(lane.style.width).toBe('320px');
    expect(lane.inert).toBe(false);
  });
});
