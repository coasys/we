/**
 * A module store is built before the host stores publish their slices — and what that used to cost.
 *
 * `createModuleStoreDeps` hands out closures that forward to a mutable `services` object. At
 * construction most of that object is empty, so `() => services.dataset?.() ?? null` reads **nothing
 * reactive**, and a module doing the obvious thing:
 *
 * ```ts
 * effect(() => attach(deps.dataset?.() ?? null));
 * ```
 *
 * gets an effect whose first run tracks zero dependencies. A reactive framework never runs that effect
 * again, so the module is handed `null` once and for ever. Nothing throws and nothing warns.
 *
 * It is not hypothetical: the live module shipped with no controls at all because its availability was
 * derived from a transport that had never been opened. The fix is a revision every forwarding closure
 * reads, so an effect over a service always has at least one dependency however early it runs.
 *
 * Tested with a real Solid effect rather than a stub, because the whole failure is about what a
 * framework does with an effect that tracked nothing — which a fake `effect` cannot reproduce. Solid
 * queues effects rather than running them inline, so every assertion here waits a microtask; asserting
 * synchronously reads the frame before the queue is flushed and fails whether or not the fix works.
 */
import {
  createModuleStoreDeps,
  provideModuleHostServices,
  resetModuleHostServices,
} from '@shared/registries/moduleHostServices';
import { createEffect, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => resetModuleHostServices());

/** The deps a module gets, wired to Solid exactly as the host wires them. */
const solidDeps = () => createModuleStoreDeps({ signal: createSignal, effect: createEffect });

/** Let Solid's effect queue drain. */
const settled = () => Promise.resolve();

describe('a service published after the store was built', () => {
  it('re-runs an effect that read it before it existed', async () => {
    const dispose = createRoot((disposer) => {
      const deps = solidDeps();
      const seen: (string | null)[] = [];
      // The shape every module writes, and the one that used to be born dead.
      createEffect(() => void seen.push(deps.datasetUri?.() ?? null));
      return { disposer, seen, deps };
    });
    await settled();
    expect(dispose.seen).toEqual([null]);

    const [uri, setUri] = createSignal<string | null>('neighbourhood://one');
    provideModuleHostServices({ datasetUri: () => uri() });
    await settled();
    // The effect ran again, which is the whole point: before the revision it had no dependency to be
    // woken by, so this stayed `[null]` for the life of the app.
    expect(dispose.seen).toEqual([null, 'neighbourhood://one']);

    // And once bound it tracks the store's own signal, so a space switch still reaches the module.
    setUri('neighbourhood://two');
    await settled();
    expect(dispose.seen).toEqual([null, 'neighbourhood://one', 'neighbourhood://two']);
    dispose.disposer();
  });

  it('wakes an effect for every late-bound accessor a module might read', async () => {
    const held = createRoot((disposer) => {
      const deps = solidDeps();
      const runs = { dataset: 0, selfId: 0, callOnScreen: 0, datasetRefKey: 0 };
      createEffect(() => {
        deps.dataset?.();
        runs.dataset += 1;
      });
      createEffect(() => {
        deps.selfId?.();
        runs.selfId += 1;
      });
      createEffect(() => {
        deps.callOnScreen?.();
        runs.callOnScreen += 1;
      });
      createEffect(() => {
        deps.datasetRefKey?.();
        runs.datasetRefKey += 1;
      });
      return { disposer, runs };
    });
    await settled();
    expect(Object.values(held.runs).every((count) => count === 1)).toBe(true);

    provideModuleHostServices({ selfId: () => 'did:test:me' });
    await settled();
    // Every one of them, not only the slice that arrived: a module cannot know which publish carries
    // the service it is waiting for, and a revision that woke only the named one would be a rule
    // nobody could see they had broken.
    expect(Object.values(held.runs).every((count) => count === 2)).toBe(true);
    held.disposer();
  });

  it('bumps after the assignment, so a woken effect sees the new slice', async () => {
    const held = createRoot((disposer) => {
      const deps = solidDeps();
      const seen: (string | null)[] = [];
      createEffect(() => void seen.push(deps.selfId?.() ?? null));
      return { disposer, seen };
    });
    await settled();

    provideModuleHostServices({ selfId: () => 'did:test:me' });
    await settled();
    // Bumping before the assignment would re-run the effect against the frame before the slice — one
    // read too early, which reads as the publish not having happened.
    expect(held.seen.at(-1)).toBe('did:test:me');
    held.disposer();
  });
});
