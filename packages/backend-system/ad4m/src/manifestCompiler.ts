/**
 * Manifest → model compiler: turn a backend-neutral `ModelManifest` into installable AD4M model
 * classes, so an entity can be *declared* (data) rather than hand-written as a decorated class.
 *
 * The compiler goes through AD4M's own public decorator API (`@Model`/`@Property`/`@Flag`/
 * `@HasMany`/`@HasOne` applied programmatically) rather than constructing SHACL by hand — the
 * generated class is built by exactly the machinery hand-written models use, so schema generation,
 * setters/adders, and conformance filtering are AD4M's guarantees, not a re-implementation. The
 * golden test (tests/manifestCompiler.test.ts) round-trips every hand-written WE model through the
 * manifest projection to hold that fidelity.
 *
 * v1 scope: scalars and typed relations. Flags are minted automatically (one type flag per
 * entity); defaults, enums, and asset kinds are out of scope — models needing those stay decorated.
 */
import { Ad4mModel, fileToDataUri, Flag, HasMany, HasOne, Model, Property } from '@coasys/ad4m';
import type { EntitySchema, ModelManifest } from '@we/backend-shared';
import { FILE_STORAGE_LANGUAGE } from '@we/models';

import type { ModelManifestEntry } from './manifestTypes';

/** A manifest entry plus the declared extras the neutral projection has no place for. */
export type CompilableEntry = ModelManifestEntry & {
  flag?: { predicate: string; value: string };
  abstract?: boolean;
};

/**
 * WE's core vocabulary, for a declaration that genuinely wants to *share* a predicate rather than
 * mint its own — `predicates: { 'Note.name': CORE_VOCABULARY.name }`.
 *
 * Deliberately NOT applied automatically. Reuse is right when the semantics really match (generic
 * UI keyed on `we://name` then works on the entity for free) and wrong the moment they merely
 * share a word: a module declaring `text` means *its* text, not `TextBlock`'s. Predicates are how
 * existing data is found, so an author must not discover they inherited a shared name — the
 * default mints inside the module's own subtree, and sharing is something you ask for.
 */
export const CORE_VOCABULARY: Record<string, string> = {
  name: 'we://name',
  title: 'we://title',
  description: 'we://description',
  content: 'we://content',
  text: 'we://text',
  url: 'we://url',
  icon: 'we://icon',
  status: 'we://status',
  role: 'we://role',
};

/** camelCase / PascalCase → snake_case, matching WE's predicate style. */
function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

export interface CompileManifestOptions {
  /** Predicates and flag values mint under `we://module/<moduleId>/…` (the enforced module subtree). */
  moduleId: string;
  /** Explicit predicate overrides, keyed `"Entity.property"`. Wins over minting and core vocabulary. */
  predicates?: Record<string, string>;
}

/**
 * Build one model class from an AD4M-side manifest entry (predicates already resolved).
 * Exported for the golden test; `compileManifest` is the author-facing entry point.
 */
export function buildModelFromEntry(
  entry: CompilableEntry,
  opts?: {
    classResolver?: (name: string) => typeof Ad4mModel | undefined;
    flag?: { through: string; value: string };
  },
): typeof Ad4mModel {
  // Field defaults are assigned per instance rather than left on the prototype: a hand-written
  // class initialises them in its constructor, so anything walking an instance's own properties —
  // which the write path does — would otherwise see an object with no fields at all.
  const fieldDefaults: Record<string, unknown> = {};
  const cls = class extends Ad4mModel {
    constructor(...args: unknown[]) {
      super(...(args as ConstructorParameters<typeof Ad4mModel>));
      Object.assign(this, fieldDefaults);
    }
  };
  Object.defineProperty(cls, 'name', { value: entry.name });
  const proto = cls.prototype as unknown as Record<string, unknown>;

  // A declaration's own flag wins over one the caller mints: the value is vocabulary, and a
  // compiler inventing `we://module/x/space` for an entity whose data says `we://space` would
  // orphan every existing instance.
  // An abstract entity is never instantiated, so it carries no type marker — minting one anyway
  // would tag every subtype's instances as the base type too.
  const flag = entry.abstract
    ? undefined
    : entry.flag
      ? { through: entry.flag.predicate, value: entry.flag.value }
      : opts?.flag;
  if (flag) {
    proto.flag = '';
    fieldDefaults.flag = '';
    Flag({ through: flag.through, value: flag.value })(proto as never, 'flag' as never);
  }

  for (const p of entry.properties) {
    // A relation is anything typed `uri` — with a related model (typed) or without (untyped
    // reference collection, e.g. WeNode's comments). Single bare-IRI scalars don't occur in
    // entry projections of decorated relations.
    if (p.relatedModel !== undefined || p.type === 'uri') {
      const resolver = opts?.classResolver;
      const related = p.relatedModel;
      const decorator = p.isCollection ? HasMany : HasOne;
      if (p.isCollection) {
        proto[p.name] = [];
        fieldDefaults[p.name] = [];
      }
      decorator({
        through: p.predicate,
        ...(resolver && related !== undefined ? { target: () => resolver(related) as never } : {}),
      })(proto as never, p.name as never);
    } else {
      // Only what the declaration states. `null` is itself a declared default (an unset file
      // reference), which is why absence is tested rather than falsiness — and a property with no
      // declared default starts unset, so nothing writes an empty value on its behalf.
      const declared = (p as { default?: string | number | boolean | null }).default;
      if (declared !== undefined) {
        proto[p.name] = declared;
        fieldDefaults[p.name] = declared;
      }
      Property({
        through: p.predicate,
        ...(p.required ? { required: true } : {}),
        ...(p.writable === false ? { readOnly: true } : {}),
        ...(p.resolveLanguage !== undefined ? { resolveLanguage: p.resolveLanguage } : {}),
        // Only file properties declared to read back rendered get the data-URI transform; the
        // rest (stored templates, themes, editor state) hand back what the caller decodes itself.
        ...((p as { readAs?: string }).readAs === 'dataUri' ? { transform: fileToDataUri } : {}),
      })(proto as never, p.name as never);
    }
  }

  Model({ name: entry.name })(cls);
  return cls;
}

