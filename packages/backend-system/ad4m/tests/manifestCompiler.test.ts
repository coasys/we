/**
 * Golden test: the compiler is faithful on everything the manifest layer can express.
 *
 * Every hand-written WE model is projected to its manifest entry (the neutral-expressible
 * subset: predicates, scalar types, required/writable, resolveLanguage, typed relations and
 * cardinality), compiled back into a dynamic class through the public decorator API, and the
 * compiled class's own generated shape is projected again — the two projections must be
 * identical. Flags, defaults, and enums are outside the projection by design (the module
 * compile path mints its own type flag; models needing the rest stay decorated).
 */
import type { Ad4mModel, SHACLShape } from '@coasys/ad4m';
import { FILE_STORAGE_LANGUAGE, getModelPredicates } from '@we/models';
import { describe, expect, it } from 'vitest';

import { buildModelFromEntry, compileManifest, manifestToEntries } from '../src/manifestCompiler';
import { buildModelManifest } from '../src/perspectiveHelpers';
import { ROOT_MODELS, SPACE_MODELS } from '../src/sdnaModels';

type Shaped = { generateSHACL: () => { shape: SHACLShape | null } };

const ALL_MODELS = [...new Set<unknown>([...ROOT_MODELS, ...SPACE_MODELS])] as Array<typeof Ad4mModel>;

function entryOf(model: { name: string } & Shaped) {
  const shape = model.generateSHACL().shape;
  if (!shape) throw new Error(`${model.name}: no shape generated`);
  return buildModelManifest([{ name: model.name, shape }])[0];
}

describe('manifest compiler — golden round-trip over every hand-written model', () => {
  for (const model of ALL_MODELS) {
    it(`round-trips ${model.name}`, () => {
      const original = entryOf(model as unknown as { name: string } & Shaped);

      // Compile from the projection alone. Relations resolve back to the hand-written classes so
      // conformance metadata derives from the same targets the original used.
      // sh:class URIs use the node-shape name ("SignalShape") — resolve both forms, exactly as
      // the runtime's buildModelClasses does.
      const byName = new Map(ALL_MODELS.map((m) => [m.name, m]));
      const compiled = buildModelFromEntry(original, {
        classResolver: (name) => byName.get(name) ?? byName.get(name.replace(/Shape$/, '')),
      });

      const recompiled = entryOf(compiled as unknown as { name: string } & Shaped);

      // targetClass is namespaced by the runtime and not part of the projection contract.
      const strip = ({ targetClass: _t, ...rest }: typeof original) => ({
        ...rest,
        properties: [...rest.properties].sort((a, b) => a.name.localeCompare(b.name)),
      });
      expect(strip(recompiled)).toEqual(strip(original));
    });
  }
});

describe('file-valued properties', () => {
  // The projection the golden test compares (name/predicate/type/resolveLanguage/…) does not
  // carry transforms, so a compiled model could silently lose the data-URI read and the
  // round-trip would still pass. These assert against the generated shape itself.
  const shapeOf = (cls: unknown) => (cls as Shaped).generateSHACL().shape!;

  it('binds a declared file property to the storage language AND the read transform', () => {
    const classes = compileManifest(
      {
        version: '1',
        entities: {
          Avatar: {
            properties: { image: { type: 'string', format: 'file' }, caption: { type: 'string' } },
            relations: {},
          },
        },
      },
      { moduleId: 'test' },
    );

    const props = shapeOf(classes.Avatar).properties;
    const image = props.find((p) => p.name === 'image')!;
    const caption = props.find((p) => p.name === 'caption')!;

    expect(image.resolveLanguage).toBe(FILE_STORAGE_LANGUAGE);
    expect(image.transform, 'a file property reads back as a data URI').toBeDefined();
    // A plain scalar keeps the decorator's default storage ('literal') and gains no transform.
    expect(caption.resolveLanguage).toBe('literal');
    expect(caption.transform).toBeUndefined();
  });

  it('matches how the hand-written models declare the same thing', () => {
    // Space.avatar is the reference: file storage + data-URI transform.
    const spaceImage = shapeOf(ALL_MODELS.find((m) => m.name === 'Space')!).properties.find(
      (p) => p.name === 'avatar',
    )!;
    const compiled = compileManifest(
      { version: '1', entities: { X: { properties: { avatar: { type: 'string', format: 'file' } }, relations: {} } } },
      { moduleId: 'test', predicates: { 'X.avatar': 'we://image' } },
    );
    const compiledImage = shapeOf(compiled.X).properties.find((p) => p.name === 'avatar')!;

    expect(compiledImage.path).toBe(spaceImage.path);
    expect(compiledImage.resolveLanguage).toBe(spaceImage.resolveLanguage);
    expect(typeof compiledImage.transform).toBe(typeof spaceImage.transform);
  });
});

