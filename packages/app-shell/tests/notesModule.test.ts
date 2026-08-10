/**
 * The notes module — the first module to own durable entities.
 *
 * Chosen as the second module for exactly what the globe couldn't test: a module-declared model, its
 * install path, and the predicate namespace that becomes the convention the moment it ships. It is
 * fully solo-testable, since a personal perspective is local-only and needs no neighbourhood sync.
 */
import { createAd4mSchemaPort, getModel } from '@we/backend-ad4m';
import { createInMemorySchemaPort } from '@we/backend-inmemory';
import { NOTE_PREDICATES, notesModule } from '@we/module-notes';
import { checkModuleCompatibility, modulePredicatePrefix, modulePredicateViolations } from '@we/module-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { dockRegistry } from '../src/shared/registries/dockRegistry';
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
  it('declares no backend, because it declares its entity rather than writing one', () => {
    // This module used to declare `backends: ['ad4m']` — honestly, since owning an entity meant
    // shipping a decorated class. Declaring the entity as a manifest removes the reason: the host
    // compiles it through whichever schema port is connected, so nothing here names a backend.
    expect(notesModule.backends).toBeUndefined();
    expect(notesModule.entities?.manifest.entities.Note).toBeDefined();

    for (const backend of ['ad4m', 'nextgraph', 'inmemory']) {
      expect(checkModuleCompatibility(notesModule, { backend, framework: 'solid' }).compatible).toBe(true);
    }
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
    // `dock`, not `slot:*` — this panel makes the rest of the app smaller, which is a stronger
    // thing to agree to than chrome drawn on top of it.
    expect(notesModule.capabilities).toEqual(['storage', 'dock']);
  });
});

describe('notes module — contributions', () => {
  it('registers a store, chrome, and a placeable fragment', () => {
    const result = moduleRegistry.register(notesModule, host, storeDeps);
    expect(result.registered).toBe(true);

    expect(moduleStores.notes).toBeDefined();
    // A dock rather than a slot: the panel makes room in the space instead of covering it, which is
    // also what stops it opening on top of the editor's controls or under a docked call panel.
    expect(dockRegistry.get('notes:0')?.moduleId).toBe('notes');
    expect(slotRegistry.get('dock:notes:0')).toBeDefined();
    expect(moduleRegistry.schemas()['notes.toggleButton']).toBeDefined();
  });

  it('is reachable without any template cooperating', () => {
    // The module shipped once with only the expanded panel plus a `toggleButton` fragment nothing
    // placed — so it registered successfully and was invisible. It first grew its own launcher tab;
    // when the call module needed the same thing and drew it somewhere else, the entry point became
    // a declaration the host's module rail renders.
    expect(notesModule.launcher).toEqual({ icon: 'note', label: 'Notes', action: 'toggle', activeWhen: 'open' });
  });

  it('names launcher members its own store actually has', () => {
    // The declaration is a string, so nothing but a test connects it to the store. A typo would give
    // a rail tab that silently does nothing.
    moduleRegistry.register(notesModule, host, storeDeps);
    const store = moduleStores.notes as Record<string, unknown>;

    expect(typeof store[notesModule.launcher!.action]).toBe('function');
    expect(typeof store[notesModule.launcher!.activeWhen!]).toBe('function');
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

  it('resolves its entity by name once the host compiles it, so model.create can write a note', () => {
    // Two things have to happen and they fail at different moments: install puts the *schema* in the
    // dataset, and compiling puts the *class* where `model.create('Note', …)` and `$query` resolve
    // it. Missing the second, the panel renders fine and only adding a note throws — the bug the
    // first version of this module shipped with. Registration alone no longer does it: the class
    // exists only once a backend has compiled the declaration.
    const schemas = createAd4mSchemaPort({});
    moduleRegistry.register(notesModule, host, storeDeps);

    const payloads = moduleRegistry.moduleSchemas(schemas);
    expect(payloads).toHaveLength(1);
    expect(() => getModel('Note')).not.toThrow();

    moduleRegistry.unregister('notes');
    expect(() => getModel('Note')).toThrow(/not found in registry/);
  });

  it('is a working entity on a backend that stores nothing like the first one', async () => {
    // The declaration's real claim is that it does not encode one backend's storage model. AD4M
    // compiles it into triples against minted predicates; this compiles it into rows in a table,
    // where predicates mean nothing at all. If the manifest were quietly AD4M-shaped, this is
    // where it would show — a module author would ship something that only half worked.
    const schemas = createInMemorySchemaPort({ selfId: () => 'did:test:author' });
    moduleRegistry.register(notesModule, host, storeDeps);
    moduleRegistry.moduleSchemas(schemas);

    const Note = getModel('Note') as unknown as {
      create(d: unknown, data: Record<string, unknown>): Promise<{ text: string; author: string }>;
      findAll(d: unknown, q?: Record<string, unknown>): Promise<{ text: string }[]>;
    };
    const dataset = { id: 'ds-notes', tables: {} };

    await Note.create(dataset, { text: 'written without a backend' });
    const notes = await Note.findAll(dataset, { where: { text: { contains: 'without' } } });

    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('written without a backend');
  });

  it('compiles its declaration to the predicates the convention mints', () => {
    // The declaration says `text`; the scheme says `we://module/notes/text`. Nothing keeps those in
    // step except the compiler, so this asserts the binding rather than trusting it.
    const schemas = createAd4mSchemaPort({});
    moduleRegistry.register(notesModule, host, storeDeps);
    moduleRegistry.moduleSchemas(schemas);

    const shape = (
      getModel('Note') as unknown as { generateSHACL(): { shape: { properties: { name?: string; path: string }[] } } }
    ).generateSHACL().shape.properties;
    expect(shape.find((p) => p.name === 'text')?.path).toBe(NOTE_PREDICATES.text);
  });

  it('withdraws everything on unregister', () => {
    moduleRegistry.register(notesModule, host, storeDeps);
    moduleRegistry.unregister('notes');

    expect(moduleStores.notes).toBeUndefined();
    expect(slotRegistry.get('notes:0')).toBeUndefined();
    expect(moduleRegistry.models()).toHaveLength(0);
    expect(() => getModel('Note')).toThrow(/not found in registry/);
  });
});

describe('notes module — the predicate namespace', () => {
  it('mints under its own delegated subtree of we://', () => {
    // A one-way door: predicates are how existing data is found, so changing this scheme later
    // orphans every note silently — the links remain and simply stop matching.
    //
    // One root for the ecosystem (`we://`), with `module/<id>` as a subtree whose adjudicator is
    // module-id uniqueness rather than the WE core team. The namespace shape documents the
    // governance.
    for (const predicate of Object.values(NOTE_PREDICATES)) {
      expect(predicate).toMatch(/^we:\/\/module\/notes\/[a-z]+$/);
    }
  });

  it('does not mint a bare we:// name, which has no adjudicator for modules', () => {
    // `we://text` would collide with TextBlock.text the moment both are installed in one
    // perspective — and nothing arbitrates who gets the name.
    for (const predicate of Object.values(NOTE_PREDICATES)) {
      expect(predicate.startsWith(modulePredicatePrefix('notes'))).toBe(true);
    }
  });

  it('is refused at registration if it ever mints outside that subtree', () => {
    // The rule is enforced, not documented — see `modulePredicateViolations`.
    expect(modulePredicateViolations('notes', Object.values(NOTE_PREDICATES))).toEqual([]);
    expect(modulePredicateViolations('notes', ['we://module/call/roster'])).toHaveLength(1);
  });
});
