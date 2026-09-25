/**
 * The live module's store against a **real** reactive graph, which is the only place its worst bug lives.
 *
 * `@we/module-testing`'s `fakeDeps` gives an effect that runs once and is never re-run. That is the right
 * default — it is the degraded host every store must survive — but it cannot reproduce the failure that
 * matters: a store whose effect writes a signal the effect itself reads, which a real framework answers
 * by re-running it, for ever.
 *
 * That is not hypothetical. It froze the app *before login*, where the dataset is still null: `attach`
 * bumped a version by reading it and writing the sum, `attach` is reached from the store's effect, so the
 * effect came to depend on a signal it had just written. `markDownstream` recursion, a hung tab, and no
 * clue beyond one repeated frame. Two rounds of testing missed it because every store test in the module
 * package runs against the one-shot effect.
 *
 * So this lives in app-shell, which is where Solid is, and builds the store the way the app does.
 */
import { createModuleStoreDeps, resetModuleHostServices } from '@shared/registries/moduleHostServices';
import { liveModule } from '@we/module-live';
import { createEffect, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => resetModuleHostServices());

/**
 * The store, wired to Solid, with only the kernels its manifest names — as the registry does.
 *
 * `dataset` is a signal a test moves, because the whole subject is what the store does as the host's
 * answers arrive: null before login, then a space, then another.
 */
function build(dataset: () => unknown) {
  const deps = createModuleStoreDeps({ signal: createSignal, effect: createEffect });
  const wanted = new Set(liveModule.manifest.requires?.kernels ?? []);
  const kernels = Object.fromEntries(Object.entries(deps.kernels).filter(([name]) => wanted.has(name as never)));
  return liveModule.createStore!({ ...deps, kernels, dataset: dataset as never }) as Record<string, unknown>;
}

describe('the live store on a real reactive graph', () => {
  it('settles with no dataset, which is every frame before login', async () => {
    /*
      The exact conditions of the freeze. Before login the dataset is null, and the services revision
      bumps as each host store publishes its slice — so the store's effect re-runs several times with
      nothing to attach to. Every one of those runs must be inert.
    */
    const { dispose } = createRoot((disposer) => {
      const store = build(() => null);
      return { dispose: disposer, store };
    });
    await Promise.resolve();
    // Reaching here at all is the assertion: the buggy version never returned.
    expect(true).toBe(true);
    dispose();
  });

  it('settles when the dataset arrives, and again when it changes', async () => {
    const [dataset, setDataset] = createSignal<unknown>(null);
    const held = createRoot((disposer) => ({ dispose: disposer, store: build(dataset) }));
    await Promise.resolve();

    setDataset({ id: 'space-one' });
    await Promise.resolve();
    setDataset({ id: 'space-two' });
    await Promise.resolve();

    /*
      A space change is where this bit hardest in the app: the canvas re-registers, and anything that
      wrote a signal it read took the whole shell down with it — the new space's panels appeared while its
      content stayed frozen on the previous route.
    */
    expect(typeof held.store.toggleCursors).toBe('function');
    held.dispose();
  });

  it('keeps its own state readable through the churn', async () => {
    const [dataset, setDataset] = createSignal<unknown>(null);
    const held = createRoot((disposer) => ({ dispose: disposer, store: build(dataset) }));
    await Promise.resolve();
    setDataset({ id: 'space-one' });
    await Promise.resolve();

    const store = held.store as { cursorsOn: () => boolean; canShareCursors: () => boolean };
    // No transport in this host and no dataset uri, so the controls are correctly not on offer — the
    // point being that reading them answers rather than hangs.
    expect(store.cursorsOn()).toBe(false);
    expect(store.canShareCursors()).toBe(false);
    held.dispose();
  });
});
