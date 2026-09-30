/**
 * The notes module — private notes in the personal space, and the first module to own an entity.
 *
 * Chosen as the second module for what the globe couldn't test: a module-declared model, its install
 * path, and the predicate namespace that became the convention the moment it shipped. Its content has
 * since become the shared vocabulary — a note is a post in the personal space — and what it owns is
 * the record of where a note was shared. These tests hold the host's half: that the entity installs
 * where an agent-scoped module's entities go, and that the panel and store register the way any
 * module's do.
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
    expect(notesModule.contributes?.entities?.manifest.entities.NoteShare).toBeDefined();
    for (const backend of ['ad4m', 'nextgraph', 'inmemory']) {
      expect(checkModuleCompatibility(notesModule, { backend, framework: 'solid' }).compatible).toBe(true);
    }
  });

  it('is framework-agnostic, and asks for the personal space and the space on screen', () => {
    expect(notesModule.manifest.requires?.frameworks).toBeUndefined();
    expect(notesModule.manifest.requires?.kernels).toEqual(['agentData', 'records']);
    expect(notesModule.contributes?.components).toBeUndefined();
    expect(
      checkModuleCompatibility(notesModule, { backend: 'ad4m', framework: 'react', kernels: ['records'] }).compatible,
    ).toBe(false);
  });

  it('is described to a person by what it declares, not by a list it wrote', () => {
    // Storage of the agent's own, a panel, and the two kernels — what somebody is agreeing to.
    expect(moduleCapabilities(notesModule)).toEqual(
      expect.arrayContaining(['storage:agent', 'dock', 'kernel:agentData', 'kernel:records']),
    );
  });
});

describe('notes module — contributions', () => {
  it('registers a panel, a placeable part and a store', () => {
    const result = moduleRegistry.register(notesModule, host, storeDeps);
    expect(result.registered).toBe(true);

    expect(moduleStores.notes).toBeDefined();
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

  it('installs its entity with the agent’s, never into a space', () => {
    const schemas = createAd4mSchemaPort({});
    moduleRegistry.register(notesModule, host, storeDeps);

    // Where the host sends each list decides whether a record can reach a community: the space list
    // goes to every space, the agent list only to the personal space.
    expect(moduleRegistry.moduleSchemas(schemas)).toHaveLength(0);
    expect(moduleRegistry.agentSchemas(schemas)).toHaveLength(1);
    expect(() => getEntity('NoteShare')).not.toThrow();

    moduleRegistry.unregister('notes');
    expect(() => getEntity('NoteShare')).toThrow(/not found in registry/);
  });

  it('is a working entity on a backend that stores nothing like the first one', async () => {
    const schemas = createInMemorySchemaPort({ selfId: () => 'did:test:author' });
    moduleRegistry.register(notesModule, host, storeDeps);
    moduleRegistry.agentSchemas(schemas);

    const NoteShare = getEntity('NoteShare') as unknown as {
      create(d: unknown, data: Record<string, unknown>): Promise<{ noteId: string; author: string }>;
      findAll(d: unknown, q?: Record<string, unknown>): Promise<{ noteId: string; spaceName: string }[]>;
    };
    const dataset = { id: 'ds-personal', tables: {} };

    await NoteShare.create(dataset, { noteId: 'note-1', ref: 'we:n:space/CollectionBlock/post-1', spaceName: 'Here' });
    await NoteShare.create(dataset, { noteId: 'note-2', ref: 'we:n:space/CollectionBlock/post-2' });
    const shares = await NoteShare.findAll(dataset, { where: { noteId: 'note-1' } });
    expect(shares).toHaveLength(1);
    expect(shares[0].spaceName).toBe('Here');
  });

  it('compiles its declaration to the predicates the convention mints', () => {
    const schemas = createAd4mSchemaPort({});
    moduleRegistry.register(notesModule, host, storeDeps);
    moduleRegistry.agentSchemas(schemas);

    const shape = (
      getEntity('NoteShare') as unknown as {
        generateSHACL(): { shape: { properties: { name?: string; path: string }[] } };
      }
    ).generateSHACL().shape.properties;
    expect(shape.find((p) => p.name === 'noteId')?.path).toBe(NOTE_PREDICATES.noteId);
    expect(shape.find((p) => p.name === 'sharedAt')?.path).toBe(NOTE_PREDICATES.sharedAt);
  });

  it('withdraws everything on unregister', () => {
    moduleRegistry.register(notesModule, host, storeDeps);
    moduleRegistry.unregister('notes');

    expect(dockRegistry.get('notes:main')).toBeUndefined();
    expect(slotRegistry.get('dock:notes:main')).toBeUndefined();
    expect(moduleStores.notes).toBeUndefined();
    expect(() => getEntity('NoteShare')).toThrow(/not found in registry/);
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
