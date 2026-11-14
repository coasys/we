/**
 * Manifest → model compiler: turn a backend-neutral `EntityManifest` into installable AD4M model
 * classes, so an entity can be *declared* (data) rather than hand-written as a decorated class.
 *
 * The compiler goes through AD4M's own public decorator API (`@Model`/`@Property`/`@Flag`/
 * `@HasMany`/`@HasOne` applied programmatically) rather than constructing SHACL by hand — the
 * generated class is built by exactly the machinery hand-written models use, so schema generation,
 * setters/adders, and conformance filtering are AD4M's guarantees, not a re-implementation. The
 * golden test (tests/manifestCompiler.test.ts) round-trips every hand-written WE model through the
 * manifest projection to hold that fidelity.
 *
 * Scope: scalars, typed relations, defaults, interpretation hints and identity. Flags are minted
 * automatically (one type flag per entity). `options` compiles to `sh:in` — the closed value set
 * the executor enforces from AD4M task A1 on — except on a `vocabulary` property, whose real value
 * set is the space's own (see options.ts). `abstract` compiles to `@Model({ abstract })`, and
 * `extends` to the parent's *shape*: an abstract parent is declared through `implements` (AD4M's
 * is-a is structural — the declaration is the mechanism), a concrete one by extending its class,
 * which is what writes the `sh://node` link.
 */
import {
  Ad4mModel,
  BelongsToMany,
  BelongsToOne,
  fileToDataUri,
  Flag,
  HasMany,
  HasOne,
  Model,
  Property,
} from '@coasys/ad4m';
import {
  CONTAINMENT_PREDICATE,
  type EntityManifest,
  type EntitySchema,
  resolvesPolymorphically,
} from '@we/backend-shared';
import { FILE_STORAGE_LANGUAGE } from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';

import { toAd4mPredicate } from './containment';
import type { EntityManifestEntry } from './manifestTypes';
import { toAd4mOptions } from './options';

/** A manifest entry plus the declared extras the neutral projection has no place for. */
export type CompilableEntry = EntityManifestEntry & {
  flag?: { predicate: string; value: string };
  /** Name of the parent entity — resolved to its *class* at build time, where the link lives. */
  extends?: string;
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
  /**
   * Resolve a relation target defined outside this manifest — a space shape relating to core
   * vocabulary (`LocationBlock`) or to a sibling shape compiled separately. Consulted only after
   * the manifest's own entities; validated with the matching `externalEntities` beforehand.
   */
  resolveExternal?: (name: string) => typeof Ad4mModel | undefined;
}

/**
 * Build one model class from an AD4M-side manifest entry (predicates already resolved).
 * Exported for the golden test; `compileManifest` is the author-facing entry point.
 */
