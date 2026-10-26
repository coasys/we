/**
 * A space's models kept as their SHACL alone: saved, listed back as the manifest they were saved as,
 * kept through an install that rewrites their shape, and removed.
 *
 * The install is faked the way the executor does it: registering a class removes every link on its
 * shape's nodes and writes the shape again — which is exactly what would take the annotations with
 * it, and why the store puts them back.
 */
import type { EntityManifest, ShapeInput } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { describe, expect, it } from 'vitest';

import { compileManifest } from '../src/manifestCompiler';
import { createAd4mShapeStore } from '../src/nativeShapes';

interface Stored {
  data: { source: string; predicate?: string; target: string };
}

type Shaped = { generateSHACL: () => { shape: { nodeShapeUri: string; toLinks(): Stored['data'][] } } };

/** Links in, links out — the surface the store uses. */
function fakePerspective() {
  let links: Stored[] = [];
  const perspective = {
    async get(query: { source?: string; predicate?: string }) {
      return links.filter(
        (l) =>
          (query.source === undefined || l.data.source === query.source) &&
          (query.predicate === undefined || l.data.predicate === query.predicate),
      );
    },
    async addLinks(next: Stored['data'][]) {
      for (const link of next)
        links.push({ data: { source: link.source, predicate: link.predicate, target: link.target } });
      return [];
    },
    async removeLinks(gone: Stored[]) {
      const drop = new Set(gone);
      links = links.filter((l) => !drop.has(l));
      return [];
    },
    /** What registering a class does to its shape: wipe the shape's nodes, write the shape again. */
    register(cls: unknown) {
      const shape = (cls as Shaped).generateSHACL().shape;
      const nodes = new Set([
        shape.nodeShapeUri,
        ...links
          .filter((l) => l.data.source === shape.nodeShapeUri && l.data.predicate === 'sh://property')
          .map((l) => l.data.target),
      ]);
      links = links.filter((l) => !nodes.has(l.data.source));
      for (const data of shape.toLinks()) links.push({ data });
    },
    all: () => links.map((l) => l.data),
  };
  return perspective;
}

const MANIFEST: EntityManifest = {
  version: '1',
  entities: {
    Sighting: {
      extends: 'WeNode',
      flag: { predicate: 'we://flag', value: 'we://module/shape/abc/sighting' },
      description: 'A bird somebody saw',
      display: { title: 'species' },
      properties: {
        species: { type: 'string', predicate: 'we://module/shape/abc/species', required: true, default: '' },
        notes: { type: 'string', predicate: 'we://module/shape/abc/notes', control: 'textarea', default: '' },
      },
      relations: {},
    },
  },
};

const SHAPE: ShapeInput = {
  name: 'Sighting',
  description: 'A bird somebody saw',
  icon: 'bird',
  shapeId: 'we://shapes/abc',
  version: 1,
  forkedFrom: '',
  manifest: MANIFEST,
};

function setup() {
  const perspective = fakePerspective();
  const store = createAd4mShapeStore({
    declare: (_dataset, manifest, opts) => compileManifest(manifest, { ...opts, resolveExternal: () => undefined }),
    ensure: async (_dataset, cls) => perspective.register(cls),
  });
  return { perspective, store, dataset: perspective as never };
}

