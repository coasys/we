/**
 * Manifest-aware validation of a query IR: cross-check every entity / property / relation / aggregate
 * name the query references against a `EntityManifest`. This is what makes a bad query fail *loudly*
 * at author time ("`Post` has no property `titel`"; "`author` is not a relation") instead of
 * silently returning nothing at runtime.
 *
 * Assumes the manifest itself is already valid (see `validateManifest`); this validates the *query*
 * against it. Structural IR validity (shape/operators) is `validateQueryIR` — run that first.
 */
import type { EntityManifest, EntitySchema } from './manifest';
import type { Aggregation, Filter, IncludeMap, IRError, QueryIR, Scope, SortKey } from './queryIR';

function propExists(entity: EntitySchema, name: string): boolean {
  return name === 'id' || name in entity.properties;
}

/** Resolve a sort `by` target: an aggregate alias, `id`, a property, or a to-one relation path. */
function sortTargetResolves(
  by: string,
  entityName: string,
  manifest: EntityManifest,
  aggregateAliases: Set<string>,
): boolean {
  if (aggregateAliases.has(by) || by === 'id') return true;
  const entity = manifest.entities[entityName];
  if (!entity) return false;
  if (!by.includes('.')) return by in entity.properties;

  // Dotted path: every segment but the last is a to-ONE relation; the last is a property.
  const segments = by.split('.');
  let current = entityName;
  for (let i = 0; i < segments.length - 1; i++) {
    const rel = manifest.entities[current]?.relations[segments[i]];
    if (!rel || rel.cardinality !== 'one') return false;
    current = rel.target;
  }
  const last = segments[segments.length - 1];
  const target = manifest.entities[current];
  return !!target && (last === 'id' || last in target.properties);
}

function validateFilter(
  filter: Filter,
  entityName: string,
  manifest: EntityManifest,
  path: string,
  errors: IRError[],
): void {
  const entity = manifest.entities[entityName];
  if (!entity) return;
  if ('and' in filter)
    return filter.and.forEach((f, i) => validateFilter(f, entityName, manifest, `${path}.and.${i}`, errors));
  if ('or' in filter)
    return filter.or.forEach((f, i) => validateFilter(f, entityName, manifest, `${path}.or.${i}`, errors));
  if ('not' in filter) return validateFilter(filter.not, entityName, manifest, `${path}.not`, errors);
  if ('rel' in filter) {
    const rel = entity.relations[filter.rel];
    if (!rel) {
      errors.push({ path: `${path}.rel`, message: `"${filter.rel}" is not a relation on "${entityName}"` });
      return;
    }
    if (filter.where) validateFilter(filter.where, rel.target, manifest, `${path}.where`, errors);
    return;
  }
  // Field-compare leaf — must be a scalar property (relations are filtered via `rel`).
  if (!propExists(entity, filter.field)) {
    errors.push({ path: `${path}.field`, message: `"${filter.field}" is not a property of "${entityName}"` });
  }
}

function validateSort(
  sort: SortKey[],
  entityName: string,
  manifest: EntityManifest,
  aggregateAliases: Set<string>,
  path: string,
  errors: IRError[],
): void {
  sort.forEach((key, i) => {
    if (!sortTargetResolves(key.by, entityName, manifest, aggregateAliases)) {
      errors.push({
        path: `${path}.${i}.by`,
        message: `"${key.by}" does not resolve to a property, aggregate, or to-one relation path on "${entityName}"`,
      });
    }
  });
}

function validateSelect(
  select: string[],
  entityName: string,
  manifest: EntityManifest,
  path: string,
  errors: IRError[],
): void {
  const entity = manifest.entities[entityName];
  if (!entity) return;
  select.forEach((name, i) => {
    if (!propExists(entity, name)) {
      errors.push({ path: `${path}.${i}`, message: `"${name}" is not a property of "${entityName}"` });
    }
  });
}