export function buildEntityFromEntry(
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
  /*
    `extends` names the parent's *class*, and how the child binds depends on what that class is.
    A concrete parent is extended in the TypeScript sense: the SDK reads the class's prototype
    chain and writes a `sh://node` link to the parent's shape — the same link every generated
    class's `extends WeNode` already writes. An abstract parent cannot be instantiated and AD4M's
    is-a is structural anyway, so the child declares it through `implements` — `checkImplements`
    holds the child's names against the parent's at declaration, and the flattening in
    `manifestToEntries` is what guarantees them. A parent that resolves to nothing (no resolver
    handed over, or the name registered nowhere) degrades to no parent, exactly the way an
    unresolved relation target does.
  */
  const parentClass = entry.extends ? opts?.classResolver?.(entry.extends) : undefined;
  const abstractParent = (parentClass as { isAbstract?: boolean } | undefined)?.isAbstract === true;
  const cls = class extends (parentClass !== undefined && !abstractParent ? parentClass : Ad4mModel) {
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
    Flag({ through: flag.through, value: flag.value })(proto as never, 'flag');
  }

  for (const p of entry.properties) {
    // A relation is anything typed `uri` — with a related model (typed) or without (untyped
    // reference collection, e.g. WeNode's comments). Single bare-IRI scalars don't occur in
    // entry projections of decorated relations.
    if (p.relatedEntity !== undefined || p.type === 'uri') {
      const resolver = opts?.classResolver;
      const related = p.relatedEntity;
      // A reverse relation reads a link the other end owns, which AD4M spells `@BelongsTo*` — the
      // same predicate, read the other way. As `@HasOne`, `partOf` through containment would read
      // this record's own children rather than its container (see generateClasses.mjs).
      const decorator = p.reverse ? (p.isCollection ? BelongsToMany : BelongsToOne) : p.isCollection ? HasMany : HasOne;
      if (p.isCollection) {
        proto[p.name] = [];
        fieldDefaults[p.name] = [];
      }
      decorator({
        // Entries speak the neutral vocabulary (they are also what `schemas.entries` reports); the
        // stored predicate is this backend's — containment becomes `has_child` here.
        through: toAd4mPredicate(p.predicate),
        ...(resolver && related !== undefined ? { target: () => resolver(related) as never } : {}),
        // The declaration says the members are in a chosen order; the strategy naming *how* that
        // order survives concurrent edits is AD4M's, and belongs here rather than in the manifest.
        ...(p.ordered ? { ordering: { strategy: 'linkedList' as const } } : {}),
        ...(p.polymorphic ? { polymorphic: true } : {}),
        // As for a property below: a declared entity's relation hints reach the stored shape by the
        // same decorator option a hand-written model would use.
        ...(p.interpretationHint !== undefined ? { interpretationHint: p.interpretationHint } : {}),
      })(proto, p.name);
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
        // AD4M infers a property's datatype from the value a constructed instance holds, and a
        // declaration with no default leaves that value unset — so number and boolean say so.
        ...(p.type === 'number' ? { datatype: 'xsd://decimal' } : {}),
        ...(p.type === 'boolean' ? { datatype: 'xsd://boolean' } : {}),
        ...(p.required ? { required: true } : {}),
        ...(p.writable === false ? { readOnly: true } : {}),
        ...(p.resolveLanguage !== undefined ? { resolveLanguage: p.resolveLanguage } : {}),
        // Only file properties declared to read back rendered get the data-URI transform; the
        // rest (stored templates, themes, editor state) hand back what the caller decodes itself.
        ...((p as { readAs?: string }).readAs === 'dataUri' ? { transform: fileToDataUri } : {}),
        // Interpretation metadata rides the same decorators the hand-written models use, so a
        // declared entity's hints reach the stored shape — and therefore the executor — by
        // exactly the path TaskBlock's do.
        ...(p.interpretationHint !== undefined ? { interpretationHint: p.interpretationHint } : {}),
        ...(p.identity ? { identity: true } : {}),
        // The closed value set, written as `sh:in`. Entries only carry this where the property has
        // no `vocabulary` — the suppression lives in the projection (see options.ts).
        ...(p.options !== undefined ? { options: p.options } : {}),
      })(proto as never, p.name as never);
    }
  }

  Model({
    name: entry.name,
    // An abstract entity compiles to AD4M's own abstract: it can never be created, and the
    // executor's model query matches its members by structure.
    ...(entry.abstract ? { abstract: true } : {}),
    // `implements` asserts structure and writes no link — `checkImplements` runs here, at
    // declaration, which is the whole mechanism.
    ...(parentClass !== undefined && abstractParent ? { implements: [parentClass] } : {}),
    ...(entry.interpretationHint !== undefined ? { interpretationHint: entry.interpretationHint } : {}),
  })(cls);
  return cls;
}

/**
 * An entity this manifest declares, or — for a parent it names but does not declare — the core one.
 *
 * A space shape or a module entity is compiled from a manifest holding only itself, so `extends:
 * 'WeNode'` named something the manifest could not see, and the lookup threw on `undefined`.
 * `validateManifest` already accepted it, which made the refusal a crash at adoption rather than a
 * message at save. Reading the parent from the core manifest is what lets a community's model be a
 * complete social object — commented on, reacted to, RSVP'd — the way every built-in content type is.
 */
function schemaOf(manifest: EntityManifest, name: string): EntitySchema {
  const entity = manifest.entities[name] ?? CORE_MANIFEST.entities[name];
  if (!entity) throw new Error(`manifest: "${name}" is not declared here or in the core vocabulary`);
  return entity;
}

/**
 * Project a neutral manifest onto AD4M-side entries: resolve each property/relation to a concrete
 * predicate (override → core vocabulary → mint under the module subtree).
 */
