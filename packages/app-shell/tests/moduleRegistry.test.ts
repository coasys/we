/**
 * The slot and module registries.
 *
 * The load-bearing assertion is the first one: generalising `shellRegistry` into an open collection
 * must leave the existing three shell entries rendering in exactly the same order. Everything else in
 * this PR builds on that generalisation, so if it is not faithful, nothing downstream is trustworthy.
 */
import type { ModuleDefinition } from '@we/module-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { moduleRegistry, moduleStores } from '../src/shared/registries/moduleRegistry';
import { registerCoreSlots, slotRegistry } from '../src/shared/registries/slotRegistry';

const host = { backend: 'ad4m', framework: 'solid' };

/**
 * Stand-in reactivity. A module store is built from injected primitives rather than an imported
 * framework, so a plain closure satisfies the port here — which is itself the point: nothing in a
 * module store requires Solid to exist.
 */
const storeDeps = {
  signal: <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => (value = next)];
  },
};

function reset() {
  for (const entry of slotRegistry.ordered()) slotRegistry.remove(entry.id);
  for (const { definition } of moduleRegistry.all()) moduleRegistry.unregister(definition.id);
  registerCoreSlots();
}

function mod(overrides: Partial<ModuleDefinition> = {}): ModuleDefinition {
  return { id: 'test', name: 'Test', ...overrides };
}

beforeEach(reset);

