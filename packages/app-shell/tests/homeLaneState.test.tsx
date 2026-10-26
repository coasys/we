/**
 * A home lane as the reader leaves it — dragged to a width, folded away — driven through the real
 * shell store: kept per template, kept across a reload, part of a saved layout, and undone by a reset.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