export function manifestToEntries(manifest: EntityManifest, opts: CompileManifestOptions): CompilableEntry[] {
  const prefix = `we://module/${opts.moduleId}/`;
  const resolvePredicate = (entity: string, prop: string): string =>
    opts.predicates?.[`${entity}.${prop}`] ?? `${prefix}${snakeCase(prop)}`;

  /** Everything an entity declares, including whatever it inherits. */
  const resolved = (name: string): EntitySchema => {
    const entity = schemaOf(manifest, name);
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
      // The *declared* parent, even after flattening merged its members in: the class binding in
      // buildEntityFromEntry is what a stored shape can name, the members alone cannot.
      ...(entity.extends ? { extends: entity.extends } : {}),
      ...(entity.abstract ? { abstract: true } : {}),
      ...(entity.interpretationHint !== undefined ? { interpretationHint: entity.interpretationHint } : {}),
      properties: [
        ...Object.entries(entity.properties).map(([propName, spec]) => {
          // `options` becomes `sh:in` on the class; a `vocabulary` property keeps it out — the
          // real list is the space's own and an enforced `sh:in` would reject it (see options.ts).
          const options = toAd4mOptions(spec);
          return {
            name: propName,
            predicate: spec.predicate ?? resolvePredicate(name, propName),
            // The neutral `format: 'file'` binds to this backend's file-storage language; `readAs`
            // decides whether reads come back transformed (see buildEntityFromEntry).
            ...(spec.format === 'file' ? { resolveLanguage: FILE_STORAGE_LANGUAGE } : {}),
            ...(spec.readAs === 'dataUri' ? { readAs: 'dataUri' as const } : {}),
            ...(spec.default !== undefined ? { default: spec.default } : {}),
            ...(spec.interpretationHint !== undefined ? { interpretationHint: spec.interpretationHint } : {}),
            ...(spec.identity ? { identity: true } : {}),
            ...(options !== undefined ? { options } : {}),
            // datetime/json have no SHACL datatype of their own — stored as strings, like the
            // hand-written models store timestamps.
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- this callback's return has no contextual type, so without it the literals widen to string
            type: (spec.type === 'number' ? 'number' : spec.type === 'boolean' ? 'boolean' : 'string') as
              'string' | 'number' | 'boolean',
            isCollection: false,
            required: spec.required ?? false,
            writable: true,
          };
        }),
        ...Object.entries(entity.relations).map(([relName, spec]) => ({
          name: relName,
          // Containment has one name on every backend, whatever a manifest spelled — see
          // `RelationSchema.containment`. The name, not the stored predicate: these entries are
          // also what `schemas.entries` reports, and the compiled class translates it.
          predicate: spec.containment ? CONTAINMENT_PREDICATE : (spec.predicate ?? resolvePredicate(name, relName)),
          type: 'uri' as const,
          isCollection: spec.cardinality === 'many',
          required: false,
          // A `reverseOf` relation reads a link the other entity owns, so it is read-only here:
          // AD4M's `@BelongsTo*` generates no `add`/`remove`/`set`, and an entry claiming otherwise
          // would build a runtime-adopted class that offers writes the hand-written one refuses.
          writable: !spec.reverseOf,
          ...(spec.reverseOf ? { reverse: true } : {}),
          ...(spec.target ? { relatedEntity: spec.target } : {}),
          ...(spec.ordered ? { ordered: true } : {}),
          ...(resolvesPolymorphically(spec) ? { polymorphic: true } : {}),
          ...(spec.interpretationHint !== undefined ? { interpretationHint: spec.interpretationHint } : {}),
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
 * The returned record can be passed to `installModuleSdna` / `ensureEntitiesRegistered` directly.
 */
export function compileManifest(
  manifest: EntityManifest,
  opts: CompileManifestOptions,
): Record<string, typeof Ad4mModel> {
  const classes: Record<string, typeof Ad4mModel> = {};
  const resolver = (name: string) => classes[name] ?? opts.resolveExternal?.(name);
  const prefix = `we://module/${opts.moduleId}/`;

  /*
    Parents before children: an entry's `extends` binds the parent's *class*, so one this manifest
    declares must be built inside this very loop — a parent it does not declare answers through the
    resolver at build time instead. The walk is stable: declaration order wherever `extends` does
    not say otherwise.
  */
  const entries = manifestToEntries(manifest, opts);
  const declared = new Map(entries.map((entry) => [entry.name, entry]));
  const ordered: CompilableEntry[] = [];
  const seen = new Set<string>();
  const visit = (entry: CompilableEntry): void => {
    if (seen.has(entry.name)) return;
    seen.add(entry.name);
    if (entry.extends !== undefined) {
      const parent = declared.get(entry.extends);
      if (parent !== undefined) visit(parent);
    }
    ordered.push(entry);
  };
  for (const entry of entries) visit(entry);

  for (const entry of ordered) {
    classes[entry.name] = buildEntityFromEntry(entry, {
      classResolver: resolver,
      flag: { through: 'we://flag', value: `${prefix}${snakeCase(entry.name)}` },
    });
  }

  return classes;
}
