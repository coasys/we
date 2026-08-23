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

import { buildModelFromEntry, compileManifest, CORE_VOCABULARY, manifestToEntries } from '../src/manifestCompiler';
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

  it('distinguishes a file read back rendered from one read back raw', () => {
    // WE stores both kinds: avatars and image blocks read as data URIs, while stored templates,
    // themes and editor state are decoded by the caller. Collapsing them would either break
    // rendering or corrupt what the caller decodes, so `readAs` is explicit.
    const classes = compileManifest(
      {
        version: '1',
        entities: {
          Doc: {
            properties: {
              image: { type: 'string', format: 'file', readAs: 'dataUri' },
              blob: { type: 'string', format: 'file' },
              caption: { type: 'string' },
            },
            relations: {},
          },
        },
      },
      { moduleId: 'test' },
    );

    const props = shapeOf(classes.Doc).properties;
    const image = props.find((p) => p.name === 'image')!;
    const blob = props.find((p) => p.name === 'blob')!;
    const caption = props.find((p) => p.name === 'caption')!;

    expect(image.resolveLanguage).toBe(FILE_STORAGE_LANGUAGE);
    expect(image.transform, 'declared readAs: dataUri').toBeDefined();

    expect(blob.resolveLanguage, 'still stored as a file').toBe(FILE_STORAGE_LANGUAGE);
    expect(blob.transform, 'but handed back for the caller to decode').toBeUndefined();

    // A plain scalar declares no storage language at all, and gains no transform. Absence is the
    // declaration: AD4M reads an unset `resolveLanguage` as "store this as a deterministic typed
    // literal" — the indexed fast path — where `'literal'` would ask for a signed envelope.
    expect(caption.resolveLanguage).toBeUndefined();
    expect(caption.transform).toBeUndefined();
  });

  it('carries declared defaults onto the class and its stored initial value', () => {
    const classes = compileManifest(
      {
        version: '1',
        entities: {
          Task: {
            properties: {
              status: { type: 'string', default: 'todo' },
              weight: { type: 'number', default: 3 },
            },
            relations: {},
          },
        },
      },
      { moduleId: 'test' },
    );

    const instance = new (classes.Task as unknown as new () => Record<string, unknown>)();
    expect(instance.status).toBe('todo');
    expect(instance.weight).toBe(3);
  });

  it('matches how the hand-written models declare the same thing', () => {
    // Space.avatar is the reference: file storage + data-URI transform.
    const spaceImage = shapeOf(ALL_MODELS.find((m) => m.name === 'Space')!).properties.find(
      (p) => p.name === 'avatar',
    )!;
    const compiled = compileManifest(
      {
        version: '1',
        entities: {
          X: { properties: { avatar: { type: 'string', format: 'file', readAs: 'dataUri' } }, relations: {} },
        },
      },
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

  it('mints every predicate inside the module subtree, sharing nothing by accident', () => {
    const entries = manifestToEntries(manifest, { moduleId: 'notes' });
    const note = entries.find((e) => e.name === 'Note')!;
    const byName = Object.fromEntries(note.properties.map((p) => [p.name, p.predicate]));

    // Names that happen to match core vocabulary are NOT quietly bound to it: a module's `title`
    // is its own until the author says otherwise. Predicates are a one-way door, so inheriting a
    // shared name by accident is not a trade the compiler gets to make.
    expect(byName.title).toBe('we://module/notes/title');
    expect(byName.content).toBe('we://module/notes/content');
    expect(byName.pinned).toBe('we://module/notes/pinned');
    expect(byName.viewCount).toBe('we://module/notes/view_count');
    expect(byName.attachments).toBe('we://module/notes/attachments');
  });

  it('shares a core predicate when the declaration asks for it', () => {
    // Opting in is what makes generic UI keyed on `we://name` work against a module's entity.
    const entries = manifestToEntries(manifest, {
      moduleId: 'notes',
      predicates: { 'Note.title': CORE_VOCABULARY.title },
    });
    const note = entries.find((e) => e.name === 'Note')!;
    expect(note.properties.find((p) => p.name === 'title')!.predicate).toBe('we://title');
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