describe('slotRegistry — faithful generalisation of shellRegistry', () => {
  it('renders the original three host slots in the order the old hardcoded array produced', () => {
    // Was: [shellRegistry.bootScreen, shellRegistry.sidebar, shellRegistry.templateEditor]
    //
    // The property this test protects is the *relative* order of those three, not their position.
    // It used to assert a prefix, which conflated the two and broke the moment host chrome was
    // added ahead of `core:sidebar` (the consent overlays). Filtering to the three keeps the real
    // invariant and stops the test objecting to new chrome it has no opinion about.
    const ORIGINAL = ['core:bootScreen', 'core:sidebar', 'core:templateEditor'];
    expect(
      slotRegistry
        .ordered()
        .map((e) => e.id)
        .filter((id) => ORIGINAL.includes(id)),
    ).toEqual(ORIGINAL);
  });

  it('keeps host chrome first when a module contributes to a later anchor', () => {
    slotRegistry.register({ id: 'call', anchor: 'dock-bottom', node: { type: 'Column' } });
    expect(slotRegistry.ordered().map((e) => e.id)).toEqual([
      'core:bootScreen',
      'core:consentPrompt',
      'core:consentSecret',
      'core:sidebar',
      'core:templateEditor',
      'core:moduleRail',
      'call',
    ]);
  });

  it('lets a seed white-label host chrome without disturbing its position', () => {
    slotRegistry.replace('core:bootScreen', { type: 'we-text', children: ['custom'] });
    const entries = slotRegistry.ordered();
    expect(entries[0].id).toBe('core:bootScreen');
    expect(entries[0].node).toEqual({ type: 'we-text', children: ['custom'] });
  });

  it('ignores a replace for an id that was never registered', () => {
    slotRegistry.replace('nope', { type: 'Column' });
    expect(slotRegistry.get('nope')).toBeUndefined();
  });

  it('orders by declared order within an anchor', () => {
    slotRegistry.register({ id: 'b', anchor: 'dock-bottom', node: { type: 'Column' }, order: 200 });
    slotRegistry.register({ id: 'a', anchor: 'dock-bottom', node: { type: 'Column' }, order: 100 });
    const bottom = slotRegistry.ordered().filter((e) => e.anchor === 'dock-bottom');
    expect(bottom.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('breaks ties on id, so load order cannot leak into layout', () => {
    // Entries come out of a Map; without the tiebreak, equal-order chrome would rearrange depending
    // on which module happened to register first.
    slotRegistry.register({ id: 'zebra', anchor: 'banner', node: { type: 'Column' } });
    slotRegistry.register({ id: 'apple', anchor: 'banner', node: { type: 'Column' } });
    const banner = slotRegistry.ordered().filter((e) => e.anchor === 'banner');
    expect(banner.map((e) => e.id)).toEqual(['apple', 'zebra']);
  });

  it('is idempotent on re-registration', () => {
    slotRegistry.register({ id: 'x', anchor: 'banner', node: { type: 'Column' } });
    slotRegistry.register({ id: 'x', anchor: 'banner', node: { type: 'Row' } });
    expect(slotRegistry.ordered().filter((e) => e.id === 'x')).toHaveLength(1);
    expect(slotRegistry.get('x')?.node).toEqual({ type: 'Row' });
  });
});

describe('moduleRegistry', () => {
  it('fans contributions out to the registries that already exist', () => {
    moduleRegistry.register(
      mod({
        id: 'notes',
        slots: [{ anchor: 'dock-right', node: { type: 'Column' } }],
        createStore: () => ({ open: true }),
      }),
      host,
      storeDeps,
    );

    expect(moduleStores.notes).toEqual({ open: true });
    expect(slotRegistry.get('notes:0')?.anchor).toBe('dock-right');
  });

  it('leaves the module key absent until it registers, so $if on modules.<id> works', () => {
    // The whole point of the namespace convention: a template can depend on an optional module
    // because the key is missing, not present-but-inert.
    expect(moduleStores.notes).toBeUndefined();
    moduleRegistry.register(mod({ id: 'notes', createStore: () => ({}) }), host, storeDeps);
    expect(moduleStores.notes).toBeDefined();
    moduleRegistry.unregister('notes');
    expect(moduleStores.notes).toBeUndefined();
  });

  it('removes every contribution on unregister', () => {
    moduleRegistry.register(
      mod({
        id: 'multi',
        slots: [
          { anchor: 'dock-bottom', node: { type: 'Column' } },
          { anchor: 'banner', node: { type: 'Row' } },
        ],
      }),
      host,
    );
    expect(slotRegistry.ordered().filter((e) => e.id.startsWith('multi:'))).toHaveLength(2);

    moduleRegistry.unregister('multi');
    expect(slotRegistry.ordered().filter((e) => e.id.startsWith('multi:'))).toHaveLength(0);
  });

  it('replaces rather than duplicates when the same id registers twice', () => {
    const definition = mod({ id: 'dupe', slots: [{ anchor: 'banner', node: { type: 'Column' } }] });
    moduleRegistry.register(definition, host);
    moduleRegistry.register(definition, host);

    expect(moduleRegistry.all()).toHaveLength(1);
    expect(slotRegistry.ordered().filter((e) => e.id.startsWith('dupe:'))).toHaveLength(1);
  });

  it('refuses an incompatible module loudly instead of half-mounting it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = moduleRegistry.register(
      mod({ id: 'ng-only', backends: ['nextgraph'], slots: [{ anchor: 'banner', node: { type: 'Column' } }] }),
      host,
    );

    expect(result.registered).toBe(false);
    expect(result.problems[0]).toContain('nextgraph');
    // Nothing partially applied — no store, no chrome.
    expect(moduleRegistry.has('ng-only')).toBe(false);
    expect(slotRegistry.ordered().some((e) => e.id.startsWith('ng-only'))).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('namespaces schema fragments so two modules cannot collide', () => {
    moduleRegistry.register(mod({ id: 'a', schemas: { panel: { type: 'Column' } } }), host);
    moduleRegistry.register(mod({ id: 'b', schemas: { panel: { type: 'Row' } } }), host);

    expect(moduleRegistry.schemas()).toEqual({
      'a.panel': { type: 'Column' },
      'b.panel': { type: 'Row' },
    });
  });

  it('registers a fragments-only module with no store and no components', () => {
    const result = moduleRegistry.register(
      mod({ id: 'banner', slots: [{ anchor: 'banner', node: { type: 'Column' } }] }),
      host,
    );
    expect(result.registered).toBe(true);
    expect(moduleStores.banner).toBeUndefined();
    expect(moduleRegistry.components()).toEqual({});
  });

  it('surfaces embedded applications through the same registry as every other module', () => {
    moduleRegistry.register(
      mod({
        id: 'flux',
        name: 'Flux',
        icon: 'chat-circle',
        embed: { url: 'http://localhost:8080', allow: "camera 'src'", image: '/flux.png' },
      }),
      host,
    );
    moduleRegistry.register(mod({ id: 'notes' }), host);

    // Only the module that contributes an embed appears — the others are registered all the same.
    expect(moduleRegistry.embeds()).toEqual([
      {
        id: 'flux',
        name: 'Flux',
        icon: 'chat-circle',
        image: '/flux.png',
        url: 'http://localhost:8080',
        allow: "camera 'src'",
      },
    ]);
    expect(moduleRegistry.has('notes')).toBe(true);
  });

  it('refuses an embedded app whose declared backend this host does not run', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = moduleRegistry.register(
      mod({ id: 'flux', backends: ['other'], embed: { url: 'http://x', allow: '' } }),
      host,
    );

    // The point of folding embedded apps into the module contract: refusal is immediate and carries
    // a reason, instead of an iframe that mounts and waits on a handshake nobody will answer.
    expect(result.registered).toBe(false);
    expect(result.problems[0]).toContain('other');
    expect(moduleRegistry.embeds()).toEqual([]);
    warn.mockRestore();
  });
});
