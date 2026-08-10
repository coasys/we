/**
 * The flat, per-entity manifest form — richer than the neutral `ModelManifest` (it carries the
 * storage binding: predicate, resolveLanguage, related model) but still backend-agnostic in
 * shape. The AD4M adapter builds these from SHACL; `toNeutralManifest` projects them onto the
 * neutral form; the AI layer formats them into prompts.
 */
import type { EntitySchema, ModelManifest } from './manifest';

export type ModelManifestProperty = {
  name: string;
  predicate: string;
  type: 'string' | 'number' | 'boolean' | 'uri';
  isCollection: boolean;
  required: boolean;
  writable: boolean;
  resolveLanguage?: string;
  relatedModel?: string;
};

export type ModelManifestEntry = {
  name: string;
  targetClass: string;
  properties: ModelManifestProperty[];
};

/**
 * Project a declared {@link ModelManifest} onto the flat entry form — the inverse of
 * `toNeutralManifest`, and neutral in both directions.
 *
 * Here rather than in an adapter because the *host* needs it: the entries it hands the ports are
 * how a query's `scope` resolves a relation, and the host's own entities have to be in that list or
 * no drill-down through core vocabulary can ever resolve. That gap belonged to every backend
 * equally, so fixing it inside one adapter would have left the next to rediscover it.
 *
 * Deliberately does **not** bind storage languages. `manifestToEntries` in the AD4M adapter attaches
 * `FILE_STORAGE_LANGUAGE` to file-format properties, which is that backend's business and would be
 * wrong here; this produces the portable half, which is all `scope` resolution reads. An adapter
 * that needs the binding keeps compiling the manifest itself.
 *
 * Only declared predicates are emitted. A property with none is skipped rather than given a minted
 * one: minting is a backend's decision (and a module's namespace rule), and inventing one here would
 * produce an entry that resolves to a predicate nothing was ever written under — a drill-down that
 * silently returns nothing, which is worse than one that fails loudly.
 */
export function manifestEntries(manifest: ModelManifest): ModelManifestEntry[] {
  /** Flatten `extends` so an entry carries what it inherits — `scope` resolves on the child's name. */
  const resolved = (name: string): EntitySchema => {
    const entity = manifest.entities[name];
    const parent = entity.extends ? resolved(entity.extends) : undefined;
    if (!parent) return entity;
    return {
      ...entity,
      properties: { ...parent.properties, ...entity.properties },
      relations: { ...parent.relations, ...entity.relations },
    };
  };

  return Object.entries(manifest.entities).map(([name]) => {
    const entity = resolved(name);
    return {
      name,
      // The graph marker, where the entity declares one. Empty is legitimate — a backend that keeps
      // entities in their own container has no use for it.
      targetClass: entity.flag?.value ?? '',
      properties: [
        ...Object.entries(entity.properties)
          .filter(([, spec]) => spec.predicate)
          .map(([propName, spec]) => ({
            name: propName,
            predicate: spec.predicate!,
            type: (spec.type === 'number' ? 'number' : spec.type === 'boolean' ? 'boolean' : 'string') as
              'string' | 'number' | 'boolean',
            isCollection: false,
            required: spec.required ?? false,
            writable: true,
          })),
        ...Object.entries(entity.relations)
          .filter(([, spec]) => spec.predicate)
          .map(([relName, spec]) => ({
            name: relName,
            predicate: spec.predicate!,
            type: 'uri' as const,
            isCollection: spec.cardinality === 'many',
            required: false,
            writable: true,
            // Absent for an untyped relation, which is the normal case for a heterogeneous edge like
            // a collection's children. `scope` needs only the predicate, so it resolves either way —
            // it is `include` that requires a target class to hydrate into.
            ...(spec.target ? { relatedModel: spec.target } : {}),
          })),
      ],
    };
  });
}
