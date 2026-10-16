/**
 * Project WE's AD4M-side model manifest onto the backend-neutral `EntityManifest` the query IR is
 * validated and compiled against — the concrete WE instance of manifest deliverable (b).
 *
 * The AD4M side (`EntityManifestEntry`, built from SHACL in `perspectiveHelpers.buildEntityManifest`)
 * is a flat property list carrying RDF binding (`predicate`, `relatedEntity`, `resolveLanguage`). This
 * strips all of that: scalars and typed relations are split apart and keyed by name, with no backend
 * binding — the "semantic projection" described in `@we/schema-shared`'s `manifest.ts`. The output is
 * a plain object with no AD4M dependency, so a non-AD4M consumer can hold WE's vocabulary directly.
 */
import type { EntityManifest, PropertySchema, RelationSchema, ScalarType } from '@we/backend-shared';

import type { EntityManifestEntry, EntityManifestProperty } from './manifestTypes';

export interface NeutralManifestResult {
  manifest: EntityManifest;
  /** Non-fatal issues: relations dropped (unknown target) and duplicate entity names collapsed. */
  warnings: string[];
}

/** A bare IRI with no SHACL `sh:class` is an untyped reference/URL → a string scalar (not a relation). */
const SCALAR: Record<EntityManifestProperty['type'], ScalarType> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  uri: 'string',
};

/**
 * Build the neutral `EntityManifest` from the AD4M-side entries. A property is a *typed relation* iff
 * it carries `relatedEntity` (SHACL `sh:class`); everything else is a scalar. Relations whose target
 * isn't among the given entities are dropped (and reported in `warnings`) so the result is always
 * referentially valid.
 *
 * `reverseOf` is not emitted **on this path**, which is the read direction. SHACL says which end
 * owns a link (the entry's `reverse`, from `@BelongsTo*`), but not which relation on the other
 * entity is its forward half, and `reverseOf` names that relation — so reading it back out of a
 * foreign perspective would be a guess. The authoring direction is where the name exists: a
 * relation declaring `reverseOf` in `@we/entities` names it.
 */
export function toNeutralManifest(entries: EntityManifestEntry[], opts?: { version?: string }): NeutralManifestResult {
  const warnings: string[] = [];
  const known = new Set(entries.map((e) => e.name));
  const entities: EntityManifest['entities'] = {};

  for (const entry of entries) {
    if (entry.name in entities) {
      warnings.push(`duplicate entity "${entry.name}" — later definition overwrites the earlier one`);
    }
    const properties: Record<string, PropertySchema> = {};
    const relations: Record<string, RelationSchema> = {};

    for (const p of entry.properties) {
      if (p.relatedEntity !== undefined) {
        if (!known.has(p.relatedEntity)) {
          warnings.push(`dropped relation "${entry.name}.${p.name}" → unknown entity "${p.relatedEntity}"`);
          continue;
        }
        relations[p.name] = {
          target: p.relatedEntity,
          cardinality: p.isCollection ? 'many' : 'one',
          ...(p.interpretationHint !== undefined ? { interpretationHint: p.interpretationHint } : {}),
        };
      } else {
        properties[p.name] = {
          type: SCALAR[p.type],
          ...(p.required ? { required: true } : {}),
          ...(p.interpretationHint !== undefined ? { interpretationHint: p.interpretationHint } : {}),
          ...(p.identity ? { identity: true } : {}),
        };
      }
    }

    entities[entry.name] = {
      properties,
      relations,
      ...(entry.interpretationHint !== undefined ? { interpretationHint: entry.interpretationHint } : {}),
    };
  }

  return { manifest: { version: opts?.version ?? '1', entities }, warnings };
}
