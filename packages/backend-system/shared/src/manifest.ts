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
 */
export function validateManifest(
  input: unknown,
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

  for (const [entityName, entity] of Object.entries(manifest.entities)) {
    if (entity.extends && !entityNames.has(entity.extends)) {
      errors.push({ path: `entities.${entityName}.extends`, message: `unknown entity "${entity.extends}"` });
    }
    for (const [relName, rel] of Object.entries(entity.relations)) {
      const base = `entities.${entityName}.relations.${relName}`;
      // An empty target is an untyped reference, not a broken one.
      if (rel.target === '') continue;
      if (!entityNames.has(rel.target)) {
        errors.push({ path: `${base}.target`, message: `unknown target entity "${rel.target}"` });
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
