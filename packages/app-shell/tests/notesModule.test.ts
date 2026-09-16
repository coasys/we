/**
 * The notes module — the first module to own durable entities, and now the first with no store.
 *
 * Chosen as the second module for exactly what the globe couldn't test: a module-declared model, its
 * install path, and the predicate namespace that becomes the convention the moment it ships. Since the
 * host took over panel openness it is also the proof that a module can be *entirely declaration*:
 * entities, a part and a panel, and not a line of code.
 */
import { createAd4mSchemaPort, getEntity } from '@we/backend-ad4m';
import { createInMemorySchemaPort } from '@we/backend-inmemory';
import { NOTE_PREDICATES, notesModule } from '@we/module-notes';
import {
  checkModuleCompatibility,
  moduleCapabilities,
  modulePredicatePrefix,
  modulePredicateViolations,
} from '@we/module-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { dockRegistry } from '../src/shared/registries/dockRegistry';
import { createModuleStoreDeps } from '../src/shared/registries/moduleHostServices';
import { moduleRegistry, moduleStores } from '../src/shared/registries/moduleRegistry';
import { registerCoreSlots, slotRegistry } from '../src/shared/registries/slotRegistry';

const host = { backend: 'ad4m', framework: 'solid' };
const storeDeps = createModuleStoreDeps({
  signal: <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => void (value = next)];
  },
  effect: (fn) => fn(),
});

beforeEach(() => {
  for (const entry of slotRegistry.ordered()) slotRegistry.remove(entry.id);
  for (const { definition } of moduleRegistry.all()) moduleRegistry.unregister(definition.manifest.id);
  registerCoreSlots();
});

describe('notes module — declared coupling', () => {
  it('declares no backend, because it declares its entity rather than writing one', () => {
    expect(notesModule.manifest.requires?.backends).toBeUndefined();
    expect(notesModule.contributes?.entities?.manifest.entities.Note).toBeDefined();
    for (const backend of ['ad4m', 'nextgraph', 'inmemory']) {
      expect(checkModuleCompatibility(notesModule, { backend, framework: 'solid' }).compatible).toBe(true);
    }
  });

  it('is framework-agnostic and needs no kernel, because every piece of it is a declaration', () => {
    expect(notesModule.manifest.requires?.frameworks).toBeUndefined();
    expect(notesModule.manifest.requires?.kernels).toBeUndefined();
    expect(notesModule.contributes?.components).toBeUndefined();
    // No store at all: the six members it used to carry existed only to answer the dock's keys.
    expect(notesModule.createStore).toBeUndefined();
    expect(checkModuleCompatibility(notesModule, { backend: 'ad4m', framework: 'react', kernels: [] }).compatible).toBe(
      true,
    );
  });

  it('is described to a person by what it declares, not by a list it wrote', () => {
    // `dock` and storage in the space — the two things somebody is agreeing to.
    expect(moduleCapabilities(notesModule)).toEqual(expect.arrayContaining(['storage:space', 'dock']));
  });
});

describe('notes module — contributions', () => {
  it('registers a panel and a placeable part, and no store', () => {
    const result = moduleRegistry.register(notesModule, host, storeDeps);
    expect(result.registered).toBe(true);

    expect(moduleStores.notes).toBeUndefined();
    // A panel rather than a slot: it makes room in the space instead of covering it.
    expect(dockRegistry.get('notes:main')?.moduleId).toBe('notes');
    expect(slotRegistry.get('dock:notes:main')).toBeDefined();
    expect(moduleRegistry.parts()['notes.toggleButton']).toBeDefined();
  });

  it('is reachable without any template cooperating', () => {
    // The module shipped once with only the expanded panel plus a `toggleButton` fragment nothing
    // placed — so it registered successfully and was invisible. The panel's rail button is derived
    // from the panel now, so a module with a panel is reachable by declaring the panel.
    const panel = notesModule.contributes!.panels![0];
    expect(panel.name).toBe('main');
    expect(panel.icon).toBe('note');
  });

  it('leaves openness to the host, which holds the flag across navigation', () => {
    moduleRegistry.register(notesModule, host, storeDeps);
    const controls = moduleRegistry.panel('notes:main')!;
    const entry = dockRegistry.get('notes:main')!;
    const edge = () => (entry.store!.edge as () => unknown)();

    expect(controls.hostOwned).toBe(true);
    expect(edge()).toBeNull();
    controls.toggle();
    expect(edge()).toBe('right');
    controls.close();
    expect(edge()).toBeNull();
  });

  it('sends its own toggle button through the host, since the host holds the flag', () => {
    const button = JSON.stringify(
      moduleRegistry.parts()['notes.toggleButton'] ?? notesModule.contributes?.parts?.toggleButton,
    );
    expect(button).toContain('spaceStore.launchModule');
    expect(button).toContain('notes:main');
  });

  it('resolves its entity by name once the host compiles it, so record.create can write a note', () => {
    const schemas = createAd4mSchemaPort({});
    moduleRegistry.register(notesModule, host, storeDeps);

    const payloads = moduleRegistry.moduleSchemas(schemas);
    expect(payloads).toHaveLength(1);
    expect(() => getEntity('Note')).not.toThrow();

    moduleRegistry.unregister('notes');
    expect(() => getEntity('Note')).toThrow(/not found in registry/);
  });

  it('is a working entity on a backend that stores nothing like the first one', async () => {
    const schemas = createInMemorySchemaPort({ selfId: () => 'did:test:author' });
    moduleRegistry.register(notesModule, host, storeDeps);
    moduleRegistry.moduleSchemas(schemas);

    const Note = getEntity('Note') as unknown as {
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
    const schemas = createAd4mSchemaPort({});
    moduleRegistry.register(notesModule, host, storeDeps);
    moduleRegistry.moduleSchemas(schemas);

    const shape = (
      getEntity('Note') as unknown as { generateSHACL(): { shape: { properties: { name?: string; path: string }[] } } }
    ).generateSHACL().shape.properties;
    expect(shape.find((p) => p.name === 'text')?.path).toBe(NOTE_PREDICATES.text);
  });

  it('withdraws everything on unregister', () => {
    moduleRegistry.register(notesModule, host, storeDeps);
    moduleRegistry.unregister('notes');

    expect(dockRegistry.get('notes:main')).toBeUndefined();
    expect(slotRegistry.get('dock:notes:main')).toBeUndefined();
    expect(() => getEntity('Note')).toThrow(/not found in registry/);
  });
});

describe('notes module — the predicate namespace', () => {
  it('mints under its own delegated subtree of we://', () => {
    for (const predicate of Object.values(NOTE_PREDICATES)) {
      expect(predicate.startsWith(modulePredicatePrefix('notes'))).toBe(true);
    }
    expect(modulePredicateViolations('notes', Object.values(NOTE_PREDICATES))).toEqual([]);
  });
});
