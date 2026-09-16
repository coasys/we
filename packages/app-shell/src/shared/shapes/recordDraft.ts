/**
 * Turning a model into a form — the derivation behind "create one of these".
 *
 * A space's vocabulary is open-ended. Communities define their own models through the shape wizard,
 * and WE ships a handful of its own, so any surface offering to create a record cannot know at
 * authoring time what it will be asked to create. Writing a form per model is the thing that does
 * not scale: the shape wizard exists precisely so a community can add a model without anybody
 * writing code, and a hand-written form would make the model authorable and its records not.
 *
 * So the form is derived. The manifest already carries what a form needs — the fields a person
 * authors and their order (`EntitySchema.authoring`), the scalar type, whether it is required, its
 * default, its closed vocabulary (`options`) and, where the type does not say, which control to
 * offer (`control`).
 *
 * Pure and framework-free, here rather than in the store, for the same reason `shapeDraft.ts` is:
 * the mapping from a declaration to a set of controls is the part with rules in it, and it is worth
 * testing without mounting anything.
 */
import type { EntityManifest, EntitySchema, PropertySchema } from '@we/backend-shared';

/** Which control a field is edited with. Resolved once, here, so no consumer re-derives it. */
export type RecordControl =
  'text' | 'textarea' | 'number' | 'switch' | 'select' | 'date' | 'datetime' | 'color' | 'file' | 'relation';

/**
 * A chosen file, as the file-storage language takes it — what a `format: 'file'` property is written
 * with on create. Held in the draft rather than uploaded when picked, so a form somebody abandons
 * leaves nothing behind in storage.
 */
export interface FileValue {
  data_base64: string;
  name: string;
  file_type: string;
}

export type RecordFieldValue = string | number | boolean | FileValue;

/**
 * One record a relation field will point at when the form is saved.
 *
 * Either an existing record somebody picked (`id`), or one to be made (`fields`) — made at save
 * rather than when it was filled in, for the reason a file is uploaded at save: a form closed
 * without saving must not leave an orphan image in the space.
 */
export interface RelationEntry {
  /** Stable within the draft — the id for a picked record, a local key for one still to be made. */
  key: string;
  /** What the chip reads: the record's name, or the file's. */
  label: string;
  /** The target model. */
  entity: string;
  id?: string;
  fields?: Record<string, unknown>;
  /** A picture of it to draw on its chip — the chosen image, as a data URI. */
  preview?: string;
}

/** What a relation's target allows a form to do, answered by whoever knows the space's models. */
export interface RelationTargetAbilities {
  /** The target has a form — its own `authoring`, or it is a model this space defined. */
  canCreate: boolean;
  /**
   * Existing records are worth choosing from: anything that is not a block. A block is content
   * owned by what it sits in, so an image is added to a sighting rather than borrowed from another.
   */
  canPick: boolean;
  /** The target's display name — "Image", not `ImageBlock`. */
  label: string;
  /**
   * A control that makes the target in place instead of in a form of its own: a map for a place, an
   * image editor for a picture. Empty for the generic form.
   */
  inline?: '' | 'location' | 'image';
}

export interface RecordField {
  name: string;
  /** Humanised property name — what the label reads. */
  label: string;
  control: RecordControl;
  required: boolean;
  /** Closed vocabulary as `we-select` options. Empty unless `control` is `select`. */
  options: { label: string; value: string }[];
  /** Placeholder text, where the type suggests one worth having. */
  placeholder: string;
  value: RecordFieldValue;
  /**
   * What this field started as, so "has anything been typed" can be answered by comparison.
   *
   * The discard guard used to ask whether a field held *anything* — any number, any non-empty
   * string — and every field is seeded: a number to `0`, a select to its declared default. So an
   * untouched `TaskBlock` form (`status: 'todo'`) reported itself dirty, and closing a form nobody
   * had touched raised "discard your changes?". A dialog people learn to click through is worse
   * than no dialog.
   */
  initial: RecordFieldValue;
  /** A `file` control's accepted types (`image/*`), or empty for any file. */
  accept: string;
  /** For a `relation` field: the model it points at, and whether it holds several. Empty otherwise. */
  target: string;
  targetLabel: string;
  many: boolean;
  canCreate: boolean;
  canPick: boolean;
  /** For a `relation` field: the in-place control its target is made with, or empty. See `RelationTargetAbilities`. */
  inline: '' | 'location' | 'image';
  /** For a `relation` field: what it will point at once saved. Empty for every other control. */
  entries: RelationEntry[];
}

