/**
 * The shell store's docks part: a registered panel's request and placement, the room the content
 * gives up and the custom properties chrome follows it by, every panel away behind an overlay,
 * parking a panel, and Escape leaving full screen. Under each reactivity port.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestPlatform, type TestPlatform } from '../src/shared/platform/testPlatform';
import { dockRegistry, registerHostDockStore, unregisterHostDockStore } from '../src/shared/registries/dockRegistry';
import { reactivityPorts } from './support/engines';
import { buildParts, keydown } from './support/shellPorts';

const STORE = 'docks-test';
const A = `${STORE}:a`;

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  let platform: TestPlatform;
  const build = () => {
    const parts = buildParts(makePort(), platform);
    disposers.push(parts.dispose);
    return parts;
  };
  beforeEach(() => {
    platform = createTestPlatform({ url: '/space/test' });
    registerHostDockStore(STORE, { edge: () => 'left', float: () => false });
    dockRegistry.register({ id: A, moduleId: STORE, edge: 'edge', float: 'float', node: { type: 'div' } });
  });
  afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
    dockRegistry.remove(A);
    unregisterHostDockStore(STORE);
  });

  it('takes a panel pushing the content aside from the room, and tells chrome where the content now starts', () => {
    const { docks } = build();
    expect(docks.dockRequests().map((request) => request.id)).toContain(A);
    const left = docks.members.contentInset().left;
    expect(left).toBeGreaterThan(0);
    expect(platform.drawn.properties.get('--we-chrome-left')).toContain(`${left}px`);
    expect(docks.members.dockPlacement()[A]).toMatchObject({ snap: 'left', canDisplace: true });
  });

  it('gives the room back while an overlay is up, and takes it again when it closes', () => {
    const { docks, views } = build();
    const left = docks.members.contentInset().left;
    views.members.openShellView('settings');
    expect(docks.members.contentInset().left).toBe(0);
    views.members.closeShellView();
    expect(docks.members.contentInset().left).toBe(left);
  });

  it('stops pushing the content aside when parked in a corner, and declines to start there', () => {
    const { docks } = build();
    docks.members.snapDock(A, 'top-left');
    expect(docks.members.dockPlacement()[A]).toMatchObject({ snap: 'top-left', canDisplace: false });
    expect(docks.members.contentInset().left).toBe(0);
    docks.members.toggleDockDisplace(A);
    expect(docks.members.dockPlacement()[A].displace).toBe(false);
  });

  it('leaves full screen on Escape, and hides the app’s chrome only while one is up', () => {
    const { docks, arrangement } = build();
    arrangement.writePlacement(A, {
      ...docks.placementOf(docks.dockRequests().find((r) => r.id === A)!),
      maximised: true,
    });
    expect(docks.members.panelMaximised()).toBe(true);
    platform.emit('keydown', keydown({ key: 'Escape' }));
    expect(docks.members.panelMaximised()).toBe(false);
  });

  it('puts every panel away on Cmd+\\ and brings them back', () => {
    const { docks } = build();
    platform.emit('keydown', keydown({ key: '\\', ctrlKey: true }));
    expect(docks.members.panelsHidden()).toBe(true);
    expect(docks.members.hasPanels()).toBe(true);
    docks.members.togglePanelsHidden();
    expect(docks.members.panelsHidden()).toBe(false);
  });
});
