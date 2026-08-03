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
import type { ModelManifest } from '@we/backend-shared';
import { FILE_STORAGE_LANGUAGE } from '@we/models';

import type { ModelManifestEntry } from './manifestTypes';

/**
 * Core predicates a manifest property reuses by name instead of minting its own — the module
 * convention's "reuse core vocabulary where semantics match", made deterministic. A module
 * property called `name` means what `we://name` means; generic UI keyed on the core vocabulary
 * then works on module entities for free.
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

/** Instance-default + `initial` for a scalar type, so shape generation infers the right datatype. */
function scalarDefaults(type: string): { value: unknown; initial?: string } {
  switch (type) {
    case 'number':
      return { value: 0, initial: '0' };
    case 'boolean':
      return { value: false, initial: 'false' };
    default:
      return { value: '' };
  }
}

/**
 * Build one model class from an AD4M-side manifest entry (predicates already resolved).
 * Exported for the golden test; `compileManifest` is the author-facing entry point.
 */
export function buildModelFromEntry(
  entry: ModelManifestEntry,
  opts?: {
    classResolver?: (name: string) => typeof Ad4mModel | undefined;
    flag?: { through: string; value: string };
  },
): typeof Ad4mModel {
  const cls = class extends Ad4mModel {};
  Object.defineProperty(cls, 'name', { value: entry.name });
  const proto = cls.prototype as unknown as Record<string, unknown>;

  if (opts?.flag) {
    proto.type = '';
    Flag({ through: opts.flag.through, value: opts.flag.value })(proto as never, 'type' as never);
  }

  for (const p of entry.properties) {
    // A relation is anything typed `uri` — with a related model (typed) or without (untyped
    // reference collection, e.g. WeNode's comments). Single bare-IRI scalars don't occur in
    // entry projections of decorated relations.
    if (p.relatedModel !== undefined || p.type === 'uri') {
      const resolver = opts?.classResolver;
      const related = p.relatedModel;
      const decorator = p.isCollection ? HasMany : HasOne;
      proto[p.name] = p.isCollection ? [] : '';
      decorator({
        through: p.predicate,
        ...(resolver && related !== undefined ? { target: () => resolver(related) as never } : {}),
      })(proto as never, p.name as never);
    } else {
      const defaults = scalarDefaults(p.type);
      proto[p.name] = defaults.value;
      // A property stored through the file-storage language reads back as a data URI — the
      // transform is what makes that true, so it travels with the language rather than being a
      // separate thing an author has to remember.
      const isFile = p.resolveLanguage === FILE_STORAGE_LANGUAGE;
      Property({
        through: p.predicate,
        ...(p.required ? { required: true } : {}),
        ...(p.writable === false ? { readOnly: true } : {}),
        ...(p.resolveLanguage !== undefined ? { resolveLanguage: p.resolveLanguage } : {}),
        ...(isFile ? { transform: fileToDataUri } : {}),
        ...(defaults.initial !== undefined && p.required ? { initial: defaults.initial } : {}),
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
    opts.predicates?.[`${entity}.${prop}`] ?? CORE_VOCABULARY[prop] ?? `${prefix}${snakeCase(prop)}`;

  return Object.entries(manifest.entities).map(([name, entity]) => ({
    name,
    targetClass: '',
    properties: [
      ...Object.entries(entity.properties).map(([propName, spec]) => ({
        name: propName,
        predicate: resolvePredicate(name, propName),
        // The neutral `format: 'file'` binds to this backend's file-storage language; the
        // compiler adds the read transform alongside it (see buildModelFromEntry).
        ...(spec.format === 'file' ? { resolveLanguage: FILE_STORAGE_LANGUAGE } : {}),
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
        predicate: resolvePredicate(name, relName),
        type: 'uri' as const,
        isCollection: spec.cardinality === 'many',
        required: false,
        writable: true,
        relatedModel: spec.target,
      })),
    ],
  }));
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
