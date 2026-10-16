/**
 * Relations by name, to the predicates AD4M stores them under — the one place this adapter turns a
 * name the contract speaks in into a link it writes or reads.
 *
 * The contract names relations as an entity declares them (`children`, `responses`, `mentions`): a
 * predicate is how *this* backend stores one, and a caller that had to spell it was spelling AD4M.
 * So every port that takes a relation — a record created under a parent, a pass filed into a
 * collection, the records that mention an agent, a flow's guard — resolves it here.
 *
 * Resolved against WE's own manifest and every manifest a module or a space has declared since — the
 * predicates as this adapter actually assigned them (`registerDeclaredRelations`, fed by the schema
 * port): the named entity's relation when the caller says which entity, otherwise the one predicate a
 * relation of that name has across them. Two entities naming a relation alike but storing it
 * differently make the name ambiguous, and that is refused with what to add rather than guessed.
 */
import { CONTAINMENT_PREDICATE, type EntityManifestEntry, type EntitySchema } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';

import { toAd4mPredicate } from './containment';

/** An entity's relations, with what it inherits — every WeNode's own included. */
export function relationsOf(entity: string): EntitySchema['relations'] {
  const schema = CORE_MANIFEST.entities[entity];
  if (!schema) return {};
  return { ...(schema.extends ? relationsOf(schema.extends) : {}), ...schema.relations };
}

/**
 * Relations declared after boot — a module's entities, a space's shapes — by entity, then name, with
 * the predicate the schema port assigned. Global like the entity registry they sit beside: a name
 * is one entity whichever dataset it was declared for.
 */
const declared = new Map<string, Map<string, string>>();

/** Record what a declared manifest's relations are stored under — see the schema port's `declare`. */
export function registerDeclaredRelations(entries: readonly EntityManifestEntry[]): void {
  for (const entry of entries) {
    const relations = declared.get(entry.name) ?? new Map<string, string>();
    for (const property of entry.properties) {
      if (property.predicate) relations.set(property.name, property.predicate);
    }
    declared.set(entry.name, relations);
  }
}

/** The concrete entities WE declares — where a relation named without an entity is looked for. */
export const coreEntities = (): string[] =>
  Object.entries(CORE_MANIFEST.entities)
    .filter(([, schema]) => !schema.abstract)
    .map(([name]) => name);

/**
 * How a relation is stored, or `undefined` for one read backwards from the other end. In AD4M's
 * spelling: containment, which the manifest names by the neutral key, is `has_child` here.
 */
const storedAs = (spec: EntitySchema['relations'][string]): string | undefined =>
  spec.reverseOf ? undefined : toAd4mPredicate(spec.containment ? CONTAINMENT_PREDICATE : spec.predicate);

/**
 * The predicate a relation is stored under. `among` narrows where an unnamed entity is looked for —
 * a flow's subjects, say. Throws, saying what to name, when the relation is unknown, read backwards,
 * or ambiguous.
 */
export function predicateOfRelation(relation: string, entity?: string, among?: readonly string[]): string {
  const candidates = entity ? [entity] : among?.length ? among : [...new Set([...coreEntities(), ...declared.keys()])];
  const found = new Map<string, string[]>();
  let backwards: string | undefined;
  const note = (predicate: string, name: string) => {
    const holders = found.get(predicate) ?? [];
    if (!holders.includes(name)) found.set(predicate, [...holders, name]);
  };
  for (const name of candidates) {
    const spec = relationsOf(name)[relation];
    if (spec) {
      const predicate = storedAs(spec);
      if (predicate) note(predicate, name);
      else backwards ??= name;
      continue;
    }
    const assigned = declared.get(name)?.get(relation);
    if (assigned) note(toAd4mPredicate(assigned), name);
  }
  if (found.size === 1) return [...found.keys()][0];
  if (found.size > 1) {
    throw new Error(
      `"${relation}" is stored differently on ${[...found.values()].flat().join(', ')} — name the entity it is on`,
    );
  }
  if (backwards) {
    throw new Error(
      `"${relation}" on ${backwards} is read backwards from the other end, so nothing can be written through it`,
    );
  }
  throw new Error(`no ${entity ?? 'record'} WE declares holds a relation called "${relation}"`);
}

/**
 * A relation's name, from the predicate it is stored under — {@link predicateOfRelation} backwards.
 * Containment is found under either spelling.
 */
export function relationOfPredicate(predicate: string, among?: readonly string[]): string | undefined {
  const stored = toAd4mPredicate(predicate);
  for (const name of among?.length ? among : coreEntities()) {
    for (const [relation, spec] of Object.entries(relationsOf(name))) {
      if (storedAs(spec) === stored) return relation;
    }
  }
  return undefined;
}

/** A neutral parent reference, as AD4M's model layer takes one. */
export function parentPredicate(parent: { id: string; relation: string; entity?: string }): {
  id: string;
  predicate: string;
} {
  return { id: parent.id, predicate: predicateOfRelation(parent.relation, parent.entity) };
}