function validateInclude(
  include: IncludeMap,
  entityName: string,
  manifest: EntityManifest,
  path: string,
  errors: IRError[],
): void {
  const entity = manifest.entities[entityName];
  if (!entity) return;
  for (const [key, spec] of Object.entries(include)) {
    // Aliased include (`over` present) → the key is an alias; otherwise the key IS the relation name.
    const aliased = spec !== true && spec.over !== undefined;
    const relName = aliased ? spec.over! : key;
    const rel = entity.relations[relName];
    if (!rel) {
      errors.push({
        path: `${path}.${key}`,
        message: aliased
          ? `"${relName}" (aliased as "${key}") is not a relation on "${entityName}"`
          : `"${key}" is not a relation on "${entityName}"`,
      });
      continue;
    }
    // An alias must not shadow a real property, so result reads stay unambiguous — mirrors aggregates.
    if (aliased && key in entity.properties) {
      errors.push({ path: `${path}.${key}`, message: `include alias "${key}" shadows a property of "${entityName}"` });
    }
    if (spec === true) continue;
    const target = rel.target;
    const sub = `${path}.${key}`;
    if (spec.filter) validateFilter(spec.filter, target, manifest, `${sub}.filter`, errors);
    if (spec.sort) validateSort(spec.sort, target, manifest, new Set(), `${sub}.sort`, errors);
    if (spec.select) validateSelect(spec.select, target, manifest, `${sub}.select`, errors);
    if (spec.include) validateInclude(spec.include, target, manifest, `${sub}.include`, errors);
  }
}

/** Validate a drill-down scope. `via` is only checkable when the anchor entity type is known. */
function validateScope(
  scope: Scope,
  entityName: string,
  manifest: EntityManifest,
  path: string,
  errors: IRError[],
): void {
  if (!scope.anchor) return;
  const anchor = manifest.entities[scope.anchor];
  if (!anchor) {
    errors.push({ path: `${path}.anchor`, message: `unknown anchor entity "${scope.anchor}"` });
    return;
  }
  const rel = anchor.relations[scope.via];
  if (!rel) {
    errors.push({ path: `${path}.via`, message: `"${scope.via}" is not a relation on "${scope.anchor}"` });
    return;
  }
  if (rel.target !== entityName) {
    errors.push({
      path: `${path}.via`,
      message: `relation "${scope.via}" on "${scope.anchor}" targets "${rel.target}", not "${entityName}"`,
    });
  }
}

function validateAggregate(
  agg: Aggregation,
  entityName: string,
  entity: EntitySchema,
  manifest: EntityManifest,
  path: string,
  errors: IRError[],
): void {
  // Alias must not shadow a real property (so `sort.by`/result reads are unambiguous).
  if (agg.as in entity.properties) {
    errors.push({ path: `${path}.as`, message: `aggregate alias "${agg.as}" shadows a property of "${entityName}"` });
  }
  const rel = entity.relations[agg.over];
  if (!rel) {
    errors.push({ path: `${path}.over`, message: `"${agg.over}" is not a relation on "${entityName}"` });
    return;
  }
  const target = manifest.entities[rel.target];
  if (agg.fn !== 'count') {
    if (!agg.field) {
      errors.push({ path: `${path}.field`, message: `aggregate fn "${agg.fn}" requires a field` });
    } else if (target && !(agg.field in target.properties)) {
      errors.push({ path: `${path}.field`, message: `"${agg.field}" is not a property of "${rel.target}"` });
    }
  }
  if (agg.filter && target) validateFilter(agg.filter, rel.target, manifest, `${path}.filter`, errors);
}

/** Validate a query IR against a manifest. Run after `validateQueryIR` (structure) + `validateManifest`. */
export function validateQueryAgainstManifest(
  query: QueryIR,
  manifest: EntityManifest,
): { valid: true } | { valid: false; errors: IRError[] } {
  const root = manifest.entities[query.entity];
  if (!root) {
    return { valid: false, errors: [{ path: 'entity', message: `unknown entity "${query.entity}"` }] };
  }
  const errors: IRError[] = [];
  const aggregateAliases = new Set((query.aggregate ?? []).map((a) => a.as));

  (query.aggregate ?? []).forEach((agg, i) =>
    validateAggregate(agg, query.entity, root, manifest, `aggregate.${i}`, errors),
  );
  if (query.filter) validateFilter(query.filter, query.entity, manifest, 'filter', errors);
  if (query.sort) validateSort(query.sort, query.entity, manifest, aggregateAliases, 'sort', errors);
  if (query.select) validateSelect(query.select, query.entity, manifest, 'select', errors);
  if (query.include) validateInclude(query.include, query.entity, manifest, 'include', errors);
  if (query.scope) validateScope(query.scope, query.entity, manifest, 'scope', errors);

  return errors.length ? { valid: false, errors } : { valid: true };
}
