import { beforeEach, describe, expect, it } from 'vitest';

import { bundledModules } from '../src/shared/registries/bundledModules';
import {
  dockRegistry,
  hostDockStores,
  onDockRegistryChanged,
  registerHostDockStore,
  unregisterHostDockStore,
} from '../src/shared/registries/dockRegistry';
import { moduleRegistry, moduleStores } from '../src/shared/registries/moduleRegistry';
/*
  `registerCoreSlots` rather than `registerEditorDocks`, which it calls. Importing the latter first
  enters an import cycle — `slotRegistry` runs `registerCoreSlots` at module scope, which reaches
  back into `editorDocks` before its `PANELS` list has been initialised.
*/
import { registerCoreSlots } from '../src/shared/registries/slotRegistry';
import { TEMPLATE_SURFACE } from '../src/shared/registries/templateSurface';

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

/**
 * A panel's close button is two strings that have to agree.
 *
 * The frame renders `{ $action: '<store>.<close>' }`, so a `close` naming a method the store does
 * not have — or one the template surface does not grant — produces a button that renders, takes the
 * click, and does nothing. Nothing fails to build; the panel simply cannot be closed from the one
 * control that says it closes it. The same shape as `ModuleLauncher.action`, which is checked for
 * the same reason.
 */
describe('a panel declares how it closes', () => {
  const stub = { components: { CesiumGlobe: () => null, GraphView: () => null } };
  const host = { backend: 'ad4m', framework: 'solid' };
  const storeDeps = {
    signal: <T>(initial: T): [() => T, (next: T) => void] => {
      let value = initial;
      return [() => value, (next: T) => (value = next)];
    },
    effect: (fn: () => void) => fn(),
  };

  beforeEach(() => {
    for (const { definition } of moduleRegistry.all()) moduleRegistry.unregister(definition.id);
  });

  it.each(Object.entries(bundledModules))('%s names a close its own store has', (id, factory) => {
    const definition = factory(stub);
    moduleRegistry.register(definition, host, storeDeps);
    const store = moduleStores[id] as Record<string, unknown> | undefined;

    for (const dock of definition.docks ?? []) {
      // Optional by contract — a panel may genuinely have no way to be dismissed. What is not
      // allowed is naming one that is not there.
      if (!dock.close) continue;
      expect(typeof store?.[dock.close], `${id} declares close: '${dock.close}'`).toBe('function');
    }
  });

  it('gives every bundled panel one, so the set is consistent', () => {
    // The point of moving these onto the titlebar was that they were not: three panels drew their
    // own at three sizes and the video stage had none at all.
    for (const [id, factory] of Object.entries(bundledModules)) {
      for (const dock of factory(stub).docks ?? []) {
        expect(dock.close, `${id} contributes a panel with no way to close it`).toBeTruthy();
      }
    }
  });

  it("reaches the editor's panels through a store the schema can name", () => {
    /*
      The editor is not a module, so its panels' actions are not under `modules.<id>` — they are
      `editorStore.<close>`, and a template-tier surface entry is what makes that path resolve at
      all. An unclassified member is absent from the bag rather than refused, so the button would be
      wired to `undefined`.
    */
    registerCoreSlots();
    const editorPanels = dockRegistry.ordered().filter((entry) => entry.storeRef === 'editorStore');
    expect(editorPanels.length).toBeGreaterThan(0);

    for (const entry of editorPanels) {
      expect(entry.close, `${entry.id} has no close`).toBeTruthy();
      expect(TEMPLATE_SURFACE.editorStore?.[entry.close!], `editorStore.${entry.close}`).toBeDefined();
    }
  });
});
