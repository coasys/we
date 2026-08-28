/**
 * Turning a model into a display — the read-side counterpart of `recordDraft.ts`.
 *
 * ## Why this exists
 *
 * A content type in WE is a model and two components: one to show an instance, one to edit it. The
 * model is a declaration — a manifest, or a shape a community wrote — and can arrive from anyone.
 * The two components are Solid code, and are the only reason a content type cannot. `recordDraft`
 * already replaced the *input* component for any declared model: a form exists for a model nobody
 * wrote a form for. This replaces the *display* one — a card exists for a model nobody wrote a card
 * for — which is what lets a content type be manifest + fragments all the way down, and cross the
 * trust boundary as data.
 *
 * That is the second rung of the distribution ladder in `docs/internal/plans/module-marketplace.md`,
 * and this is its first step: the derivation. The manifest grows `display` hints for what a form
 * does not need — which property is the title, which the summary, which the picture — and this
 * guesses sensibly without them.
 *
 * Pure and framework-free, for the same reason its sibling is: the mapping from a declaration to
 * something on screen is the part with rules in it, and it is worth testing without mounting
 * anything. A template reads the result through `recordStore.displays` and renders it with ordinary
 * `$each` and `$if` — see the "A record of any type" pattern in the generated reference.
 */
import type { EntitySchema, PropertySchema } from '@we/backend-shared';

import { humanise } from './recordDraft';

/**
 * How a field is shown. Resolved once, here, so a template switches on one word rather than
 * re-deriving it from type, control, format and options.
 */
export type DisplayKind =
  'text' | 'longText' | 'number' | 'boolean' | 'date' | 'datetime' | 'color' | 'url' | 'image' | 'file' | 'json';

/** What a field is *for* in the card, beyond how it is drawn. */
export type DisplayRole = 'title' | 'summary' | 'media' | 'detail';

export interface DisplayField {
  name: string;
  /** Humanised property name — what a caption reads. */
  label: string;
  kind: DisplayKind;
  role: DisplayRole;
}

export interface RecordDisplay {
  /** Entity name — what `$query` resolves and a record's type names. */
  entity: string;
  /** The model's display name. Same as `entity` for core; a shape carries its own. */
  label: string;
  icon: string;
  /** Property holding the instance's name, or empty when nothing qualifies. */
  title: string;
  /** Property shown beneath the title, or empty. */
  summary: string;
  /** Property holding the picture or file, or empty. */
  media: string;
  /** Every field worth showing, in order — title, summary and media included, with their role. */
  fields: DisplayField[];
}

/** Property names that read as a picture when the declaration only says "a file". */
const IMAGE_NAMES = /image|avatar|photo|picture|thumbnail|cover|src|poster/i;

/**
 * Which kind a property is shown as.
 *
 * The same precedence `controlFor` uses on the way in, read the other way: a closed vocabulary is
 * text (the value is one of a few words), a declared `control` says what the string *is*, then the
 * scalar type. A file is a picture when its name says so, because the manifest does not yet carry a
 * media type and a broken image is a worse guess than a download link.
 */
export function kindFor(name: string, property: PropertySchema): DisplayKind {
  if (property.format === 'file') return IMAGE_NAMES.test(name) ? 'image' : 'file';
  if (property.options?.length) return 'text';
  if (property.control === 'textarea') return 'longText';
  if (property.control === 'url') return 'url';
  if (property.control === 'date') return 'date';
  if (property.control === 'datetime' || property.type === 'datetime') return 'datetime';
  if (property.control === 'color') return 'color';
  if (property.type === 'boolean') return 'boolean';
  if (property.type === 'number') return 'number';
  if (property.type === 'json') return 'json';
  return 'text';
}

const isString = (property: PropertySchema | undefined): boolean =>
  property !== undefined && property.type === 'string' && property.format !== 'file';

/**
 * The fields a card lists, in order — the same rule the form uses, because it is the same question:
 * a core entity names what is the author's, a community shape's properties are all theirs.
 * `display.fields` overrides either, since what is worth *showing* is not always what is worth
 * *asking for* (a computed `occurrence` is worth showing and never worth typing).
 */
function fieldNames(schema: EntitySchema, authorable: boolean): string[] {
  const declared = schema.display?.fields ?? schema.authoring?.fields;
  const names = declared ?? (authorable ? Object.keys(schema.properties) : []);
  return names.filter((name) => schema.properties[name] !== undefined);
}

export interface DisplaySource {
  entity: string;
  label?: string;
  icon?: string;
  schema: EntitySchema;
  /** True for a model this space defined: every property is worth showing. */
  authorable: boolean;
}

export function displayFor(source: DisplaySource): RecordDisplay {
  const { schema } = source;
  const names = fieldNames(schema, source.authorable);
  const properties = schema.properties;

  const declared = schema.display ?? {};
  const pick = (hint: string | undefined, test: (name: string) => boolean): string => {
    if (hint && properties[hint]) return hint;
    return names.find(test) ?? '';
  };

  // The first required string is the name of the thing; failing that, the first string at all.
  const title =
    pick(declared.title, (name) => isString(properties[name]) && properties[name].required === true) ||
    pick(undefined, (name) => isString(properties[name]));
  // A long-form string after the title is a summary; so is any other string when nothing is long.
  const summary =
    pick(declared.summary, (name) => name !== title && properties[name].control === 'textarea') ||
    pick(undefined, (name) => name !== title && isString(properties[name]));
  const media = pick(declared.media, (name) => properties[name].format === 'file');

  const fields: DisplayField[] = names.map((name) => ({
    name,
    label: humanise(name),
    kind: kindFor(name, properties[name]),
    role: name === title ? 'title' : name === summary ? 'summary' : name === media ? 'media' : 'detail',
  }));

  return {
    entity: source.entity,
    label: source.label || source.entity,
    icon: source.icon || 'cube',
    title,
    summary,
    media,
    fields,
  };
}
