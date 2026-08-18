/**
 * The wizard's editable form of a content model, and its conversion to and from the stored
 * `ModelManifest` — pure data logic, shared by the structured editor and the LLM flow (both
 * produce a draft; everything downstream of the draft is one code path).
 *
 * A draft is deliberately flatter than the manifest: one property row per line the wizard shows,
 * with UI-level types (`select` is a string with declared options, `reference` is a relation)
 * that `draftToManifest` lowers onto the IR. The lowering also does the two things a stored
 * definition must have that a form needn't: resolved predicates (minted under the shape's own
 * `we://shape/<uuid>/` subtree, preserved verbatim when editing so a rename can never re-mint the
 * storage key existing data lives under) and the type flag.
 */
import type { EntitySchema, ModelManifest, PropertySchema } from '@we/backend-shared';

/** UI-level property types — what the wizard's type dropdown offers. */
export type ShapeDraftPropertyType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'reference';

export interface ShapeDraftProperty {
  /** Field name, camelCase identifier. */
  name: string;
  type: ShapeDraftPropertyType;
  required: boolean;
  /** The dedup key for interpretation — at most one per shape. */
  identity: boolean;
  /** LLM guidance when this shape is an extraction target. Empty = none. */
  hint: string;
  /**
   * `select` only: the closed value set, comma-separated as typed. A raw string rather than an
   * array because it is bound directly to one input — the schema layer has no join operator, and
   * two representations of one field is how a form drifts from what it saves.
   */
  options: string;
  /** Initial value, as typed — coerced by `type` at lowering. Empty = none. */
  defaultValue: string;
  /** `reference` only: the target entity name (core vocabulary or another shape). */
  target: string;
  /** `reference` only: to-many when true. */
  many: boolean;
  /**
   * The storage key, present when this row came from a stored definition. Never edited and never
   * re-minted: data written under it stays findable whatever the property is displayed as.
   */
  predicate?: string;
}

export interface ShapeDraft {
  /** Entity name, PascalCase identifier (e.g. "Sighting"). */
  name: string;
  description: string;
  icon: string;
  /** Class-level LLM guidance. Empty = none. */
  classHint: string;
  properties: ShapeDraftProperty[];
}

export const emptyShapeDraft = (): ShapeDraft => ({
  name: '',
  description: '',
  icon: '',
  classHint: '',
  properties: [emptyDraftProperty()],
});

export const emptyDraftProperty = (): ShapeDraftProperty => ({
  name: '',
  type: 'text',
  required: false,
  identity: false,
  hint: '',
  options: '',
  defaultValue: '',
  target: '',
  many: false,
});

/** The declared option list a draft row's comma-separated `options` means. */
export const parseOptions = (raw: string): string[] =>
  raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

/** camelCase / PascalCase → snake_case, matching WE's predicate style (mirrors the compiler's rule). */
export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/;

const SCALAR_OF: Record<Exclude<ShapeDraftPropertyType, 'reference'>, PropertySchema['type']> = {
  text: 'string',
  number: 'number',
  boolean: 'boolean',
  date: 'datetime',
  select: 'string',
};

