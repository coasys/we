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
import type { EntitySchema, ModelManifest, PropertySchema } from '@we/backend-shared';

/** Which control a field is edited with. Resolved once, here, so no consumer re-derives it. */
export type RecordControl = 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'date' | 'datetime' | 'color';

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
  value: string | number | boolean;
}

export interface RecordDraft {
  /** Entity name — what `model.create` is given, and what `$query` resolves. */
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

function fieldFrom(name: string, property: PropertySchema): RecordField {
  const control = controlFor(property);
  return {
    name,
    label: humanise(name),
    control,
    required: property.required === true,
    options: (property.options ?? []).map((value) => ({ label: humanise(String(value)), value: String(value) })),
    placeholder: property.control === 'url' ? 'https://…' : '',
    value: initialValue(property, control),
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
export function fieldsFor(schema: EntitySchema, authorable: boolean): RecordField[] {
  const names = schema.authoring?.fields ?? (authorable ? Object.keys(schema.properties) : []);
  return names.flatMap((name) => {
    const property = schema.properties[name];
    // A declaration naming a property the entity does not have is an authoring error in the
    // manifest, not something to render an empty control for.
    return property ? [fieldFrom(name, property)] : [];
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
}

export function emptyRecordDraft(source: DraftSource): RecordDraft {
  return {
    entity: source.entity,
    label: source.label || source.entity,
    icon: source.icon || 'cube',
    fields: fieldsFor(source.schema, source.authorable),
  };
}

/** Find an entity in a shape's own manifest — a shape manifest holds exactly one entity of interest. */
export function schemaFromManifest(manifest: ModelManifest, entity: string): EntitySchema | undefined {
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
export function writeFieldValue(draft: RecordDraft | null, name: string, value: string | number | boolean): void {
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

function isBlank(value: string | number | boolean): boolean {
  return typeof value === 'string' ? value.trim() === '' : value === null || value === undefined;
}

/**
 * The draft as the object `model.create` takes.
 *
 * Blank optional fields are dropped rather than written as empty strings. The ORM skips an empty
 * string on update, so writing one is not merely noise — it is a value that cannot later be
 * cleared, and a record whose `description` is `''` is indistinguishable from one that has never
 * had a description while being harder to change.
 */
export function recordDraftFields(draft: RecordDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of draft.fields) {
    if (!field.required && isBlank(field.value)) continue;
    out[field.name] = field.control === 'number' ? Number(field.value) : field.value;
  }
  return out;
}