export interface RecordDraft {
  /** Entity name — what `record.create` is given, and what `$query` resolves. */
  entity: string;
  /** The model's display name. Same as `entity` for core; a shape carries its own. */
  label: string;
  icon: string;
  fields: RecordField[];
}

/** Names that read wrongly through plain title-casing. */
const ACRONYMS: Record<string, string> = { url: 'URL', uri: 'URI', id: 'ID' };

/**
 * `dueDate` → `Due date`.
 *
 * Sentence case rather than title case: these are labels above a control, and "Due Date" reads as a
 * heading where "Due date" reads as a question. Acronyms are restored afterwards, because a
 * lowercased `url` is the one case where the general rule produces something nobody would write.
 */
export function humanise(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word.toLowerCase());
  if (!words.length) return name;
  const [first, ...rest] = words;
  return [ACRONYMS[first.toLowerCase()] ?? first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/**
 * Which control a property gets.
 *
 * A closed vocabulary wins over everything: a property with `options` is a choice however it is
 * stored, and offering a text box beside a list of allowed values is how an unrecognised value gets
 * written. After that the declared `control`, then the scalar type.
 */
export function controlFor(property: PropertySchema): RecordControl {
  if (property.options?.length) return 'select';
  // A file is chosen, never typed: a text box on an image's `src` asked for an address nobody has.
  if (property.format === 'file') return 'file';
  if (property.control === 'textarea') return 'textarea';
  if (property.control === 'date') return 'date';
  if (property.control === 'datetime') return 'datetime';
  if (property.control === 'color') return 'color';
  if (property.type === 'boolean') return 'switch';
  if (property.type === 'number') return 'number';
  if (property.type === 'datetime') return 'datetime';
  return 'text';
}

/** What a field starts as: its declared default, or the empty value for its control. */
function initialValue(property: PropertySchema, control: RecordControl): string | number | boolean {
  if (property.default !== undefined && property.default !== null) return property.default;
  if (control === 'switch') return false;
  if (control === 'number') return 0;
  return '';
}

/** Which files a file property takes, read from its name — the manifest carries no media type. */
function acceptFor(name: string): string {
  if (/image|avatar|photo|picture|thumbnail|cover|poster|art|src/i.test(name)) return 'image/*';
  if (/audio/i.test(name)) return 'audio/*';
  if (/video/i.test(name)) return 'video/*';
  return '';
}

/** The fields every kind of row carries, so a consumer can read any of them off any field. */
const NO_RELATION = {
  target: '',
  targetLabel: '',
  many: false,
  canCreate: false,
  canPick: false,
  inline: '' as const,
  entries: [],
};

function fieldFrom(name: string, property: PropertySchema): RecordField {
  const control = controlFor(property);
  const initial = initialValue(property, control);
  return {
    name,
    label: humanise(name),
    control,
    // A default of '' on a required file is the empty value, not an answer.
    required: property.required === true,
    options: (property.options ?? []).map((value) => ({ label: humanise(String(value)), value: String(value) })),
    placeholder: property.control === 'url' ? 'https://…' : '',
    value: initial,
    // Kept beside the value rather than re-derived, so the comparison cannot drift from the seed.
    initial,
    accept: control === 'file' ? acceptFor(name) : '',
    ...NO_RELATION,
    entries: [],
  };
}

function relationFieldFrom(
  name: string,
  target: string,
  many: boolean,
  abilities: RelationTargetAbilities,
): RecordField {
  return {
    name,
    label: humanise(name),
    control: 'relation',
    required: false,
    options: [],
    placeholder: '',
    value: '',
    initial: '',
    accept: '',
    target,
    targetLabel: abilities.label,
    many,
    canCreate: abilities.canCreate,
    canPick: abilities.canPick,
    inline: abilities.inline ?? '',
    entries: [],
  };
}

/**
 * The fields a person fills in for this entity, in order.
 *
 * Two rules, because the two sources of a model answer the question differently. A **core** entity
 * opts in by declaring `authoring`, and only the fields it names are offered — the rest are
 * bookkeeping (`version`) or machine-maintained (`EventBlock.occurrence`), and asking a person for
 * them would be asking them to fill in the implementation. A **community shape** has no such
 * declaration and needs none: every property of a model somebody wrote in the wizard is theirs by
 * construction, so all of them are offered, in declaration order.
 *
 * Relations are absent from both. Pointing one record at another is a different act with a
 * different affordance — see the relationship work — and a picker over every instance in a space
 * would be the wrong one anyway.
 */
/**
 * Whether a built-in entity belongs in a "create something" picker: it has a form, and it is not made
 * somewhere more specific — see `authoring.offered` in the manifest. Shapes a community defined are
 * always offered and never ask this.
 */
export function offeredForCreation(schema: EntitySchema): boolean {
  return Boolean(schema.authoring?.fields.length) && schema.authoring?.offered !== false;
}

export function fieldsFor(
  schema: EntitySchema,
  authorable: boolean,
  relationTarget?: (target: string) => RelationTargetAbilities | undefined,
): RecordField[] {
  const relations = schema.relations ?? {};
  const names =
    schema.authoring?.fields ?? (authorable ? [...Object.keys(schema.properties), ...Object.keys(relations)] : []);
  return names.flatMap((name) => {
    const property = schema.properties[name];
    if (property) return [fieldFrom(name, property)];
    /*
      A relation, where whoever built the draft can say what its target allows.

      Offered only with a declared target: pointing at "anything" is a different question — which
      kind? — and nothing a community defines asks it, since the wizard refuses a relationship
      with nothing to point at. And only where the caller answers for the target, because a form
      control that can neither make nor pick anything is a control that does nothing.
    */
    const relation = relations[name];
    const abilities = relation?.target ? relationTarget?.(relation.target) : undefined;
    if (relation?.target && abilities && (abilities.canCreate || abilities.canPick)) {
      return [relationFieldFrom(name, relation.target, relation.cardinality === 'many', abilities)];
    }
    // A declaration naming a member the entity does not have is an authoring error in the
    // manifest, not something to render an empty control for.
    return [];
  });
}

/**
 * A model name, or nothing — from a caller that may have been handed something else entirely.
 *
 * `$action` with no `args` forwards the handler's own arguments, so a store method reached from a
 * button and declaring an optional leading parameter receives a `PointerEvent`. It surfaced as a
 * toast reading `No model named "[object PointerEvent]" in this space`, which is the failure being
 * loud enough to find and still a failure.
 *
 * Here rather than inline in the store so the rule is testable without mounting anything, and so
 * the next store method with an optional leading string has somewhere to reach for.
 */
export function asEntityName(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export interface DraftSource {
  entity: string;
  label?: string;
  icon?: string;
  schema: EntitySchema;
  /** True for a model this space defined: every property is the author's. */
  authorable: boolean;
  /** What each relation's target allows. Absent, a draft offers no relation fields. */
  relationTarget?: (target: string) => RelationTargetAbilities | undefined;
}

export function emptyRecordDraft(source: DraftSource): RecordDraft {
  return {
    entity: source.entity,
    label: source.label || source.entity,
    icon: source.icon || 'cube',
    fields: fieldsFor(source.schema, source.authorable, source.relationTarget),
  };
}

/** Find an entity in a shape's own manifest — a shape manifest holds exactly one entity of interest. */
export function schemaFromManifest(manifest: EntityManifest, entity: string): EntitySchema | undefined {
  return manifest.entities[entity];
}

/**
 * Write one field's value, in place.
 *
 * Mutation rather than replacement, and the reason is the renderer: `$each` draws rows with Solid's
 * `<For>`, which keys on **object identity**. A draft rebuilt on every keystroke gives every row a
 * new object, so every control is torn down and remade — and the input being typed into loses focus
 * after a single character.
 *
 * Here rather than inline in the store so the invariant is testable without mounting anything. What
 * the tests pin is not the value — that part is obvious — but that the array and the field objects
 * come back *the same objects*, which is the whole of the fix and the part a later tidy-up would
 * otherwise quietly undo.
 */
export function writeFieldValue(draft: RecordDraft | null, name: string, value: RecordFieldValue): void {
  const field = draft?.fields.find((row) => row.name === name);
  if (field) field.value = value;
}

/**
 * What is stopping this draft being saved.
 *
 * Only the checks the declaration actually supports. A `required` property with nothing in it is
 * one; anything richer — a URL that parses, a date in range — is not declared anywhere, and
 * inventing rules here would refuse values the backend accepts.
 */
export function recordDraftErrors(draft: RecordDraft): string[] {
  return draft.fields
    .filter((field) => field.required && isBlank(field.value))
    .map((field) => `${field.label} is required.`);
}

function isBlank(value: RecordFieldValue): boolean {
  return typeof value === 'string' ? value.trim() === '' : value === null || value === undefined;
}

/**
 * The draft as the object `record.create` takes.
 *
 * Blank optional fields are dropped rather than written as empty strings. `''` now means "clear
 * this property" (see the AD4M adapter's `clearOnEmpty`), so writing one on a *create* is a link
 * removal against a record that has nothing to remove — noise rather than the trap it used to be,
 * and still worth not emitting. Absent and empty read the same on screen; absent is the honest one.
 */
export function recordDraftFields(draft: RecordDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of draft.fields) {
    // A relation is linked after the record exists — the ORM skips a relation in a create payload.
    if (field.control === 'relation') continue;
    if (!field.required && isBlank(field.value)) continue;
    out[field.name] = field.control === 'number' ? Number(field.value) : field.value;
  }
  return out;
}

/**
 * Whether anything in the draft differs from how it opened — a value changed, a file chosen, a
 * relation given something to point at.
 */
export function recordDraftChanged(draft: RecordDraft): boolean {
  return draft.fields.some((f) => {
    if (f.control === 'relation') return f.entries.length > 0;
    if (typeof f.value === 'string' && typeof f.initial === 'string') return f.value.trim() !== f.initial.trim();
    return f.value !== f.initial;
  });
}

/**
 * A relation field with one more entry — or, for a to-one, with this entry instead of the last.
 *
 * Returns a new draft whose other field objects are the *same* objects, so `<For>` keeps every other
 * row mounted and a half-typed input elsewhere keeps its focus. Only the changed row is new, and it
 * has to be: its chips are drawn from `entries`, and an in-place push would draw nothing.
 */
export function withRelationEntry(draft: RecordDraft, name: string, entry: RelationEntry): RecordDraft {
  return {
    ...draft,
    fields: draft.fields.map((field) => {
      if (field.name !== name || field.control !== 'relation') return field;
      if (field.entries.some((existing) => existing.key === entry.key)) return field;
      return { ...field, entries: field.many ? [...field.entries, entry] : [entry] };
    }),
  };
}

export function withoutRelationEntry(draft: RecordDraft, name: string, key: string): RecordDraft {
  return {
    ...draft,
    fields: draft.fields.map((field) =>
      field.name === name && field.control === 'relation'
        ? { ...field, entries: field.entries.filter((entry) => entry.key !== key) }
        : field,
    ),
  };
}

/**
 * What a record made inline is called on its chip: its name if it has one yet, else the file that
 * was chosen for it, else the kind of thing it is.
 */
export function entryLabel(draft: RecordDraft, nameProperty: string, fallback: string): string {
  const named = draft.fields.find((f) => f.name === nameProperty)?.value;
  if (typeof named === 'string' && named.trim()) return named.trim();
  const file = draft.fields.find((f) => f.control === 'file' && typeof f.value === 'object')?.value as
    FileValue | undefined;
  return file?.name || fallback;
}
