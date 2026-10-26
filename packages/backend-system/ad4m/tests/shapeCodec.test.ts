/**
 * A space's own model kept as SHACL and annotations, and read back as the manifest it was saved as.
 *
 * Every case goes the whole way through what a perspective would hold: the manifest compiled by the
 * same compiler a module's entities take, the SHACL links the SDK writes for it, the annotations, and
 * back through the SDK's own `fromLinks`. So a field the codec forgets, or one the SDK stores
 * differently from how the codec reads it, fails here rather than as a model that loses a field the
 * first time somebody opens it.
 */
import type { EntityManifest, EntitySchema, ShapeInput } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { describe, expect, it } from 'vitest';

import { compileManifest, manifestToEntries } from '../src/manifestCompiler';
import { annotationLinks, isAnnotation, type LinkLike, readShape, sameShape } from '../src/shapeCodec';

type Shaped = { generateSHACL: () => { shape: { toLinks(): LinkLike[] } } };

const SIGHTING: EntityManifest = {
  version: '1',
  entities: {
    Sighting: {
      extends: 'WeNode',
      flag: { predicate: 'we://flag', value: 'we://module/shape/x/sighting' },
      description: 'A bird somebody saw',
      interpretationHint: 'Somebody saying they saw a bird',
      extractable: true,
      authoring: { fields: ['species', 'count', 'notes'] },
      display: { title: 'species', summary: 'notes', media: 'photo', fields: ['count', 'seenAt'] },
      properties: {
        species: {
          type: 'string',
          predicate: 'we://module/shape/x/species',
          required: true,
          identity: true,
          interpretationHint: 'Which bird',
          default: '',
        },
        count: { type: 'number', predicate: 'we://module/shape/x/count', default: 1 },
        notes: { type: 'string', predicate: 'we://module/shape/x/notes', control: 'textarea', default: '' },
        seenAt: { type: 'datetime', predicate: 'we://module/shape/x/seen_at', control: 'datetime' },
        certainty: {
          type: 'string',
          predicate: 'we://module/shape/x/certainty',
          options: ['sure', 'probably', 'not sure'],
          default: 'sure',
        },
        photo: {
          type: 'string',
          predicate: 'we://module/shape/x/photo',
          format: 'file',
          readAs: 'dataUri',
          default: null,
        },
      },
      relations: {
        place: { target: 'LocationBlock', cardinality: 'one', predicate: 'we://module/shape/x/place' },
        parts: { target: '', cardinality: 'many', containment: true, ordered: true },
      },
    } as EntitySchema,
  },
};

const input = (manifest: EntityManifest, over: Partial<ShapeInput> = {}): ShapeInput => ({
  name: Object.keys(manifest.entities)[0],
  description: 'A model a community made',
  icon: 'bird',
  shapeId: 'we://shapes/test',
  version: 3,
  forkedFrom: 'we://shapes/upstream@2',
  manifest,
  ...over,
});

/** What a perspective holds for a model: its compiled SHACL, and the annotations beside it. */
function stored(shape: ShapeInput): LinkLike[] {
  const classes = compileManifest(shape.manifest, { moduleId: 'shape/test', resolveExternal: () => undefined });
  const shacl = (classes[shape.name] as unknown as Shaped).generateSHACL().shape.toLinks();
  return [...shacl, ...annotationLinks(shape, shacl)];
}

/**
 * A core entity as a stored model would carry it: one entity, with every predicate resolved and its
 * parent's fields left to the parent — which is what a saved manifest looks like.
 */
function asStoredModel(name: string): EntityManifest {
  const schema = CORE_MANIFEST.entities[name];
  const entry = manifestToEntries({ version: '1', entities: { [name]: schema } }, { moduleId: 'shape/test' })[0];
  const predicateOf = (field: string) => entry.properties.find((p) => p.name === field)?.predicate;
  return {
    version: '1',
    entities: {
      [name]: {
        ...schema,
        properties: Object.fromEntries(
          Object.entries(schema.properties).map(([field, spec]) => [field, { ...spec, predicate: predicateOf(field) }]),
        ),
        relations: Object.fromEntries(
          Object.entries(schema.relations).map(([field, spec]) => [
            field,
            spec.containment ? spec : { ...spec, predicate: spec.predicate ?? predicateOf(field) },
          ]),
        ),
      },
    },
  } as EntityManifest;
}