/**
 * Project a neutral manifest onto AD4M-side entries: resolve each property/relation to a concrete
 * predicate (override → core vocabulary → mint under the module subtree).
 */
export function manifestToEntries(manifest: ModelManifest, opts: CompileManifestOptions): ModelManifestEntry[] {
  const prefix = `we://module/${opts.moduleId}/`;
  const resolvePredicate = (entity: string, prop: string): string =>
    opts.predicates?.[`${entity}.${prop}`] ?? `${prefix}${snakeCase(prop)}`;

  /** Everything an entity declares, including whatever it inherits. */
  const resolved = (name: string): EntitySchema => {
    const entity = manifest.entities[name];
    const parent = entity.extends ? resolved(entity.extends) : undefined;
    if (!parent) return entity;
    return {
      ...entity,
      properties: { ...parent.properties, ...entity.properties },
      relations: { ...parent.relations, ...entity.relations },
      flag: entity.flag ?? parent.flag,
    };
  };

  return Object.keys(manifest.entities).map((name) => {
    const entity = resolved(name);
    return {
      name,
      targetClass: '',
      flag: entity.flag,
      ...(entity.abstract ? { abstract: true } : {}),
      properties: [
        ...Object.entries(entity.properties).map(([propName, spec]) => ({
          name: propName,
          predicate: spec.predicate ?? resolvePredicate(name, propName),
          // The neutral `format: 'file'` binds to this backend's file-storage language; `readAs`
          // decides whether reads come back transformed (see buildModelFromEntry).
          ...(spec.format === 'file' ? { resolveLanguage: FILE_STORAGE_LANGUAGE } : {}),
          ...(spec.readAs === 'dataUri' ? { readAs: 'dataUri' as const } : {}),
          ...(spec.default !== undefined ? { default: spec.default } : {}),
          // datetime/json have no SHACL datatype of their own — stored as strings, like the
          // hand-written models store timestamps.
          type: (spec.type === 'number' ? 'number' : spec.type === 'boolean' ? 'boolean' : 'string') as
            'string' | 'number' | 'boolean',
          isCollection: false,
          required: spec.required ?? false,
          writable: true,
        })),
        ...Object.entries(entity.relations).map(([relName, spec]) => ({
          name: relName,
          predicate: spec.predicate ?? resolvePredicate(name, relName),
          type: 'uri' as const,
          isCollection: spec.cardinality === 'many',
          required: false,
          writable: true,
          ...(spec.target ? { relatedModel: spec.target } : {}),
        })),
      ],
    };
  });
}

/**
 * Compile a neutral manifest into ready-to-install AD4M model classes.
 *
 * Every entity gets a type flag (`we://flag` → `we://module/<id>/<entity>`) so instances are
 * queryable by type — the same discrimination hand-written WE models declare with `@Flag`.
 * The returned record can be passed to `installModuleSdna` / `ensureModelsRegistered` directly.
 */
export function compileManifest(
  manifest: ModelManifest,
  opts: CompileManifestOptions,
): Record<string, typeof Ad4mModel> {
  const classes: Record<string, typeof Ad4mModel> = {};
  const resolver = (name: string) => classes[name];
  const prefix = `we://module/${opts.moduleId}/`;

  for (const entry of manifestToEntries(manifest, opts)) {
    classes[entry.name] = buildModelFromEntry(entry, {
      classResolver: resolver,
      flag: { through: 'we://flag', value: `${prefix}${snakeCase(entry.name)}` },
    });
  }

  return classes;
}