/** Coerce the draft's string default onto the property's scalar type; null = not expressible. */
function coerceDefault(type: ShapeDraftPropertyType, raw: string): string | number | boolean | null {
  if (type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : null;
  return raw;
}

export type DraftLowering = { ok: true; manifest: ModelManifest } | { ok: false; errors: string[] };

/**
 * Lower a draft onto the stored form: a single-entity `ModelManifest` with every predicate and the
 * type flag resolved. Form-level validation (identifier rules, duplicates, per-type requirements)
 * happens here with wizard-facing messages; the structural/referential gate (`validateManifest`)
 * still runs on the result — this cannot replace it, only precede it.
 */
export function draftToManifest(draft: ShapeDraft, shapeUuid: string): DraftLowering {
  const errors: string[] = [];
  const name = draft.name.trim();
  if (!IDENTIFIER.test(name)) {
    errors.push('Model name must be a single identifier, e.g. "Sighting" — letters and digits, starting with a letter.');
  }
  const rows = draft.properties.filter((p) => p.name.trim() || p.hint || p.options.trim() || p.target);
  if (rows.length === 0) errors.push('A model needs at least one property.');

  const seen = new Set<string>();
  const prefix = `we://shape/${shapeUuid}/`;
  const properties: Record<string, PropertySchema> = {};
  const relations: EntitySchema['relations'] = {};

  for (const row of rows) {
    const propName = row.name.trim();
    const rowOptions = parseOptions(row.options);
    if (!IDENTIFIER.test(propName)) {
      errors.push(`Property "${propName || '(unnamed)'}" must be a single identifier, e.g. "dueDate".`);
      continue;
    }
    const lower = propName.toLowerCase();
    if (seen.has(lower)) {
      errors.push(`Duplicate property name "${propName}".`);
      continue;
    }
    seen.add(lower);
    const predicate = row.predicate ?? `${prefix}${snakeCase(propName)}`;

    if (row.type === 'reference') {
      if (!row.target) {
        errors.push(`Reference property "${propName}" needs a target model.`);
        continue;
      }
      relations[propName] = { target: row.target, cardinality: row.many ? 'many' : 'one', predicate };
      continue;
    }

    if (row.type === 'select' && rowOptions.length === 0) {
      errors.push(`Select property "${propName}" needs at least one option.`);
      continue;
    }
    const spec: PropertySchema = { type: SCALAR_OF[row.type], predicate };
    if (row.required) spec.required = true;
    if (row.identity) spec.identity = true;
    if (row.hint.trim()) spec.interpretationHint = row.hint.trim();
    if (row.type === 'select') spec.options = rowOptions;
    if (row.defaultValue !== '') {
      const value = coerceDefault(row.type, row.defaultValue);
      if (value === null) {
        errors.push(`Default for "${propName}" is not a valid ${row.type}.`);
        continue;
      }
      spec.default = value;
    }
    properties[propName] = spec;
  }

  const identityRows = rows.filter((r) => r.identity);
  if (identityRows.length > 1) {
    errors.push(`Only one property can be the identity (found: ${identityRows.map((r) => r.name).join(', ')}).`);
  }

  if (errors.length) return { ok: false, errors };

  const entity: EntitySchema = {
    properties,
    relations,
    flag: { predicate: 'we://flag', value: `${prefix}${snakeCase(name)}` },
    ...(draft.classHint.trim() ? { interpretationHint: draft.classHint.trim() } : {}),
  };
  return { ok: true, manifest: { version: '1', entities: { [name]: entity } } };
}

/** The inverse: a stored definition back into the wizard's editable form. */
export function manifestToDraft(
  entityName: string,
  manifest: ModelManifest,
  meta: { description?: string; icon?: string } = {},
): ShapeDraft {
  const entity = manifest.entities[entityName];
  const properties: ShapeDraftProperty[] = [];
  for (const [name, spec] of Object.entries(entity?.properties ?? {})) {
    properties.push({
      ...emptyDraftProperty(),
      name,
      type: spec.options ? 'select' : spec.type === 'number' ? 'number' : spec.type === 'boolean' ? 'boolean' : spec.type === 'datetime' ? 'date' : 'text',
      required: spec.required ?? false,
      identity: spec.identity ?? false,
      hint: spec.interpretationHint ?? '',
      options: (spec.options ?? []).map(String).join(', '),
      defaultValue: spec.default === undefined || spec.default === null ? '' : String(spec.default),
      predicate: spec.predicate,
    });
  }
  for (const [name, spec] of Object.entries(entity?.relations ?? {})) {
    properties.push({
      ...emptyDraftProperty(),
      name,
      type: 'reference',
      target: spec.target,
      many: spec.cardinality === 'many',
      predicate: spec.predicate,
    });
  }
  return {
    name: entityName,
    description: meta.description ?? '',
    icon: meta.icon ?? '',
    classHint: entity?.interpretationHint ?? '',
    properties: properties.length ? properties : [emptyDraftProperty()],
  };
}

/**
 * The v1 edit guard: every storage key the old definition wrote must survive into the new one.
 * Predicates are how existing data is found — a removal or rename orphans every value written
 * under it, silently, on every peer. Renaming/removing waits on the migration design; until then
 * edits are additive and this refuses the rest with the property named.
 */
export function additiveViolations(previous: ModelManifest, next: ModelManifest): string[] {
  const nextPredicates = new Set<string>();
  for (const entity of Object.values(next.entities)) {
    for (const spec of Object.values(entity.properties)) if (spec.predicate) nextPredicates.add(spec.predicate);
    for (const spec of Object.values(entity.relations)) if (spec.predicate) nextPredicates.add(spec.predicate);
  }
  const violations: string[] = [];
  for (const [entityName, entity] of Object.entries(previous.entities)) {
    const check = (kind: string, name: string, predicate?: string) => {
      if (predicate && !nextPredicates.has(predicate)) {
        violations.push(
          `${entityName}.${name} (${predicate}) was removed or renamed — edits are additive for now; existing data would be orphaned`,
        );
      }
      void kind;
    };
    for (const [name, spec] of Object.entries(entity.properties)) check('property', name, spec.predicate);
    for (const [name, spec] of Object.entries(entity.relations)) check('relation', name, spec.predicate);
  }
  return violations;
}
