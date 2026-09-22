/**
 * The flat, per-entity manifest form — richer than the neutral `EntityManifest` (it carries the
 * storage binding: predicate, resolveLanguage, related model) but still backend-agnostic in
 * shape. The AD4M adapter builds these from SHACL; `toNeutralManifest` projects them onto the
 * neutral form; the AI layer formats them into prompts.
 */
import { type EntityManifest, type EntitySchema, resolvesPolymorphically } from './manifest';
import { namePropertyOf } from './recordName';

export type EntityManifestProperty = {
  name: string;
  predicate: string;
  type: 'string' | 'number' | 'boolean' | 'uri';
  isCollection: boolean;
  required: boolean;
  writable: boolean;
  resolveLanguage?: string;
  relatedEntity?: string;
  /** LLM guidance for this property when the entity is an interpretation target. */
  interpretationHint?: string;
  /** This property is the entity's interpretation dedup key — see `PropertySchema.identity`. */
  identity?: boolean;
  /** Relations only: the members are in a chosen order — see `RelationSchema.ordered`. */
  ordered?: boolean;
  /**
   * Relations only: each member is read as the class it actually is — see
   * `RelationSchema.polymorphic`. Already resolved through `resolvesPolymorphically`, so a consumer
   * of an entry reads the answer rather than re-deriving the default from an empty `relatedEntity`.
   */
  polymorphic?: boolean;
};

export type EntityManifestEntry = {
  name: string;
  targetClass: string;
  properties: EntityManifestProperty[];
  /** Class-level LLM guidance — see `EntitySchema.interpretationHint`. */
  interpretationHint?: string;
  /**
   * The property that names an instance — see {@link namePropertyOf}.
   *
   * Resolved here rather than by each reader, because "what is this record called" had eight
   * answers in this codebase and two of them were wrong. Carried on the entry so the graph engine,
   * the card derivation and anything else handed a manifest all read the same one.
   *
   * Absent where the entry was built from storage rather than from a declaration (a foreign SHACL
   * class): there is nothing declared to resolve, so a reader falls back to `nameFromProperties`
   * over the properties it already has.
   */
  nameProperty?: string;
};

/**
 * Project a declared {@link EntityManifest} onto the flat entry form — the inverse of
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
export function manifestEntries(
  manifest: EntityManifest,
  opts: { parents?: EntityManifest } = {},
): EntityManifestEntry[] {
  /**
   * Flatten `extends` so an entry carries what it inherits — `scope` resolves on the child's name.
   *
   * A parent this manifest does not declare is read from `opts.parents` — a space shape's manifest
   * holds only the shape, and names `WeNode` from the core vocabulary, which this package cannot
   * import. Not found in either, the entity carries only its own members rather than throwing: an
   * entry list is for reading, and one missing parent should not take every other entry with it.
   */
  const resolved = (name: string): EntitySchema | undefined => {
    const entity = manifest.entities[name] ?? opts.parents?.entities[name];
    if (!entity) return undefined;
    const parent = entity.extends ? resolved(entity.extends) : undefined;
    if (!parent) return entity;
    return {
      ...entity,
      properties: { ...parent.properties, ...entity.properties },
      relations: { ...parent.relations, ...entity.relations },
    };
  };

  return Object.entries(manifest.entities).map(([name, declared]) => {
    const entity = resolved(name) ?? declared;
    // After flattening, so an entity that inherits its naming property from a parent carries it.
    const nameProperty = namePropertyOf(entity);
    return {
      name,
      // The graph marker, where the entity declares one. Empty is legitimate — a backend that keeps
      // entities in their own container has no use for it.
      targetClass: entity.flag?.value ?? '',
      ...(entity.interpretationHint ? { interpretationHint: entity.interpretationHint } : {}),
      ...(nameProperty ? { nameProperty } : {}),
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
            ...(spec.interpretationHint ? { interpretationHint: spec.interpretationHint } : {}),
            ...(spec.identity ? { identity: true } : {}),
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
            // a collection's children. `scope` needs only the predicate, so it resolves either way;
            // `include` used to need a target class to hydrate into, and `polymorphic` below is what
            // replaces that requirement — each member is classified and read as what it is.
            ...(spec.target ? { relatedEntity: spec.target } : {}),
            ...(spec.ordered ? { ordered: true } : {}),
            ...(resolvesPolymorphically(spec) ? { polymorphic: true } : {}),
          })),
      ],
    };
  });
}