describe('compileManifest — module-declared entities', () => {
  const manifest = {
    version: '1',
    entities: {
      Note: {
        properties: {
          title: { type: 'string' as const },
          content: { type: 'string' as const },
          pinned: { type: 'boolean' as const },
          viewCount: { type: 'number' as const, required: true },
        },
        relations: {
          attachments: { target: 'Attachment', cardinality: 'many' as const },
          author: { target: 'Attachment', cardinality: 'one' as const },
        },
      },
      Attachment: {
        properties: { url: { type: 'string' as const } },
        relations: {},
      },
    },
  };

  it('mints predicates under the module subtree and reuses core vocabulary', () => {
    const entries = manifestToEntries(manifest, { moduleId: 'notes' });
    const note = entries.find((e) => e.name === 'Note')!;
    const byName = Object.fromEntries(note.properties.map((p) => [p.name, p.predicate]));
    // Core vocabulary reused where the property name matches its meaning…
    expect(byName.title).toBe('we://title');
    expect(byName.content).toBe('we://content');
    // …novel properties mint in the module's subtree, snake_cased.
    expect(byName.pinned).toBe('we://module/notes/pinned');
    expect(byName.viewCount).toBe('we://module/notes/view_count');
    expect(byName.attachments).toBe('we://module/notes/attachments');
  });

  it('honours explicit predicate overrides', () => {
    const entries = manifestToEntries(manifest, {
      moduleId: 'notes',
      predicates: { 'Note.pinned': 'we://module/notes/is_pinned' },
    });
    const note = entries.find((e) => e.name === 'Note')!;
    expect(note.properties.find((p) => p.name === 'pinned')!.predicate).toBe('we://module/notes/is_pinned');
  });

  it('compiles installable classes with a type flag and typed relations', () => {
    const classes = compileManifest(manifest, { moduleId: 'notes' });
    expect(Object.keys(classes).sort()).toEqual(['Attachment', 'Note']);

    const noteShape = (classes.Note as unknown as Shaped).generateSHACL().shape!;
    // The type flag: fixed-value property under the module subtree.
    const flag = noteShape.properties.find((p) => p.hasValue !== undefined);
    expect(flag?.path).toBe('we://flag');
    expect(flag?.hasValue).toBe('we://module/notes/note');

    // Typed relation carries its target class for include/conformance.
    const attachments = noteShape.properties.find((p) => p.name === 'attachments');
    expect(attachments?.maxCount).toBeUndefined();
    const author = noteShape.properties.find((p) => p.name === 'author');
    expect(author?.maxCount).toBe(1);

    // Numeric scalar with required carries minCount; predicates all resolvable.
    const viewCount = noteShape.properties.find((p) => p.name === 'viewCount');
    expect(viewCount?.minCount).toBe(1);

    // Every predicate the compiled class writes is inside the module subtree or core vocabulary —
    // i.e. it would pass the module registry's predicate enforcement.
    const predicates = getModelPredicates(classes.Note);
    for (const predicate of predicates) {
      const allowed = predicate.startsWith('we://module/notes/') || /^we:\/\/[a-z_]+$/.test(predicate);
      expect(allowed, `unexpected predicate ${predicate}`).toBe(true);
    }
  });
});
