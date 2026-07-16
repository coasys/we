/**
 * The model manifest — a backend-neutral description of the entities a template can query: their
 * scalar properties and their typed relations. This is the vocabulary in machine-readable form, and
 * what the query IR is validated and compiled against (`include` needs to know a relation's target
 * and cardinality; filter/sort need to know a property's type).
 *
 * It is a *separate* artifact from any query and from any backend. A third-party host authors a
 * manifest for its own entities; the AD4M adapter produces one from its own models.
 *
 * Relationship to the AD4M-specific manifest (`ModelManifestEntry` in `@we/app-framework`): that one
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
}

export interface RelationSchema {
  /** Target entity name — must be a key in `ModelManifest.entities`. */
  target: string;
  cardinality: Cardinality;
  /** Name of the inverse relation on the target entity (enables reverse-relation queries). */
  reverseOf?: string;
}

export interface EntitySchema {
  /** Scalar fields, keyed by property name. */
  properties: Record<string, PropertySchema>;
  /** Typed edges, keyed by relation name. */
  relations: Record<string, RelationSchema>;
}

export interface ModelManifest {
  version: string;
  /** Entities keyed by name (the key IS the entity name). */
  entities: Record<string, EntitySchema>;
}

// ─── Zod schema (structural validation) ────────────────────────────────────────

const scalarType = z.enum(['string', 'number', 'boolean', 'datetime', 'json']);
const cardinality = z.enum(['one', 'many']);

const propertySchema = z.object({ type: scalarType, required: z.boolean().optional() });
const relationSchema = z.object({
  target: z.string(),
  cardinality,
  reverseOf: z.string().optional(),
});
const entitySchema = z.object({
  properties: z.record(z.string(), propertySchema),
  relations: z.record(z.string(), relationSchema),
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
    for (const [relName, rel] of Object.entries(entity.relations)) {
      const base = `entities.${entityName}.relations.${relName}`;
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
