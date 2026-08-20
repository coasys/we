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
export type ShapeDraftPropertyType = 'text' | 'number' | 'boolean' | 'date' | 'select';

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

/**
 * A member row from what its author declares, with every derived field computed. The one supported
 * way to build one.
 *
 * Spreading a blank row and assigning over it — what each construction site used to do — leaves
 * `defaultOptions` describing the blank rather than the row: a generated `select` arrived carrying
 * its allowed values and a default picker offering only "None", and only an edit to those values
 * (which routes through {@link syncDerived}) ever put the two in step. Deriving here makes that
 * unrepresentable instead of something every new caller has to remember.
 */
export function draftMember(declared: Partial<ShapeDraftMember> = {}): ShapeDraftMember {
  return syncDerived({
    rowId: nextRowId(),
    // Placeholder — syncDerived computes the real list from `type` and `options` below.
    defaultOptions: [],
    kind: 'property',
    name: '',
    type: 'text',
    required: false,
    hint: '',
    options: '',
    defaultValue: '',
    target: '',
    many: false,
    ...declared,
  });
}

export const emptyDraftProperty = (): ShapeDraftMember => draftMember();

export const emptyDraftRelationship = (): ShapeDraftMember => draftMember({ kind: 'relationship' });

/**
 * A new draft opens with no members. A pre-added blank row asserted the shape of the model before
 * its author said anything — and it put a property first when the right first move may be a
 * relationship, or generating the fields from the description. The wizard shows an empty state in
 * its place, and saving with nothing still fails with "a model needs at least one property".
 */
export const emptyShapeDraft = (): ShapeDraft => ({
  name: '',
  description: '',
  icon: '',
  classHint: '',
  identityMember: '',
  members: [],
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

const SCALAR_OF: Record<ShapeDraftPropertyType, PropertySchema['type']> = {
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

/** A row the author has actually started filling in — a pristine trailing row is not an error. */
export const isTouched = (m: ShapeDraftMember) =>
  Boolean(m.name.trim() || m.hint.trim() || m.options.trim() || m.target || hasDefault(m));

/** Whether a row declares an initial value — the sentinel and the empty string both mean "no". */
const hasDefault = (m: ShapeDraftMember) => m.defaultValue !== '' && m.defaultValue !== NO_DEFAULT;

// ── Telling the author's intent from the machine's output ─────────────────────────────────────

/** The top-level draft fields a generation can answer for itself. */
export type GeneratedField = 'name' | 'description' | 'icon' | 'classHint';

/**
 * What a generation last contributed to a draft.
 *
 * Each field holds the words generation put there, or '' where the author's own were kept — so a
 * field still equal to this one is the machine's, and anything else is the author's.
 */
export interface GeneratedOutput extends Record<GeneratedField, string> {
  /** {@link memberSignature} of the rows it produced. */
  members: string;
}

/**
 * Everything a member row declares, as one comparable string — how a generation's own rows are told
 * apart from rows somebody has since edited. Order is included because reordering is a deliberate
 * edit (declaration order is what the manifest stores), not decoration.
 *
 * Joined on control characters rather than anything typeable: every field here holds user text, and
 * a delimiter somebody can type is one two different field lists can collide on — which would read
 * as "nobody touched this" and replace their work without asking.
 *
 * Blank rows are left out, so adding a property and then thinking better of it does not turn a
 * one-click re-run into a dialog about discarding a row with nothing in it.
 */
export function memberSignature(members: ShapeDraftMember[]): string {
  return members
    .filter(isTouched)
    .map((m) =>
      [m.kind, m.name, m.type, m.required, m.hint, m.options, m.defaultValue, m.target, m.many].join('\u0000'),
    )
    .join('\u0001');
}

/**
 * The author's own words for each top-level field — '' where the field is blank, or where it still
 * holds exactly what the last generation put there.
 *
 * This is the line between a request and an answer, and a re-run needs it in both directions. A
 * description generation wrote is not evidence of what the author wants: prompting with it quotes
 * the previous answer as part of the next question, which is how renaming a model and regenerating
 * returned something half about the old subject. Keeping it would then leave that stale text on
 * screen beside the new fields. So it neither steers the next generation nor survives it — while
 * anything the author typed does both.
 */
export function authoredFields(draft: ShapeDraft, last: GeneratedOutput | null): Record<GeneratedField, string> {
  const authored = (field: GeneratedField): string => {
    const value = draft[field].trim();
    return value && value !== last?.[field].trim() ? value : '';
  };
  return {
    name: authored('name'),
    description: authored('description'),
    icon: authored('icon'),
    classHint: authored('classHint'),
  };
}

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
    const row = draftMember({
      name,
      type: spec.options
        ? 'select'
        : spec.type === 'number'
          ? 'number'
          : spec.type === 'boolean'
            ? 'boolean'
            : spec.type === 'datetime'
              ? 'date'
              : 'text',
      required: spec.required ?? false,
      hint: spec.interpretationHint ?? '',
      options: (spec.options ?? []).map(String).join(', '),
      defaultValue: spec.default === undefined || spec.default === null ? '' : String(spec.default),
      predicate: spec.predicate,
    });
    if (spec.identity) identityMember = row.rowId;
    members.push(row);
  }

  for (const [name, spec] of Object.entries(entity?.relations ?? {})) {
    members.push(
      draftMember({
        kind: 'relationship',
        name,
        target: spec.target,
        many: spec.cardinality === 'many',
        predicate: spec.predicate,
      }),
    );
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
