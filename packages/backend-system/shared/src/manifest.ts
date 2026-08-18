/**
 * The model manifest — a backend-neutral description of the entities a template can query: their
 * scalar properties and their typed relations. This is the vocabulary in machine-readable form, and
 * what the query IR is validated and compiled against (`include` needs to know a relation's target
 * and cardinality; filter/sort need to know a property's type).
 *
 * It is a *separate* artifact from any query and from any backend. A third-party host authors a
 * manifest for its own entities; the AD4M adapter produces one from its own models.
 *
 * Relationship to the AD4M-specific manifest (`ModelManifestEntry` in `@we/app-shell`): that one
 * is the AD4M adapter's richer, flatter form — properties and relations in one list, plus RDF
 * binding (`predicate`, `resolveLanguage`, `targetClass`). This neutral form is the semantic
 * projection it maps onto: scalars vs relations separated, keyed by name, no backend binding. The
 * adapter keeps its RDF binding on its side; only this shape crosses into the schema engine.
 */
import { z } from 'zod';

export type ScalarType = 'string' | 'number' | 'boolean' | 'datetime' | 'json';
export type Cardinality = 'one' | 'many';

export interface PropertySchema {
  type: ScalarType;
  required?: boolean;
  /**
   * How the value is *stored*, when that differs from an inline scalar. `'file'` means the
   * property holds binary content written through the host's file storage. Every backend has this
   * problem and solves it differently — AD4M stores an expression through its file-storage
   * language, a SQL host would keep a URL beside a blob store — so the manifest names the intent
   * and each adapter supplies the mechanism.
   */
  format?: 'file';

  /**
   * How a file property reads back. `'dataUri'` means callers get something directly renderable
   * (an `<img src>`), rather than a reference they must fetch themselves.
   *
   * The distinction is load-bearing rather than cosmetic: WE stores avatars and image blocks one
   * way (read as data URIs) and stored templates, themes and editor state the other (read raw,
   * decoded by the caller). A single `format: 'file'` cannot express both, and guessing from the
   * property name would be exactly the kind of silent binding this manifest exists to avoid.
   */
  readAs?: 'dataUri';

  /**
   * Value a new instance starts with, and what an adapter writes when the property is required but
   * unset. Declared because it is part of what the entity *is* — a signal type whose range starts
   * at 1, a task that starts `todo` — and would otherwise be lost the moment the definition stops
   * being a hand-written class with field initialisers.
   */
  default?: string | number | boolean | null;

  /**
   * Bind this property to an existing predicate instead of minting one.
   *
   * Core entities need it: their vocabulary (`we://name`, `we://uuid`) predates any minting rule
   * and is how all existing data is found. Modules should rarely use it — minting inside their own
   * subtree is the default precisely so nothing is shared by accident.
   */
  predicate?: string;

  /**
   * What an LLM is told about this property when the entity is an interpretation/extraction
   * target. Prompt payload, not documentation (see TaskBlock's rationale in `@we/models`): the two
   * things it must carry that the type cannot are closed vocabularies and exact value formats.
   * Declared here so a hint survives the definition being data rather than a decorated class —
   * without this field, the one path that makes an entity *declarable* was also the one path that
   * silently dropped its hints.
   */
  interpretationHint?: string;

  /**
   * Marks this property as the entity's dedup key for interpretation. Its presence is what admits
   * the entity to the "instances that already exist" prompt block at all — an entity declaring no
   * identity property is never shown its existing instances, so every extraction pass duplicates.
   * At most one property per entity may carry it.
   */
  identity?: boolean;

  /**
   * Closed set of allowed values, for a property whose vocabulary is fixed ("todo" | "in-progress"
   * | "done"). Manifest-level metadata: derived forms render it as a select, and authoring surfaces
   * fold it into interpretation hints. Backends do not enforce it (v1) — the stored value remains
   * the scalar type.
   */
  options?: (string | number)[];
}

export interface RelationSchema {
  /**
   * Target entity name — must be a key in `ModelManifest.entities`, or empty for an untyped
   * reference (a relation that links to whatever, like a node's comments).
   */
  target: string;
  cardinality: Cardinality;
  /** Name of the inverse relation on the target entity (enables reverse-relation queries). */
  reverseOf?: string;
  /** Bind to an existing predicate instead of minting one — see `PropertySchema.predicate`. */
  predicate?: string;
}

export interface EntitySchema {
  /** Scalar fields, keyed by property name. */
  properties: Record<string, PropertySchema>;
  /** Typed edges, keyed by relation name. */
  relations: Record<string, RelationSchema>;

  /**
   * How instances of this entity are told apart from everything else in the same dataset.
   *
   * Backends that store entities in their own container (a SQL table) can ignore it; graph
   * backends need a marker, and WE's is a fixed predicate/value pair written on every instance.
   * Declared rather than derived because the value is part of the vocabulary — `we://space` is
   * not something a compiler should invent.
   */
  flag?: { predicate: string; value: string };

  /**
   * Name of an entity whose properties, relations and flag this one also has.
   *
   * WE's content entities all extend a common node — comments and signals attach to anything —
   * and repeating that on twenty-odd entities would be the kind of duplication that drifts.
   */
  extends?: string;

  /**
   * A base entity: extended by others, never stored in its own right.
   *
   * It gets no type marker, because nothing is ever *of* this type — every instance is one of its
   * subtypes, and marking them as the base as well would make a query for the base return
   * everything.
   */
  abstract?: boolean;

  /**
   * What an LLM is told this entity *is* when it is an interpretation/extraction target — the
   * class-level counterpart of `PropertySchema.interpretationHint`.
   */
  interpretationHint?: string;
}

