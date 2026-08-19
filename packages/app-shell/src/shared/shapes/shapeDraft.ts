/**
 * The wizard's editable form of a content model, and its conversion to and from the stored
 * `ModelManifest` — pure data logic, shared by the structured editor and the LLM flow (both
 * produce a draft; everything downstream of the draft is one code path).
 *
 * A draft holds one **member** per row the wizard shows, of one of two kinds mirroring the IR's own
 * split: a `property` (a scalar field — `PropertySchema`) or a `relationship` (an edge to another
 * model — `RelationSchema`). They were one row type with a `reference` pseudo-type once; that
 * flattened two genuinely different records into one form whose fields half-applied, which is the
 * shape of a tagged union pretending not to be one.
 *
 * The lowering does the two things a stored definition must have that a form needn't: resolved
 * predicates (minted under the shape's own `we://shape/<uuid>/` subtree, and preserved verbatim
 * when editing so a rename can never re-mint the storage key existing data lives under) and the
 * type flag.
 */
import type { Cardinality, EntitySchema, ModelManifest, PropertySchema } from '@we/backend-shared';

/** UI-level scalar types — what the property row's type dropdown offers. */
export type ShapeDraftPropertyType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'select'
  | 'image';

export interface ShapeDraftMember {
  /**
   * Stable within one editing session, and never stored.
   *
   * Two things need to name a row without using its name or its position: the identity picker
   * (which must survive both a rename and a reorder) and drag-to-reorder (`we-sortable` reports the
   * new order as `data-we-id` values).
   */
  rowId: string;
  /** Which of the IR's two member kinds this row becomes. */
  kind: 'property' | 'relationship';
  /** Field name, camelCase identifier. */
  name: string;

  // ── property only ──
  type: ShapeDraftPropertyType;
  required: boolean;
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
  /**
   * `options` parsed into picker entries, with a leading "no default" — derived, never authored.
   *
   * Kept on the row rather than computed in a memo over the whole list because the list is keyed by
   * row identity: a memo would hand back new objects on every recompute and remount every row,
   * which is the focus bug that made typed edits mutate in place to begin with. Maintained by
   * whoever edits `options` or `type`; ignored entirely by {@link draftToManifest}.
   */
  defaultOptions: { label: string; value: string }[];

  // ── relationship only ──
  /** The target entity name (a block type, another shape, or a foreign model). */
  target: string;
  /** To-many when true. */
  many: boolean;

  /**
   * The storage key, present when this row came from a stored definition. Never edited and never
   * re-minted: data written under it stays findable whatever the member is displayed as.
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
  /**
   * `rowId` of the member that is the interpretation dedup key, or '' for none.
   *
   * At the draft level rather than a flag per row because "at most one" is the whole rule: N
   * independent switches can express a violation the save then has to refuse, where one picker
   * cannot. Keyed by `rowId` so renaming or reordering the chosen field keeps the choice.
   */
  identityMember: string;
  members: ShapeDraftMember[];
}

/**
 * Draft-local row ids. A counter rather than a uuid: these never persist, never cross a process,
 * and a deterministic sequence keeps tests readable.
 */
let rowSeq = 0;
const nextRowId = () => `m${++rowSeq}`;

/** The "leave it unset" entry every default picker opens with. Sentinel, never a stored value. */
export const NO_DEFAULT = '__none__';

/**
 * Rebuild a row's derived picker entries from what it currently declares. Call after any edit to
 * `options` or `type`; safe to call at any time.
 */
export function syncDerived(row: ShapeDraftMember): ShapeDraftMember {
  const none = { label: 'None', value: NO_DEFAULT };
  // A boolean's picker is three-valued on purpose: a switch could only say true or false, and
  // "unset" is a third thing the manifest genuinely distinguishes (no `default` key at all).
  row.defaultOptions =
    row.type === 'boolean'
      ? [none, { label: 'True', value: 'true' }, { label: 'False', value: 'false' }]
      : [none, ...parseOptions(row.options).map((o) => ({ label: o, value: o }))];
  return row;
}

