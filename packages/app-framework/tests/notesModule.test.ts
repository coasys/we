/**
 * The notes module — the first module to own durable entities.
 *
 * Chosen as the second module for exactly what the globe couldn't test: a module-declared model, its
 * install path, and the predicate namespace that becomes the convention the moment it ships. It is
 * fully solo-testable, since a personal perspective is local-only and needs no neighbourhood sync.
 */
import { NOTE_PREDICATES, notesModule } from '@we/module-notes';
import { checkModuleCompatibility } from '@we/schema-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { moduleRegistry, moduleStores } from '../src/shared/registries/moduleRegistry';
import { registerCoreSlots, slotRegistry } from '../src/shared/registries/slotRegistry';

const host = { backend: 'ad4m', framework: 'solid' };
const storeDeps = {
  signal: <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => (value = next)];
  },
};

beforeEach(() => {
  for (const entry of slotRegistry.ordered()) slotRegistry.remove(entry.id);
  for (const { definition } of moduleRegistry.all()) moduleRegistry.unregister(definition.id);
  registerCoreSlots();
});

describe('notes module — declared coupling', () => {
  it('declares ad4m, because it owns entities and there is no manifest→SDNA compiler', () => {
    // The escape hatch working as designed: entity-owning modules stay unblocked, and the coupling is
    // visible at install rather than discovered later.
    expect(notesModule.backends).toEqual(['ad4m']);
    const plan = checkModuleCompatibility(notesModule, { backend: 'nextgraph', framework: 'solid' });
    expect(plan.compatible).toBe(false);
  });

  it('is framework-agnostic, because every piece of its UI is a fragment', () => {
    // No `frameworks`, no `components`. In a fragment `Column` is a registry key rather than an
    // import — so this module has no framework import to duplicate, and therefore cannot introduce
    // the second-runtime hazard when modules load dynamically.
    expect(notesModule.frameworks).toBeUndefined();
    expect(notesModule.components).toBeUndefined();
    expect(checkModuleCompatibility(notesModule, { backend: 'ad4m', framework: 'react' }).compatible).toBe(true);
  });

  it('declares what a user is actually agreeing to', () => {
    expect(notesModule.capabilities).toEqual(['storage', 'slot:dock-right']);
  });
});

describe('notes module — contributions', () => {
  it('registers a store, chrome, and a placeable fragment', () => {
    const result = moduleRegistry.register(notesModule, host, storeDeps);
    expect(result.registered).toBe(true);

    expect(moduleStores.notes).toBeDefined();
    expect(slotRegistry.get('notes:0')?.anchor).toBe('dock-right');
    expect(moduleRegistry.schemas()['notes.toggleButton']).toBeDefined();
  });

  it('keeps panel state in the store, not node-local state', () => {
    // The panel is chrome, so `$localState` would reset it on every route change — which is precisely
    // what a docked panel must not do.
    moduleRegistry.register(notesModule, host, storeDeps);
    const store = moduleStores.notes as { open: () => boolean; toggle: () => void; close: () => void };

    expect(store.open()).toBe(false);
    store.toggle();
    expect(store.open()).toBe(true);
    store.close();
    expect(store.open()).toBe(false);
  });

  it('surfaces its model for the host to install', () => {
    // Declarative: the host owns the install mechanism, so the diff-before-write check lives in one
    // place rather than being re-implemented per module.
    moduleRegistry.register(notesModule, host, storeDeps);
    expect(moduleRegistry.models()).toHaveLength(1);
  });

  it('withdraws everything on unregister', () => {
    moduleRegistry.register(notesModule, host, storeDeps);
    moduleRegistry.unregister('notes');

    expect(moduleStores.notes).toBeUndefined();
    expect(slotRegistry.get('notes:0')).toBeUndefined();
    expect(moduleRegistry.models()).toHaveLength(0);
  });
});

describe('notes module — the predicate namespace', () => {
  it('namespaces predicates by module id, never under we://', () => {
    // A one-way door: predicates are how existing data is found, so changing this scheme later
    // orphans every note silently — the links remain and simply stop matching.
    for (const predicate of Object.values(NOTE_PREDICATES)) {
      expect(predicate).toMatch(/^module:\/\/notes\/[a-z]+$/);
    }
  });

  it("does not claim we://, which belongs to WE's own models", () => {
    // `we://text` would collide with TextBlock.text the moment both are installed in one perspective.
    for (const predicate of Object.values(NOTE_PREDICATES)) {
      expect(predicate.startsWith('we://')).toBe(false);
    }
  });
});