export interface ModelManifest {
  version: string;
  /** Entities keyed by name (the key IS the entity name). */
  entities: Record<string, EntitySchema>;
}

// ─── Zod schema (structural validation) ────────────────────────────────────────

const scalarType = z.enum(['string', 'number', 'boolean', 'datetime', 'json']);
const cardinality = z.enum(['one', 'many']);

const propertySchema = z.object({
  type: scalarType,
  required: z.boolean().optional(),
  format: z.literal('file').optional(),
  readAs: z.literal('dataUri').optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  predicate: z.string().optional(),
  interpretationHint: z.string().optional(),
  identity: z.boolean().optional(),
  options: z.array(z.union([z.string(), z.number()])).optional(),
});
const relationSchema = z.object({
  target: z.string(),
  cardinality,
  reverseOf: z.string().optional(),
  predicate: z.string().optional(),
});
const entitySchema = z.object({
  properties: z.record(z.string(), propertySchema),
  relations: z.record(z.string(), relationSchema),
  flag: z.object({ predicate: z.string(), value: z.string() }).optional(),
  extends: z.string().optional(),
  abstract: z.boolean().optional(),
  interpretationHint: z.string().optional(),
});

export const modelManifestSchema = z.object({
  version: z.string(),
  entities: z.record(z.string(), entitySchema),
});

// ─── Validation (structure + referential integrity) ────────────────────────────

export interface ManifestError {
  path: string;
  message: string;
}

/**
 * Validate a manifest: structure (via Zod) plus referential integrity that Zod can't express —
 * every relation `target` names a real entity, and every `reverseOf` names a real relation on that
 * target. Returns the typed manifest when valid.
 *
 * `opts.externalEntities` names entities defined *outside* this manifest that targets and
 * `extends` may legitimately reference — a space shape relating to `LocationBlock` (core
 * vocabulary) or to a sibling shape stored separately. `reverseOf` cannot be checked against an
 * external target (its relations are not in view), so it is refused there rather than guessed at.
 */
export function validateManifest(
  input: unknown,
  opts?: { externalEntities?: Iterable<string> },
): { valid: true; manifest: ModelManifest } | { valid: false; errors: ManifestError[] } {
  const parsed = modelManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  const manifest = parsed.data as ModelManifest;
  const errors: ManifestError[] = [];
  const entityNames = new Set(Object.keys(manifest.entities));
  const external = new Set(opts?.externalEntities ?? []);
  const known = (name: string) => entityNames.has(name) || external.has(name);

  for (const [entityName, entity] of Object.entries(manifest.entities)) {
    if (entity.extends && !known(entity.extends)) {
      errors.push({ path: `entities.${entityName}.extends`, message: `unknown entity "${entity.extends}"` });
    }
    // Exactly-one-at-most is part of what `identity` means (it is THE dedup key), and a manifest
    // author has no other way to find out — the compiler would happily decorate both and the
    // failure would surface as duplicated extractions much later.
    const identityProps = Object.entries(entity.properties)
      .filter(([, spec]) => spec.identity)
      .map(([propName]) => propName);
    if (identityProps.length > 1) {
      errors.push({
        path: `entities.${entityName}.properties`,
        message: `more than one identity property (${identityProps.join(', ')}) — an entity has at most one dedup key`,
      });
    }
    for (const [propName, spec] of Object.entries(entity.properties)) {
      if (!spec.options) continue;
      const base = `entities.${entityName}.properties.${propName}.options`;
      if (spec.options.length === 0) {
        errors.push({ path: base, message: 'options must not be empty — omit the field for an open value' });
      }
      const expected = spec.type === 'number' ? 'number' : spec.type === 'string' ? 'string' : null;
      if (!expected) {
        errors.push({ path: base, message: `options are only meaningful on string/number properties, not "${spec.type}"` });
      } else if (spec.options.some((o) => typeof o !== expected)) {
        errors.push({ path: base, message: `every option must be a ${expected} to match the property type` });
      } else if (spec.default !== undefined && !spec.options.includes(spec.default as string | number)) {
        errors.push({ path: base, message: `default "${spec.default}" is not one of the declared options` });
      }
    }
    for (const [relName, rel] of Object.entries(entity.relations)) {
      const base = `entities.${entityName}.relations.${relName}`;
      // An empty target is an untyped reference, not a broken one.
      if (rel.target === '') continue;
      if (!known(rel.target)) {
        errors.push({ path: `${base}.target`, message: `unknown target entity "${rel.target}"` });
        continue;
      }
      if (rel.reverseOf && !entityNames.has(rel.target)) {
        // The target is external, so its relations are not in view — refusing beats guessing.
        errors.push({
          path: `${base}.reverseOf`,
          message: `cannot declare reverseOf against external entity "${rel.target}"`,
        });
        continue;
      }
      if (rel.reverseOf && !(rel.reverseOf in manifest.entities[rel.target].relations)) {
        errors.push({
          path: `${base}.reverseOf`,
          message: `"${rel.reverseOf}" is not a relation on "${rel.target}"`,
        });
      }
    }
  }

  return errors.length ? { valid: false, errors } : { valid: true, manifest };
}

// ─── Lookup helpers (used by the query engine / IR compiler) ────────────────────

export function getEntity(manifest: ModelManifest, name: string): EntitySchema | undefined {
  return manifest.entities[name];
}

export function getProperty(manifest: ModelManifest, entity: string, property: string): PropertySchema | undefined {
  return manifest.entities[entity]?.properties[property];
}

export function getRelation(manifest: ModelManifest, entity: string, relation: string): RelationSchema | undefined {
  return manifest.entities[entity]?.relations[relation];
}
