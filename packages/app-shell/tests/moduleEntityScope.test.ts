import { manifestToEntries } from '@we/backend-ad4m';
import type { SchemaPort } from '@we/backend-shared';
import { POCKET_MANIFEST, POCKET_PREDICATES } from '@we/module-pocket';
import type { ModuleDefinition } from '@we/module-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { moduleRegistry } from '../src/shared/registries/moduleRegistry';

/**
 * A module's own entities have to be findable by a `scope` drill-down.
 *
 * The failure this pins was reported from a completely fresh install and is worth restating,
 * because the error message is a true statement that points away from the cause:
 *
 *     cannot resolve scope { anchor: "PocketFolder", via: "folders" }
 *     — no such relation in the current perspective's model manifest
 *
 * The relation existed, was declared correctly, and had been installed. What it was not in was the
 * list an adapter resolves a scope against, which the host merged from foreign schemas and core
 * vocabulary and nothing else. Every `scope` written before the Pocket anchored on core vocabulary
 * (`CollectionBlock.children`), so a module's own relation had never been asked for.
 */
const host = { backend: 'ad4m', framework: 'solid' };

/** The AD4M port's projection, which is what the shell hands the query adapter. */
const schemas = { entries: manifestToEntries } as unknown as SchemaPort;

function reset() {
  for (const { definition } of moduleRegistry.all()) moduleRegistry.unregister(definition.id);
}

beforeEach(reset);

describe('a module-declared relation', () => {
  it('is in the list a scope is resolved against', () => {
    moduleRegistry.register(
      { id: 'pocket', name: 'Pocket', entities: { manifest: POCKET_MANIFEST, scope: 'agent' } } as ModuleDefinition,
      host,
    );

    const folder = moduleRegistry.entityEntries(schemas).find((entry) => entry.name === 'PocketFolder');
    expect(folder?.properties.map((p) => p.name)).toEqual(expect.arrayContaining(['folders', 'items']));
  });

  it('resolves to the predicate the module actually writes its links under', () => {
    // The whole point. A scope reads the predicate off this list; `record.create`'s `parent` option
    // writes under the one the module names. Two spellings of one edge is a folder whose contents
    // are stored somewhere its own query does not look.
    moduleRegistry.register(
      { id: 'pocket', name: 'Pocket', entities: { manifest: POCKET_MANIFEST, scope: 'agent' } } as ModuleDefinition,
      host,
    );

    const folder = moduleRegistry.entityEntries(schemas).find((entry) => entry.name === 'PocketFolder');
    const predicateOf = (name: string) => folder?.properties.find((p) => p.name === name)?.predicate;

    expect(predicateOf('items')).toBe(POCKET_PREDICATES.items);
    expect(predicateOf('folders')).toBe(POCKET_PREDICATES.folders);
  });

  it('is listed whatever scope the entity installs into', () => {
    // Where an entity is *installed* says nothing about where a query naming it runs from: the
    // Pocket's panel reads the root dataset while a space is open, so filtering this by scope would
    // put its relations out of reach exactly when they are used.
    moduleRegistry.register(
      { id: 'spacey', name: 'Spacey', entities: { manifest: POCKET_MANIFEST } } as ModuleDefinition,
      host,
    );

    expect(moduleRegistry.entityEntries(schemas).map((e) => e.name)).toContain('PocketFolder');
  });

  it('lists nothing for a module that declares no entities', () => {
    moduleRegistry.register({ id: 'plain', name: 'Plain' } as ModuleDefinition, host);
    expect(moduleRegistry.entityEntries(schemas)).toEqual([]);
  });
});