describe('a space model kept as its SHACL', () => {
  it('lists a saved model back as the manifest and record it was saved as', async () => {
    const { store, dataset } = setup();
    const id = await store.save(dataset, SHAPE);
    expect(await store.list(dataset)).toEqual([
      {
        id,
        name: 'Sighting',
        description: 'A bird somebody saw',
        icon: 'bird',
        shapeId: 'we://shapes/abc',
        version: 1,
        forkedFrom: '',
        manifest: MANIFEST,
        editable: true,
      },
    ]);
  });

  it('keeps nothing beside the SHACL: every link is on the shape’s own nodes', async () => {
    const { store, perspective, dataset } = setup();
    const id = await store.save(dataset, SHAPE);
    const nodes = new Set([
      id,
      ...perspective
        .all()
        .filter((l) => l.source === id && l.predicate === 'sh://property')
        .map((l) => l.target),
    ]);
    for (const link of perspective.all()) expect(nodes.has(link.source)).toBe(true);
  });

  it('loses the model to an install that rewrites its shape, and keeps it again after one', async () => {
    const { store, perspective, dataset } = setup();
    await store.save(dataset, SHAPE);
    perspective.register(
      compileManifest(MANIFEST, { moduleId: 'shape/abc', resolveExternal: () => undefined }).Sighting,
    );
    // The install took the annotations — the shape is no longer one of the space's models.
    expect(await store.list(dataset)).toEqual([]);

    await store.keep!(dataset, SHAPE);
    expect((await store.list(dataset)).map((s) => s.manifest)).toEqual([MANIFEST]);
  });

  it('saves an edit over the model, and writes nothing for a save that changes nothing', async () => {
    const { store, perspective, dataset } = setup();
    const id = await store.save(dataset, SHAPE);
    await store.save(dataset, { ...SHAPE, version: 2, description: 'A bird' }, id);
    expect(await store.list(dataset)).toMatchObject([{ id, version: 2, description: 'A bird' }]);

    const before = perspective.all().length;
    await store.keep!(dataset, { ...SHAPE, version: 2, description: 'A bird' });
    expect(perspective.all()).toHaveLength(before);
  });

  it('reads a model something else added to as not editable, and keeps what it added', async () => {
    const { store, perspective, dataset } = setup();
    await store.save(dataset, SHAPE);
    const field = perspective
      .all()
      .find((l) => l.predicate === 'sh://path' && l.target === 'we://module/shape/abc/notes')!.source;
    await perspective.addLinks([{ source: field, predicate: 'sh://maxLength', target: 'literal:280^^xsd:integer' }]);

    const [listed] = await store.list(dataset);
    expect(listed).toMatchObject({ editable: false, manifest: MANIFEST });
    await store.keep!(dataset, SHAPE);
    expect(perspective.all()).toContainEqual({
      source: field,
      predicate: 'sh://maxLength',
      target: 'literal:280^^xsd:integer',
    });
  });

  it('removes a model from the space’s own, leaving its SHACL for the records that have its type', async () => {
    const { store, perspective, dataset } = setup();
    const id = await store.save(dataset, SHAPE);
    await store.remove(dataset, id);
    expect(await store.list(dataset)).toEqual([]);
    expect(perspective.all().some((l) => l.source === id && l.predicate === 'rdf://type')).toBe(true);
  });

  it('reads a model linking to another as editable, resolving the link as the install did', async () => {
    // Installed, a relation to a core entity is stored with its target class resolved. A rebuild that
    // did not resolve it compared unequal, and every model linking to another read as changed.
    const perspective = fakePerspective();
    const location = compileManifest(
      { version: '1', entities: { LocationBlock: CORE_MANIFEST.entities.LocationBlock } } as EntityManifest,
      { moduleId: 'core', resolveExternal: () => undefined },
    ).LocationBlock;
    const resolve = (name: string) => (name === 'LocationBlock' ? location : undefined);
    const store = createAd4mShapeStore({
      declare: (_dataset, manifest, opts) => compileManifest(manifest, { ...opts, resolveExternal: resolve as never }),
      ensure: async (_dataset, cls) => perspective.register(cls),
      resolveExternal: (_dataset, name) => resolve(name),
    });
    const linked: EntityManifest = {
      version: '1',
      entities: {
        Sighting: {
          ...MANIFEST.entities.Sighting,
          relations: {
            place: { target: 'LocationBlock', cardinality: 'one', predicate: 'we://module/shape/abc/place' },
          },
        },
      },
    };
    await store.save(perspective as never, { ...SHAPE, manifest: linked });
    expect(await store.list(perspective as never)).toMatchObject([{ editable: true }]);
  });
});
