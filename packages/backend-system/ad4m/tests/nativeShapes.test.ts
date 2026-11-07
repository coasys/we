/**
 * A space's models kept as their SHACL alone: saved, listed back as the manifest they were saved as,
 * kept through an install that rewrites their shape, and removed.
 *
 * The install is faked the way the executor does it: registering a class removes the shape's own
 * links and writes the shape again, and leaves every other link on its nodes — the annotations among
 * them. `shapes()` answers from what was registered, through the shape's JSON.
 */
import { Literal, SHACLShape } from '@coasys/ad4m';
import type { EntityManifest, ShapeInput } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { describe, expect, it } from 'vitest';

import { compileManifest } from '../src/manifestCompiler';
import { createAd4mShapeStore } from '../src/nativeShapes';
import { ANNOTATION } from '../src/shapeCodec';

interface Stored {
  data: { source: string; predicate?: string; target: string };
}

type Shaped = { generateSHACL: () => { shape: SHACLShape } };

const pairOf = (l: Stored['data']) => `${l.source}\u0000${l.predicate ?? ''}`;

/** Links in, links out, and the registered shapes — the surface the store uses. */
function fakePerspective() {
  let links: Stored[] = [];
  const registered = new Map<string, SHACLShape>();
  const perspective = {
    async shapes() {
      return [...registered.values()].map((shape) => ({
        name: shape.targetClass!.replace('we://', ''),
        shape: SHACLShape.fromJSON(shape.toJSON()),
        hash: '',
      }));
    },
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
    /**
     * What registering a class does to its shape: nothing when the stored shape is the same one,
     * else its own links written again, every other link kept.
     */
    register(cls: unknown) {
      const shape = (cls as Shaped).generateSHACL().shape;
      const before = registered.get(shape.targetClass!);
      if (before && JSON.stringify(before.toJSON()) === JSON.stringify(shape.toJSON())) return;
      const own = new Set((before?.toLinks() ?? []).map(pairOf));
      links = links.filter((l) => !own.has(pairOf(l.data)));
      for (const data of shape.toLinks()) links.push({ data });
      registered.set(shape.targetClass!, shape);
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

  it('keeps the model through an install that writes its shape again', async () => {
    const { store, perspective, dataset } = setup();
    await store.save(dataset, SHAPE);
    perspective.register(
      compileManifest(MANIFEST, { moduleId: 'shape/abc', resolveExternal: () => undefined }).Sighting,
    );
    expect((await store.list(dataset)).map((s) => s.manifest)).toEqual([MANIFEST]);
  });

  it('saves an edit over the model, and writes nothing for a save that changes nothing', async () => {
    const { store, perspective, dataset } = setup();
    const id = await store.save(dataset, SHAPE);
    await store.save(dataset, { ...SHAPE, version: 2, description: 'A bird' }, id);
    expect(await store.list(dataset)).toMatchObject([{ id, version: 2, description: 'A bird' }]);

    const before = perspective.all();
    await store.save(dataset, { ...SHAPE, version: 2, description: 'A bird' }, id);
    expect(perspective.all()).toEqual(before);
  });

  it('does not list annotations whose class is not registered', async () => {
    const { store, perspective, dataset } = setup();
    await perspective.addLinks([
      {
        source: 'we://SightingShape',
        predicate: ANNOTATION.shapeId,
        target: Literal.from(JSON.stringify('we://shapes/abc')).toUrl(),
      },
    ]);
    expect(await store.list(dataset)).toEqual([]);
  });

  it('reads a model something else added to as not editable', async () => {
    const { store, perspective, dataset } = setup();
    await store.save(dataset, SHAPE);
    const field = perspective
      .all()
      .find((l) => l.predicate === 'sh://path' && l.target === 'we://module/shape/abc/notes')!.source;
    await perspective.addLinks([{ source: field, predicate: 'sh://maxLength', target: 'literal:280^^xsd:integer' }]);

    const [listed] = await store.list(dataset);
    expect(listed).toMatchObject({ editable: false, manifest: MANIFEST });
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
