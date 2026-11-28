/**
 * The shell store composed whole, as `composeStores` builds it, under each reactivity port: no part
 * reads a later one while the store is being built, every part's members are on the one store, the
 * parts answer each other through it (a shell view opened in one closes what another draws), the
 * store is findable for its own dock while it lives, and disposing the root takes that back.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createTestPlatform } from '../src/shared/platform/testPlatform';
import { dockRegistry, hostDockStores } from '../src/shared/registries/dockRegistry';
import { SHELL_DOCK_STORE_ID } from '../src/shared/registries/shellDocks';
import { reactivityPorts } from './support/engines';
import { buildShell } from './support/shellPorts';

const PANEL = `${SHELL_DOCK_STORE_ID}:composition-panel`;

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    dockRegistry.remove(PANEL);
  });

  function build() {
    // Anywhere but '/', which opens the landing page — and panels are away while an overlay is up.
    const platform = createTestPlatform({ url: '/space/ds-a' });
    const built = buildShell(makePort(), { platform });
    disposers.push(built.dispose);
    return { ...built, platform };
  }

  it('builds whole, with every part’s members on the one store', () => {
    const { store } = build();
    for (const member of [
      'activeShellView', // views
      'requestDestructive', // prompts
      'raiseDock', // arrangement
      'dockGeometry', // docks
      'beginDockMove', // the dock drag
      'openTemplatePanel', // template panels
    ] as const) {
      expect(store[member], member).toBeTypeOf('function');
    }
  });

  it('is the store its own docks read their keys from, until its root is disposed', () => {
    const { store, dispose } = build();
    expect(hostDockStores[SHELL_DOCK_STORE_ID]).toBe(store);
    dispose();
    expect(hostDockStores[SHELL_DOCK_STORE_ID]).toBeUndefined();
  });

  it('seats a dock of its own from the views part’s state, through the docks part', () => {
    dockRegistry.register({
      id: PANEL,
      moduleId: SHELL_DOCK_STORE_ID,
      edge: 'spaceSettingsEdge',
      close: 'closeSpaceSettings',
      node: { type: 'div' },
    });
    const { store, platform } = build();
    expect(store.dockGeometry()[PANEL]?.edge ?? null).toBeNull();
    store.toggleSpaceSettings();
    platform.flushFrames();
    expect(store.spaceSettingsOpen()).toBe(true);
    expect(store.dockGeometry()[PANEL]).toMatchObject({ edge: 'right', hidden: false });
    store.closeSpaceSettings();
    expect(store.dockGeometry()[PANEL]?.edge ?? null).toBeNull();
  });
});