export const emptyDraftProperty = (): ShapeDraftMember => ({
  rowId: nextRowId(),
  defaultOptions: [{ label: 'None', value: NO_DEFAULT }],
  kind: 'property',
  name: '',
  type: 'text',
  required: false,
  hint: '',
  options: '',
  defaultValue: '',
  target: '',
  many: false,
});

export const emptyDraftRelationship = (): ShapeDraftMember => ({ ...emptyDraftProperty(), kind: 'relationship' });

export const emptyShapeDraft = (): ShapeDraft => ({
  name: '',
  description: '',
  icon: '',
  classHint: '',
  identityMember: '',
  members: [emptyDraftProperty()],
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

/**
 * What the author probably meant, as a valid identifier: `"Book Recommendation"` →
 * `BookRecommendation`, `"due date"` → `dueDate`. Empty when nothing salvageable comes out.
 *
 * Worth doing rather than restating the rule, because the rule is what misleads: "must be a single
 * identifier" reads as "one word", when multi-word names are the normal case and only need their
 * spaces closed up. An error that names the fixed spelling teaches that in one line, and can be
 * copied.
 */
export function toIdentifier(raw: string, style: 'Pascal' | 'camel'): string {
  const parts = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return '';
  const joined = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('');
  const suggestion = style === 'camel' ? joined[0].toLowerCase() + joined.slice(1) : joined;
  // A name starting with a digit cannot be rescued by joining words, so offer nothing rather than
  // something that would be refused again.
  return IDENTIFIER.test(suggestion) ? suggestion : '';
}

/** The message for a name that is not an identifier — naming the fix where there is one. */
function badNameMessage(subject: string, raw: string, style: 'Pascal' | 'camel', example: string): string {
  const name = raw.trim();
  if (!name) return `${subject} needs a name, e.g. "${example}".`;
  const suggestion = toIdentifier(name, style);
  const run = style === 'camel' ? 'run words together, starting lowercase' : 'run words together, each capitalised';
  return suggestion
    ? `${subject} names ${run} — try "${suggestion}" instead of "${name}".`
    : `${subject} names must start with a letter and use only letters and digits, e.g. "${example}".`;
}

/*
  Several author-facing types share one scalar, and are told apart in the IR by a second fact:
  long text by `multiline`, an image by `format: 'file'`, a select by carrying `options`. Only
  `date` and `datetime` differ by scalar alone, which is why the IR distinguishes them at all — a
  day and an instant are different facts, and a model reopened for editing has to come back as
  the one it was built as.
*/
const SCALAR_OF: Record<ShapeDraftPropertyType, PropertySchema['type']> = {
  text: 'string',
  longtext: 'string',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime',
  select: 'string',
  image: 'string',
};

/** Which author-facing type a stored property came from — the inverse of {@link SCALAR_OF}. */
function propertyTypeOf(spec: PropertySchema): ShapeDraftPropertyType {
  if (spec.format === 'file') return 'image';
  if (spec.options) return 'select';
  if (spec.type === 'number') return 'number';
  if (spec.type === 'boolean') return 'boolean';
  if (spec.type === 'date') return 'date';
  if (spec.type === 'datetime') return 'datetime';
  return spec.multiline ? 'longtext' : 'text';
}

/** Coerce the draft's string default onto the property's scalar type; null = not expressible. */
function coerceDefault(type: ShapeDraftPropertyType, raw: string): string | number | boolean | null {
  if (type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : null;
  return raw;
}

/** A row the author has actually started filling in — a pristine trailing row is not an error. */
const isTouched = (m: ShapeDraftMember) =>
  Boolean(m.name.trim() || m.hint.trim() || m.options.trim() || m.target || hasDefault(m));

/** Whether a row declares an initial value — the sentinel and the empty string both mean "no". */
const hasDefault = (m: ShapeDraftMember) => m.defaultValue !== '' && m.defaultValue !== NO_DEFAULT;

export type DraftLowering =
  | { ok: true; manifest: ModelManifest }
  /**
   * `rows` names the members an error was raised against, so a collapsed row carrying a mistake can
   * be opened rather than leaving its message pointing at something the reader cannot see.
   */
  | { ok: false; errors: string[]; rows: string[] };

/**
 * Lower a draft onto the stored form: a single-entity `ModelManifest` with every predicate and the
 * type flag resolved. Form-level validation (identifier rules, duplicates, per-kind requirements)
 * happens here with wizard-facing messages; the structural/referential gate (`validateManifest`)
 * still runs on the result — this cannot replace it, only precede it.
 */
export function draftToManifest(draft: ShapeDraft, shapeUuid: string): DraftLowering {
  const errors: string[] = [];
  const errorRows = new Set<string>();
  /** Record a message, and which row (if any) the reader has to open to act on it. */
  const fail = (message: string, rowId?: string) => {
    errors.push(message);
    if (rowId) errorRows.add(rowId);
  };

  const name = draft.name.trim();
  if (!IDENTIFIER.test(name)) fail(badNameMessage('Model', draft.name, 'Pascal', 'BookRecommendation'));
  const rows = draft.members.filter(isTouched);
  if (rows.length === 0) fail('A model needs at least one property.');

  const seen = new Set<string>();
  const prefix = `we://shape/${shapeUuid}/`;
  const properties: Record<string, PropertySchema> = {};
  const relations: EntitySchema['relations'] = {};

  for (const row of rows) {
    const memberName = row.name.trim();
    const label = row.kind === 'relationship' ? 'Relationship' : 'Property';
    if (!IDENTIFIER.test(memberName)) {
      fail(badNameMessage(label, row.name, 'camel', 'dueDate'), row.rowId);
      continue;
    }
    const lower = memberName.toLowerCase();
    if (seen.has(lower)) {
      fail(`Duplicate name "${memberName}" — properties and relationships share one namespace.`, row.rowId);
      continue;
    }
    seen.add(lower);
    const predicate = row.predicate ?? `${prefix}${snakeCase(memberName)}`;

    if (row.kind === 'relationship') {
      if (!row.target) {
        fail(`Relationship "${memberName}" needs something to point at.`, row.rowId);
        continue;
      }
      relations[memberName] = { target: row.target, cardinality: row.many ? 'many' : 'one', predicate };
      continue;
    }

    const rowOptions = parseOptions(row.options);
    if (row.type === 'select' && rowOptions.length === 0) {
      fail(`Select property "${memberName}" needs at least one option.`, row.rowId);
      continue;
    }
    const spec: PropertySchema = { type: SCALAR_OF[row.type], predicate };
    if (row.type === 'longtext') spec.multiline = true;
    if (row.type === 'image') {
      // Binary through the host's file storage, read back as something an <img> can take.
      spec.format = 'file';
      spec.readAs = 'dataUri';
    }
    if (row.required) spec.required = true;
    if (draft.identityMember === row.rowId) spec.identity = true;
    if (row.hint.trim()) spec.interpretationHint = row.hint.trim();
    if (row.type === 'select') spec.options = rowOptions;
    if (hasDefault(row)) {
      const value = coerceDefault(row.type, row.defaultValue);
      if (value === null) {
        fail(`Default for "${memberName}" is not a valid ${row.type}.`, row.rowId);
        continue;
      }
      spec.default = value;
    }
    properties[memberName] = spec;
  }

  // An identity pointing at a relationship (or at a row since deleted) would silently vanish at
  // lowering, leaving a model that looks identity-keyed in the form and is not in the space.
  if (draft.identityMember) {
    const chosen = rows.find((r) => r.rowId === draft.identityMember);
    if (!chosen) {
      fail('The field chosen to identify duplicates no longer exists — pick another, or None.');
    } else if (chosen.kind !== 'property') {
      fail(`"${chosen.name}" is a relationship, so it cannot be the field that identifies duplicates.`, chosen.rowId);
    }
  }

  if (errors.length) return { ok: false, errors, rows: [...errorRows] };

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
  const members: ShapeDraftMember[] = [];
  let identityMember = '';

  for (const [name, spec] of Object.entries(entity?.properties ?? {})) {
    const row: ShapeDraftMember = {
      ...emptyDraftProperty(),
      name,
      type: propertyTypeOf(spec),
      required: spec.required ?? false,
      hint: spec.interpretationHint ?? '',
      options: (spec.options ?? []).map(String).join(', '),
      defaultValue: spec.default === undefined || spec.default === null ? '' : String(spec.default),
      predicate: spec.predicate,
    };
    if (spec.identity) identityMember = row.rowId;
    members.push(syncDerived(row));
  }

  for (const [name, spec] of Object.entries(entity?.relations ?? {})) {
    members.push({
      ...emptyDraftRelationship(),
      name,
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
    identityMember,
    members: members.length ? members : [emptyDraftProperty()],
  };
}

/** What a predicate held in a stored definition, for comparing one version against the next. */
type MemberFacts =
  | { kind: 'property'; where: string; type: PropertySchema['type'] }
  | { kind: 'relationship'; where: string; target: string; cardinality: Cardinality };

function factsByPredicate(manifest: ModelManifest): Map<string, MemberFacts> {
  const facts = new Map<string, MemberFacts>();
  for (const [entityName, entity] of Object.entries(manifest.entities)) {
    for (const [name, spec] of Object.entries(entity.properties)) {
      if (spec.predicate)
        facts.set(spec.predicate, { kind: 'property', where: `${entityName}.${name}`, type: spec.type });
    }
    for (const [name, spec] of Object.entries(entity.relations)) {
      if (spec.predicate) {
        facts.set(spec.predicate, {
          kind: 'relationship',
          where: `${entityName}.${name}`,
          target: spec.target,
          cardinality: spec.cardinality,
        });
      }
    }
  }
  return facts;
}

/**
 * The v1 edit guard: an edit may add, and may not change the meaning of what is already stored.
 *
 * Predicates are how existing data is found, so a removal or rename orphans every value written
 * under one — silently, on every peer. Less obviously, a predicate that *survives* can still be
 * redefined out from under its data: `count: number` edited to `count: text` keeps the storage key
 * and changes how every stored value is read, which no amount of predicate-checking catches.
 *
 * So this compares what each surviving predicate *means*, and refuses anything a migration would
 * have to perform. The one widening allowed is `one` → `many`: an existing single link is already
 * a valid member of a to-many set.
 */
export function additiveViolations(previous: ModelManifest, next: ModelManifest): string[] {
  const before = factsByPredicate(previous);
  const after = factsByPredicate(next);
  const violations: string[] = [];

  for (const [predicate, was] of before) {
    const now = after.get(predicate);
    if (!now) {
      violations.push(
        `${was.where} (${predicate}) was removed or renamed — edits are additive for now; existing data would be orphaned`,
      );
      continue;
    }
    if (was.kind !== now.kind) {
      violations.push(`${was.where} changed from a ${was.kind} to a ${now.kind} — existing data is stored the old way`);
      continue;
    }
    if (was.kind === 'property' && now.kind === 'property' && was.type !== now.type) {
      violations.push(
        `${was.where} changed type from ${was.type} to ${now.type} — values already stored would be read as the new type`,
      );
      continue;
    }
    if (was.kind === 'relationship' && now.kind === 'relationship') {
      if (was.target !== now.target) {
        violations.push(
          `${was.where} now points at ${now.target || 'anything'} instead of ${was.target || 'anything'} — existing links point at the old kind`,
        );
      } else if (was.cardinality === 'many' && now.cardinality === 'one') {
        violations.push(
          `${was.where} changed from many to one — records already holding several would stop conforming`,
        );
      }
    }
  }
  return violations;
}