describe('a space model kept as SHACL', () => {
  it('reads back a model as the manifest and record it was saved as', () => {
    const shape = input(SIGHTING);
    const read = readShape(stored(shape));
    expect(read).toMatchObject({
      name: 'Sighting',
      description: 'A model a community made',
      icon: 'bird',
      shapeId: 'we://shapes/test',
      version: 3,
      forkedFrom: 'we://shapes/upstream@2',
    });
    expect(read?.manifest).toEqual(SIGHTING);
  });

  it('keeps the order the fields were declared in, whatever order the shape is listed in', () => {
    // An executor answers in its own order. Read back in another, the first text field — what names
    // a record when nothing says otherwise — was a different field.
    const read = readShape([...stored(input(SIGHTING))].reverse())!;
    expect(Object.keys(read.manifest.entities.Sighting.properties)).toEqual(
      Object.keys(SIGHTING.entities.Sighting.properties),
    );
    expect(read.manifest).toEqual(SIGHTING);
  });

  it('reads a model that has never been forked as having no origin', () => {
    expect(readShape(stored(input(SIGHTING, { forkedFrom: '' })))?.forkedFrom).toBe('');
  });

  it('keeps a card display that roles cannot say whole, on the shape', () => {
    const entity = SIGHTING.entities.Sighting;
    // The title is also one of the key fields: one field, two roles.
    const manifest = {
      ...SIGHTING,
      entities: { Sighting: { ...entity, display: { title: 'species', fields: ['species', 'count'] } } },
    };
    expect(readShape(stored(input(manifest)))?.manifest).toEqual(manifest);
  });

  it('is not one of WE’s models without a shape id, so it is not listed', () => {
    const shape = input(SIGHTING);
    const classes = compileManifest(shape.manifest, { moduleId: 'shape/test', resolveExternal: () => undefined });
    const shacl = (classes.Sighting as unknown as Shaped).generateSHACL().shape.toLinks();
    expect(readShape(shacl)).toBeNull();
  });

  it('reads every concrete core entity back, as a model a space could carry', () => {
    const names = Object.entries(CORE_MANIFEST.entities)
      .filter(([, schema]) => !schema.abstract)
      .map(([name]) => name);
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) {
      const manifest = asStoredModel(name);
      expect({ name, manifest: readShape(stored(input(manifest)))?.manifest }).toEqual({ name, manifest });
    }
  });
});

describe('whether a stored model can be saved from WE without loss', () => {
  const rebuilt = (links: LinkLike[]) => {
    const read = readShape(links)!;
    return stored(input(read.manifest, read));
  };

  it('is, whatever order the shape is listed in', () => {
    // An executor answers in its own order; the same shape listed backwards is the same shape.
    const links = stored(input(SIGHTING));
    const back = [...links].reverse();
    expect(sameShape(back, rebuilt(back))).toBe(true);
  });

  it('is, when the shape holds only what the manifest says', () => {
    const links = stored(input(SIGHTING));
    expect(sameShape(links, rebuilt(links))).toBe(true);
  });

  it('is not, when something else wrote to the shape', () => {
    const links = stored(input(SIGHTING));
    const field = links.find((l) => l.predicate === 'sh://path' && l.target === 'we://module/shape/x/count')!.source;
    const extra = [...links, { source: field, predicate: 'sh://maxInclusive', target: 'literal:100^^xsd:integer' }];
    expect(sameShape(extra, rebuilt(extra))).toBe(false);
  });
});

describe('the annotations', () => {
  it('are only on the shape’s own nodes, and are the only links the codec claims', () => {
    const shape = input(SIGHTING);
    const all = stored(shape);
    const nodes = new Set(all.filter((l) => !isAnnotation(l)).map((l) => l.source));
    const annotations = all.filter(isAnnotation);
    expect(annotations.length).toBeGreaterThan(10);
    for (const link of annotations) expect(nodes.has(link.source)).toBe(true);
  });
});
