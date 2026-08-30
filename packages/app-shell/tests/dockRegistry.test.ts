import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bundledModules } from '../src/shared/registries/bundledModules';
import {
  dockRegistry,
  hostChromeReserves,
  hostDockStores,
  onDockRegistryChanged,
  registerHostChromeReserve,
  registerHostDockStore,
  unregisterHostDockStore,
} from '../src/shared/registries/dockRegistry';
import { EDITOR_STORE_ID, registerEditorDocks } from '../src/shared/registries/editorDocks';
import { moduleRegistry, moduleStores } from '../src/shared/registries/moduleRegistry';
import { registerShellDocks, SHELL_DOCK_STORE_ID } from '../src/shared/registries/shellDocks';
import { onSlotRegistryChanged, slotRegistry } from '../src/shared/registries/slotRegistry';
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

  it('registers host chrome under a store id that is not a module id', () => {
    /*
      The invariant the space gate depends on, and the one that broke the settings panel.

      `ShellStore.dockRequests` filters every dock through `moduleGate` — "is this module enabled in
      this space?" — which `SpaceStore` answers from `activeModules`. Host chrome registers docks
      too, under a `hostDockStores` key rather than a module id: `shell` for the space-settings
      panel, `editor` for the AI, code, theme and inspector panels. Asked about those, the gate said
      no, so they had no edge, no geometry, and the button that opens them did nothing.

      The fix is that only docks belonging to a *registered module* are gated, and this pins the
      premise it rests on: these ids are not modules, and are not expected to become modules. If one
      ever does, the gate starts applying to it and the panel disappears — which is the failure this
      test exists to make loud rather than mysterious.
    */
    registerShellDocks();
    registerEditorDocks();

    for (const storeId of [SHELL_DOCK_STORE_ID, EDITOR_STORE_ID]) {
      expect(dockRegistry.ordered().some((entry) => entry.moduleId === storeId)).toBe(true);
      expect(moduleRegistry.get(storeId), `"${storeId}" is host chrome, not a module`).toBeUndefined();
    }
  });

  it("reaches the editor's panels through a store the schema can name", () => {
    /*
      The editor is not a module, so its panels' actions are not under `modules.<id>` — they are
      `editorStore.<close>`, and a template-tier surface entry is what makes that path resolve at
      all. An unclassified member is absent from the bag rather than refused, so the button would be
      wired to `undefined`.
    */
    registerEditorDocks();
    const editorPanels = dockRegistry.ordered().filter((entry) => entry.storeRef === 'editorStore');
    expect(editorPanels.length).toBeGreaterThan(0);

    for (const entry of editorPanels) {
      expect(entry.close, `${entry.id} has no close`).toBeTruthy();
      expect(TEMPLATE_SURFACE.editorStore?.[entry.close!], `editorStore.${entry.close}`).toBeDefined();
    }
  });
});

/**
 * Chrome the host or a template paints, which floating panels have to clear.
 *
 * The sibling of `hostDockStores`: `moduleChrome` sums `chromeReserve` off every module store, and
 * a shell template pinning a nav strip has the same problem the call bar has and no store to
 * publish from.
 */
describe('chrome that is not a module’s', () => {
  beforeEach(() => {
    for (const key of Object.keys(hostChromeReserves)) delete hostChromeReserves[key];
  });

  it('publishes a reserve under its own key', () => {
    registerHostChromeReserve('template', { top: 48, width: 300 });

    expect(hostChromeReserves.template).toEqual({ top: 48, width: 300 });
  });

  it('replaces rather than accumulates when the same source re-registers', () => {
    registerHostChromeReserve('template', { top: 48 });
    registerHostChromeReserve('template', { top: 72 });

    // A template re-rendering must not reserve its band twice.
    expect(Object.keys(hostChromeReserves)).toHaveLength(1);
    expect(hostChromeReserves.template).toEqual({ top: 72 });
  });

  it('withdraws on undefined', () => {
    registerHostChromeReserve('template', { top: 48 });
    registerHostChromeReserve('template', undefined);

    // A shell that stops declaring a bar must stop reserving the band, or every panel keeps dodging
    // chrome that is not there any more.
    expect(hostChromeReserves.template).toBeUndefined();
  });

  it('announces, so the geometry memo re-runs', () => {
    let announced = 0;
    const stop = onDockRegistryChanged(() => (announced += 1));

    registerHostChromeReserve('template', { top: 48 });
    registerHostChromeReserve('template', undefined);
    stop();

    // Same reason registration is observable at all: a plain object cannot be depended on, and a
    // memo that never read the value has nothing to re-run for.
    expect(announced).toBe(2);
  });
});

/**
 * Chrome that arrives after the shell has been built.
 *
 * Contributions used to all register at boot, so the shell reading `nodes()` once was enough. A
 * template declaring panels registers its frames reactively, long after — and without a channel to
 * say so they landed in a list nobody read again, which looks exactly like the panel being broken
 * rather than absent.
 */
describe('a slot contributed after the first render', () => {
  const node = { type: 'Column' };

  it('announces on register', () => {
    const listener = vi.fn();
    const stop = onSlotRegistryChanged(listener);
    slotRegistry.register({ anchor: 'dock-right', id: 'late:1', node });
    stop();
    slotRegistry.remove('late:1');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('announces on remove, so a withdrawn panel stops rendering', () => {
    slotRegistry.register({ anchor: 'dock-right', id: 'late:2', node });

    const listener = vi.fn();
    const stop = onSlotRegistryChanged(listener);
    slotRegistry.remove('late:2');
    stop();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stays quiet removing something that was never there', () => {
    const listener = vi.fn();
    const stop = onSlotRegistryChanged(listener);
    slotRegistry.remove('never-registered');
    stop();

    expect(listener).not.toHaveBeenCalled();
  });
});
