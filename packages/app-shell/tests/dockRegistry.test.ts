import { beforeEach, describe, expect, it } from 'vitest';

import {
  dockRegistry,
  hostDockStores,
  onDockRegistryChanged,
  registerHostDockStore,
  unregisterHostDockStore,
} from '../src/shared/registries/dockRegistry';

/**
 * A dock whose store arrives after the shell has already looked has to be recoverable.
 *
 * This is the theme panel's bug, reduced: `ShellStoreProvider` wraps `EditorStoreProvider`, so the
 * shell resolves dock edges before the editor has published its store. The lookup finds nothing,
 * the resolving memo therefore never touches the edge accessor, and — with no dependency on it —
 * nothing can make it try again. The panel's flag went true and no panel appeared, through any
 * number of clicks and reloads; opening an unrelated panel was the only escape, because that
 * changed something the memo *did* depend on.
 *
 * So registration itself has to be observable. These assert the notification, which is the part a
 * reactive host turns into a dependency.
 */
describe('dock registry notifications', () => {
  beforeEach(() => {
    for (const id of Object.keys(hostDockStores)) delete hostDockStores[id];
  });

  it('announces a host store arriving after the first look', () => {
    let notified = 0;
    const off = onDockRegistryChanged(() => (notified += 1));

    // The shell looks first, and finds nothing — the state the panel got stuck in.
    expect(hostDockStores.editor).toBeUndefined();

    registerHostDockStore('editor', { themeDockEdge: () => 'right' });
    expect(notified).toBe(1);
    expect((hostDockStores.editor.themeDockEdge as () => string)()).toBe('right');
    off();
  });

  it('announces removal too, so a torn-down editor stops being consulted', () => {
    registerHostDockStore('editor', { themeDockEdge: () => 'right' });
    let notified = 0;
    const off = onDockRegistryChanged(() => (notified += 1));
    unregisterHostDockStore('editor');
    expect(notified).toBe(1);
    expect(hostDockStores.editor).toBeUndefined();
    off();
  });

  it('announces dock registration, for a dock declared after the first resolve', () => {
    let notified = 0;
    const off = onDockRegistryChanged(() => (notified += 1));
    dockRegistry.register({
      id: 'test:dock',
      moduleId: 'editor',
      edge: 'themeDockEdge',
      node: { type: 'div' },
      order: 1,
    });
    expect(notified).toBe(1);
    dockRegistry.remove('test:dock');
    expect(notified).toBe(2);
    off();
  });

  it('stops notifying once unsubscribed', () => {
    let notified = 0;
    const off = onDockRegistryChanged(() => (notified += 1));
    off();
    registerHostDockStore('editor', {});
    expect(notified).toBe(0);
  });
});
