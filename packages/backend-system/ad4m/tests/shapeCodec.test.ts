/**
 * A space's own model kept as SHACL and annotations, and read back as the manifest it was saved as.
 *
 * Every case goes the whole way through what a perspective would hold: the manifest compiled by the
 * same compiler a module's entities take, its shape as `shapes()` returns it (through the JSON the
 * executor stores), the links on the shape's nodes with the annotations among them, and back. So a
 * field the codec forgets, or one the SDK stores differently from how the codec reads it, fails here
 * rather than as a model that loses a field the first time somebody opens it.
 */
import { SHACLShape } from '@coasys/ad4m';
import type { EntityManifest, EntitySchema, ShapeInput } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { describe, expect, it } from 'vitest';

import { WeNode } from '../src/entities';
import { compileManifest, manifestToEntries } from '../src/manifestCompiler';
import {
  ANNOTATION,
  annotationLinks,
  type HeldShape,
  isAnnotation,
  type LinkLike,
  readShape,
  sameShape,
  shapeNodes,
} from '../src/shapeCodec';

type Shaped = { generateSHACL: () => { shape: SHACLShape } };

const SIGHTING: EntityManifest = {
  version: '1',
  entities: {
    Sighting: {
      extends: 'WeNode',
      flag: { predicate: 'we://flag', value: 'we://module/shape/x/sighting' },
      description: 'A bird somebody saw',
      interpretationHint: 'Somebody saying they saw a bird',
      interpretable: true,
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

type Resolve = (name: string) => unknown;

/** The compiled SHACL of a model, as the SDK generates it. */
function compiledShape(shape: ShapeInput, resolve: Resolve = () => undefined): SHACLShape {
  const classes = compileManifest(shape.manifest, { moduleId: 'shape/test', resolveExternal: resolve as never });
  return (classes[shape.name] as unknown as Shaped).generateSHACL().shape;
}

/**
 * What a perspective holds for a model: its shape as `shapes()` returns it, and the links on the
 * shape's nodes — the SHACL's own, and the annotations beside them.
 */
function stored(shape: ShapeInput, resolve?: Resolve): HeldShape {
  const shacl = compiledShape(shape, resolve);
  const own = shacl.toLinks() as LinkLike[];
  return { shape: SHACLShape.fromJSON(shacl.toJSON()), links: [...own, ...annotationLinks(shape, own)] };
}

/** The links on a model's nodes alone — for a case that edits what the graph holds, link by link. */
function storedLinks(shape: ShapeInput, resolve?: Resolve): LinkLike[] {
  return [...stored(shape, resolve).links];
}

/**
 * Links as a dataset holds them, read as the shape they spell: a backend that keeps a shape in the
 * graph, so a constraint the parser drops is still among the links.
 */
function held(links: readonly LinkLike[]): HeldShape {
  const uri = links.find((l) => l.predicate === 'rdf://type' && l.target === 'sh://NodeShape')!.source;
  return { shape: SHACLShape.fromLinks(links as never, uri), links };
}

type Stored = HeldShape | readonly LinkLike[];
const asHeld = (from: Stored): HeldShape =>
  Array.isArray(from) ? held(from as readonly LinkLike[]) : (from as HeldShape);

/** The same stored model as an executor might list it: its fields and its links in another order. */
function reversed({ shape, links }: HeldShape): HeldShape {
  const json = shape.toJSON();
  return {
    shape: SHACLShape.fromJSON({ ...json, properties: [...json.properties].reverse() }),
    links: [...links].reverse(),
  };
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
    const read = readShape(reversed(stored(input(SIGHTING))))!;
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
    const shacl = compiledShape(input(SIGHTING));
    expect(readShape({ shape: shacl, links: shacl.toLinks() as LinkLike[] })).toBeNull();
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

/** Read the stored model back and compile that manifest again — what a save from WE would write. */
function rebuilt(from: Stored, resolve?: Resolve): HeldShape {
  const read = readShape(asHeld(from))!;
  const shape = input(read.manifest, read);
  const shacl = compiledShape(shape, resolve);
  return { shape: shacl, links: annotationLinks(shape, shacl.toLinks() as LinkLike[]) };
}

/** `sameShape` and `readShape` over either a held shape or the raw links a case edited. */
const same = (a: Stored, b: Stored) => sameShape(asHeld(a), asHeld(b));
const readHeld = (from: Stored) => readShape(asHeld(from));

describe('whether a stored model can be saved from WE without loss', () => {
  it('is, whatever order the shape is listed in', () => {
    // An executor answers in its own order; the same shape listed backwards is the same shape.
    const back = reversed(stored(input(SIGHTING)));
    expect(sameShape(back, rebuilt(back))).toBe(true);
  });

  it('is, when the shape holds only what the manifest says', () => {
    const held = stored(input(SIGHTING));
    expect(sameShape(held, rebuilt(held))).toBe(true);
  });

  it('is not, when something else wrote to the shape', () => {
    const held = stored(input(SIGHTING));
    const field = held.links.find(
      (l) => l.predicate === 'sh://path' && l.target === 'we://module/shape/x/count',
    )!.source;
    const extra = {
      ...held,
      links: [...held.links, { source: field, predicate: 'sh://maxInclusive', target: 'literal:100^^xsd:integer' }],
    };
    expect(sameShape(extra, rebuilt(extra))).toBe(false);
  });

  it('is, for a shape stored before the compilers wrote sh:node and sh:in', () => {
    // A model saved before `extends` and `options` reached SHACL lacks the links a rebuild now
    // writes for them. Writing more loses nothing, so the model is still editable — exact
    // equality read every model stored that way as foreign instead.
    const resolveWeNode = (name: string) => (name === 'WeNode' ? WeNode : undefined);
    const links = storedLinks(input(SIGHTING), resolveWeNode);
    // The shape under test carries both links the old compiler did not write.
    expect(links.filter((l) => l.predicate === 'sh://node')).toHaveLength(1);
    expect(links.filter((l) => l.predicate === 'sh://in')).toHaveLength(1);
    const prePR = links.filter((l) => l.predicate !== 'sh://node' && l.predicate !== 'sh://in');
    expect(same(prePR, rebuilt(prePR, resolveWeNode))).toBe(true);
  });

  it('is not, when the stored shape says something a save would drop', () => {
    // The other direction of the subset: an `sh:in` value held by storage that the manifest no
    // longer declares is one a save loses — what `editable` exists to say.
    const links = storedLinks(input(SIGHTING));
    const read = readHeld(links)!;
    const entity = read.manifest.entities.Sighting;
    const manifest = {
      ...read.manifest,
      entities: {
        Sighting: {
          ...entity,
          properties: { ...entity.properties, certainty: { ...entity.properties.certainty, options: ['sure'] } },
        },
      },
    } as EntityManifest;
    expect(same(links, storedLinks(input(manifest)))).toBe(false);
  });

  const CERTAINTY = 'we://module/shape/x/certainty';

  /** The property shape that constrains `path`, so a test can replace that one `sh://in`. */
  function propertyNode(links: readonly LinkLike[], path: string): string {
    const node = links.find((l) => l.predicate === 'sh://path' && l.target === path)?.source;
    if (!node) throw new Error(`no property for ${path}`);
    return node;
  }

  function replaceIn(links: readonly LinkLike[], path: string, values: unknown): LinkLike[] {
    const field = propertyNode(links, path);
    const rest = links.filter((l) => !(l.source === field && l.predicate === 'sh://in'));
    if (values === 'absent') return rest;
    const target = values === 'malformed' ? 'literal:string:not-json' : `literal:string:${JSON.stringify(values)}`;
    return [...rest, { source: field, predicate: 'sh://in', target }];
  }

  function without(links: readonly LinkLike[], predicate: string, source?: string): LinkLike[] {
    return links.filter((l) => l.predicate !== predicate || (source !== undefined && l.source !== source));
  }

  it('is not, when storage narrowed an enum the annotation still lists in full', () => {
    // The annotation still says sure/probably/not sure. Storage kept only sure. A save compiles the
    // annotation and writes the wide set back, so the narrowing would not survive.
    const links = storedLinks(input(SIGHTING));
    const narrowed = replaceIn(links, CERTAINTY, [{ value: 'sure' }]);
    expect(same(narrowed, rebuilt(narrowed))).toBe(false);
  });

  it('is, when the allowed values are the same set in another order', () => {
    const links = storedLinks(input(SIGHTING));
    const reordered = replaceIn(links, CERTAINTY, [{ value: 'not sure' }, { value: 'sure' }, { value: 'probably' }]);
    expect(same(reordered, rebuilt(reordered))).toBe(true);
  });

  it('is not, when storage denies every value and the annotation still allows some', () => {
    // `in: []` is a constraint that accepts nothing. An empty list is not an absent one, and a
    // save that writes the annotation's values would open the field.
    const links = storedLinks(input(SIGHTING));
    const denied = replaceIn(links, CERTAINTY, []);
    expect(same(denied, rebuilt(denied))).toBe(false);
  });

  it('is not, when a deny-all constraint has no options annotation to explain it', () => {
    const links = storedLinks(input(SIGHTING));
    const field = propertyNode(links, CERTAINTY);
    const denied = without(replaceIn(links, CERTAINTY, []), ANNOTATION.options, field);
    expect(same(denied, rebuilt(denied))).toBe(false);
  });

  it('is not, when sh:in is malformed or duplicated on one property', () => {
    const links = storedLinks(input(SIGHTING));
    const field = propertyNode(links, CERTAINTY);
    const malformed = replaceIn(links, CERTAINTY, 'malformed');
    expect(same(malformed, rebuilt(malformed))).toBe(false);
    const full = links.find((l) => l.source === field && l.predicate === 'sh://in')!;
    const duplicated = [...links, { ...full, target: `literal:string:${JSON.stringify([{ value: 'sure' }])}` }];
    expect(same(duplicated, rebuilt(duplicated))).toBe(false);
  });

  it('is not, when sh:in appears on a property that has no options annotation', () => {
    // A missing sh:in is legacy only beside that property's own we://options.
    // count has none. certainty does. The matching annotation on certainty must
    // not make a new constraint on count editable.
    const links = storedLinks(input(SIGHTING));
    const count = propertyNode(links, 'we://module/shape/x/count');
    const gained = [
      ...links,
      { source: count, predicate: 'sh://in', target: `literal:string:${JSON.stringify([{ value: '1' }])}` },
    ];
    expect(same(links, gained)).toBe(false);
  });

  it('is not, when accepted values carry labels a manifest cannot write back', () => {
    const links = storedLinks(input(SIGHTING));
    const labelled = replaceIn(links, CERTAINTY, [
      { value: 'sure', label: 'Sure' },
      { value: 'probably', label: 'Maybe' },
      { value: 'not sure', label: 'No' },
    ]);
    expect(same(labelled, rebuilt(labelled))).toBe(false);
  });

  it('is not, when a stored auto_accept link is one this SDK does not write', () => {
    // Pinned @coasys/ad4m has no auto_accept field. The link must stay put: a save that drops it
    // would erase a declaration the manifest cannot say.
    const links = storedLinks(input(SIGHTING));
    const shapeUri = links.find((l) => l.predicate === 'rdf://type' && l.target === 'sh://NodeShape')!.source;
    const extra = [
      ...links,
      { source: shapeUri, predicate: 'ad4m://auto_accept', target: 'literal:string:when_placed' },
    ];
    expect(same(extra, rebuilt(extra))).toBe(false);
  });

  it('is not, when the abstract annotation has no matching ad4m://abstract link', () => {
    // Adding the native flag is not the legacy allowance. That allowance is only a missing
    // sh://in or sh://node beside an annotation that already says the same thing.
    const manifest: EntityManifest = {
      version: '1',
      entities: {
        BirdBase: { abstract: true, properties: { wingspan: { type: 'number' } }, relations: {} },
      },
    };
    const links = storedLinks(input(manifest));
    expect(links.some((l) => l.predicate === 'ad4m://abstract')).toBe(true);
    const stripped = links.filter((l) => l.predicate !== 'ad4m://abstract');
    expect(same(stripped, rebuilt(stripped))).toBe(false);
  });
});

describe('reading options, abstract and extends from the shape itself', () => {
  const CERTAINTY = 'we://module/shape/x/certainty';
  const resolveWeNode = (name: string) => (name === 'WeNode' ? WeNode : undefined);

  function propertyNode(links: readonly LinkLike[], path: string): string {
    const node = links.find((l) => l.predicate === 'sh://path' && l.target === path)?.source;
    if (!node) throw new Error(`no property for ${path}`);
    return node;
  }

  function replaceIn(links: readonly LinkLike[], path: string, values: unknown): LinkLike[] {
    const field = propertyNode(links, path);
    const rest = links.filter((l) => !(l.source === field && l.predicate === 'sh://in'));
    if (values === 'absent') return rest;
    return [...rest, { source: field, predicate: 'sh://in', target: `literal:string:${JSON.stringify(values)}` }];
  }

  it('recovers string options from sh:in when the annotation is absent', () => {
    const links = storedLinks(input(SIGHTING));
    const field = propertyNode(links, CERTAINTY);
    const native = links.filter((l) => !(l.source === field && l.predicate === ANNOTATION.options));
    expect(readHeld(native)?.manifest.entities.Sighting.properties.certainty.options).toEqual([
      'sure',
      'probably',
      'not sure',
    ]);
    expect(same(native, rebuilt(native))).toBe(true);
  });

  it('recovers an exact numeric option as a number, and leaves an inexact one as text', () => {
    const manifest: EntityManifest = {
      version: '1',
      entities: {
        Note: {
          properties: { rating: { type: 'number', predicate: 'we://module/shape/x/rating', options: [1, 2, 3] } },
          relations: {},
        },
      },
    };
    const links = storedLinks(input(manifest));
    const field = propertyNode(links, 'we://module/shape/x/rating');
    const native = links.filter((l) => !(l.source === field && l.predicate === ANNOTATION.options));
    expect(readHeld(native)?.manifest.entities.Note.properties.rating.options).toEqual([1, 2, 3]);
    const mixed = replaceIn(native, 'we://module/shape/x/rating', [{ value: '2' }, { value: '2.0' }]);
    expect(readHeld(mixed)?.manifest.entities.Note.properties.rating.options).toEqual([2, '2.0']);
  });

  it('recovers bare strings from sh:in and stays editable without the annotation', () => {
    // A native list can be the strings themselves. The compiler writes `{ value }` objects for the
    // same set. The shape stays editable when nothing but that spelling differs.
    const links = storedLinks(input(SIGHTING));
    const field = propertyNode(links, CERTAINTY);
    const native = replaceIn(
      links.filter((l) => !(l.source === field && l.predicate === ANNOTATION.options)),
      CERTAINTY,
      ['sure', 'probably', 'not sure'],
    );
    expect(readHeld(native)?.manifest.entities.Sighting.properties.certainty.options).toEqual([
      'sure',
      'probably',
      'not sure',
    ]);
    expect(same(native, rebuilt(native))).toBe(true);
  });

  it('recovers numeric value objects without an annotation and stays editable', () => {
    // `{ value: 2 }` is a number, not the string the compiler writes back. Reading it has to keep
    // the number, and saving it has to count as the same set.
    const manifest: EntityManifest = {
      version: '1',
      entities: {
        Note: {
          properties: { rating: { type: 'number', predicate: 'we://module/shape/x/rating', options: [1, 2, 3] } },
          relations: {},
        },
      },
    };
    const links = storedLinks(input(manifest));
    const field = propertyNode(links, 'we://module/shape/x/rating');
    const native = replaceIn(
      links.filter((l) => !(l.source === field && l.predicate === ANNOTATION.options)),
      'we://module/shape/x/rating',
      [{ value: 1 }, { value: 2 }, { value: 3 }],
    );
    expect(readHeld(native)?.manifest.entities.Note.properties.rating.options).toEqual([1, 2, 3]);
    expect(same(native, rebuilt(native))).toBe(true);
  });

  it('treats a repeated unlabelled value as the same set the manifest lists once', () => {
    // Two copies of `sure` accept the same values as one. The annotation still lists each once,
    // which is what a save writes back.
    const links = storedLinks(input(SIGHTING));
    const repeated = replaceIn(links, CERTAINTY, [
      { value: 'sure' },
      { value: 'sure' },
      { value: 'probably' },
      { value: 'probably' },
      { value: 'not sure' },
      { value: 'not sure' },
    ]);
    expect(same(repeated, rebuilt(repeated))).toBe(true);
  });

  it('reads option values from a labelled sh:in and refuses to drop the labels', () => {
    const links = storedLinks(input(SIGHTING));
    const field = propertyNode(links, CERTAINTY);
    const labelled = replaceIn(
      links.filter((l) => !(l.source === field && l.predicate === ANNOTATION.options)),
      CERTAINTY,
      [
        { value: 'sure', label: 'Sure' },
        { value: 'probably', label: 'Maybe' },
        { value: 'not sure', label: 'No' },
      ],
    );
    expect(readHeld(labelled)?.manifest.entities.Sighting.properties.certainty.options).toEqual([
      'sure',
      'probably',
      'not sure',
    ]);
    expect(same(labelled, rebuilt(labelled))).toBe(false);
  });

  it('keeps the annotation when it disagrees with sh:in, and then the shape is not editable', () => {
    const links = storedLinks(input(SIGHTING));
    const narrowed = replaceIn(links, CERTAINTY, [{ value: 'sure' }]);
    expect(readHeld(narrowed)?.manifest.entities.Sighting.properties.certainty.options).toEqual([
      'sure',
      'probably',
      'not sure',
    ]);
    expect(same(narrowed, rebuilt(narrowed))).toBe(false);
  });

  it('reads abstract from ad4m://abstract when the annotation is absent', () => {
    const manifest: EntityManifest = {
      version: '1',
      entities: {
        BirdBase: { abstract: true, properties: { wingspan: { type: 'number' } }, relations: {} },
      },
    };
    const links = storedLinks(input(manifest)).filter((l) => l.predicate !== ANNOTATION.abstract);
    expect(readHeld(links)?.manifest.entities.BirdBase.abstract).toBe(true);
    expect(same(links, rebuilt(links))).toBe(true);
  });

  it('resolves one native parent link to the known class, and does not guess a name from the URI', () => {
    const links = storedLinks(input(SIGHTING), resolveWeNode).filter((l) => l.predicate !== ANNOTATION.extends);
    expect(links.filter((l) => l.predicate === 'sh://node')).toHaveLength(1);
    expect(readHeld(links)?.manifest.entities.Sighting.extends).toBe('WeNode');
    expect(same(links, rebuilt(links, resolveWeNode))).toBe(true);
  });

  it('does not turn two parent links, or an unknown one, into a single extends', () => {
    const links = storedLinks(input(SIGHTING), resolveWeNode).filter((l) => l.predicate !== ANNOTATION.extends);
    const shapeUri = links.find((l) => l.predicate === 'rdf://type' && l.target === 'sh://NodeShape')!.source;
    const many = [...links, { source: shapeUri, predicate: 'sh://node', target: 'we://OtherShape' }];
    expect(readHeld(many)?.manifest.entities.Sighting.extends).toBeUndefined();
    expect(same(many, rebuilt(many, resolveWeNode))).toBe(false);
    const unknown = links.map((l) => (l.predicate === 'sh://node' ? { ...l, target: 'we://NotAClassShape' } : l));
    expect(readHeld(unknown)?.manifest.entities.Sighting.extends).toBeUndefined();
    expect(same(unknown, rebuilt(unknown, resolveWeNode))).toBe(false);
  });

  it('keeps a declared override of an inherited field', () => {
    // WeNode already has `signals`. A child that says the same name with its own predicate must
    // come back with that predicate: sharing the name is not sharing the field.
    const manifest: EntityManifest = {
      version: '1',
      entities: {
        Sighting: {
          extends: 'WeNode',
          properties: { species: { type: 'string', predicate: 'we://module/shape/x/species' } },
          relations: { signals: { target: '', cardinality: 'many', predicate: 'we://module/shape/x/signals' } },
        },
      },
    };
    const read = readHeld(storedLinks(input(manifest), resolveWeNode));
    expect(read?.manifest.entities.Sighting.relations.signals).toMatchObject({
      predicate: 'we://module/shape/x/signals',
      cardinality: 'many',
    });
  });

  it('keeps a vocabulary property with no sh:in editable', () => {
    const manifest: EntityManifest = {
      version: '1',
      entities: {
        Note: {
          properties: {
            state: { type: 'string', predicate: 'we://status', options: ['a', 'b'], vocabulary: 'communityStates' },
          },
          relations: {},
        },
      },
    };
    const links = storedLinks(input(manifest));
    expect(links.filter((l) => l.predicate === 'sh://in')).toEqual([]);
    expect(readHeld(links)?.manifest.entities.Note.properties.state).toMatchObject({
      options: ['a', 'b'],
      vocabulary: 'communityStates',
    });
    expect(same(links, rebuilt(links))).toBe(true);
  });

  it('is not, when the stored shape has a field the manifest does not', () => {
    // Another app registered the class with one more field; the annotations still read as WE's.
    const held = stored(input(SIGHTING));
    const json = held.shape.toJSON();
    const wider = SHACLShape.fromJSON({
      ...json,
      properties: [...json.properties, { path: 'other://ring', name: 'ring', datatype: 'xsd://string' } as never],
    });
    expect(sameShape({ ...held, shape: wider }, rebuilt(held))).toBe(false);
  });
});

describe('the annotations', () => {
  it('are only on the shape’s own nodes, and are the only links the codec claims', () => {
    const held = stored(input(SIGHTING));
    const nodes = new Set(shapeNodes(held.shape));
    const annotations = held.links.filter(isAnnotation);
    expect(annotations.length).toBeGreaterThan(10);
    for (const link of annotations) expect(nodes.has(link.source)).toBe(true);
  });
});

describe('a model in a vocabulary of its own', () => {
  /** As a cartridge bringing its own shapes writes one: its own namespace, known by its required fields. */
  const QUESTION: EntityManifest = {
    version: '1',
    entities: {
      Question: {
        namespace: 'conv://',
        flag: false,
        interpretationHint: 'A question the group leaves open',
        properties: {
          text: { type: 'string', predicate: 'conv://text', required: true, identity: true },
          askedBy: { type: 'string', predicate: 'conv://askedBy' },
        },
        relations: {},
      } as EntitySchema,
    },
  };

  it('is the class its vocabulary names, with no type marker', () => {
    const shape = compiledShape(input(QUESTION));
    expect(shape.targetClass).toBe('conv://Question');
    expect(shape.nodeShapeUri).toBe('conv://QuestionShape');
    expect(shape.toJSON().properties.map((p) => p.name)).not.toContain('flag');
  });

  it('takes its namespace from the declaration, not from its first field', () => {
    // The SDK otherwise names the class after the first field's scheme: here the minted `we://flag`,
    // or a field in another vocabulary than the class.
    const flagged = { ...QUESTION.entities.Question, flag: undefined };
    expect(compiledShape(input({ ...QUESTION, entities: { Question: flagged } })).targetClass).toBe('conv://Question');
    const elsewhere = { ...QUESTION.entities.Question, namespace: 'https://example.org/ns#' };
    const held = stored(input({ ...QUESTION, entities: { Question: elsewhere } }));
    expect(held.shape.targetClass).toBe('https://example.org/ns#Question');
    expect(readShape(held)?.manifest.entities.Question.namespace).toBe('https://example.org/ns#');
  });

  it('reads back as the manifest it was saved as, and can be saved again without loss', () => {
    const held = stored(input(QUESTION));
    expect(readShape(held)?.manifest).toEqual(QUESTION);
    expect(sameShape(held, rebuilt(held))).toBe(true);
  });

  it('keeps a minted flag and WE’s own namespace out of the manifest it reads back', () => {
    // The common case is unchanged: a model WE named reads back with neither field.
    const read = readShape(stored(input(SIGHTING)))!.manifest.entities.Sighting;
    expect(read.namespace).toBeUndefined();
    expect(read.flag).toEqual(SIGHTING.entities.Sighting.flag);
  });
});
