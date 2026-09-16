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
import { type EntitySchema, namePropertyOf, type PropertySchema } from '@we/backend-shared';

import { humanise } from './recordDraft';

/**
 * How a field is shown. Resolved once, here, so a template switches on one word rather than
 * re-deriving it from type, control, format and options.
 */
export type DisplayKind =
  | 'text'
  | 'longText'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'color'
  | 'url'
  | 'image'
  | 'file'
  | 'json'
  /**
   * A link to another record, rather than a value of its own.
   *
   * Its own kind because nothing else about a field says "read this through the related instance" —
   * a card shows the target's name, not a URI, and an editor needs a picker over instances rather
   * than a text box. {@link DisplayField.target} names the model it points at, which is also where
   * its icon comes from.
   */
  | 'relation';

/** What a field is *for* in the card, beyond how it is drawn. */
export type DisplayRole = 'title' | 'summary' | 'media' | 'detail';

export interface DisplayField {
  name: string;
  /** Humanised property name — what a caption reads. */
  label: string;
  kind: DisplayKind;
  role: DisplayRole;
  /**
   * The values this field is allowed to hold, when the declaration closes the set — a task's
   * `status`, a signal's `mode`. Empty for an open field.
   *
   * {@link kindFor} deliberately answers `'text'` for these, because a closed vocabulary *is* a
   * string as far as drawing one goes. That is right for rendering and loses the one thing a caller
   * needs to do anything better: a card cannot tell a state worth drawing as a badge from a free
   * sentence, and an *edit* control cannot offer the choices — so it offers a text box, and
   * somebody types "pending" into a field whose model only knows "todo".
   *
   * Carried rather than re-derived because the declaration is the only place the set exists, and a
   * surface rendering a model it was not written for has no other way to ask.
   */
  options: string[];
  /**
   * Which community vocabulary the value is a slug of — `'taskState'` for a task's `status` — or
   * empty for a field whose options are just words.
   *
   * `options` says which slugs are allowed and nothing about what they are called: a slug is what a
   * record stores, and a state's name is what a person reads, and a community can rename one without
   * touching the other. A surface drawing the value needs to know where to look the name up, and the
   * declaration is the only place that knows.
   */
  vocabulary: string;
  /**
   * For a `relation` field, the model it points at — `'LocationBlock'`. Empty for everything else,
   * and for a relation declared against no particular type.
   *
   * What lets a card draw the *target's* icon beside the field, which is the general answer to
   * iconography that a name heuristic only ever approximates: a location relation shows a pin
   * because `LocationBlock` says its icon is a pin, and a community's own model shows whatever icon
   * that community chose, with nothing written for either.
   */
  target: string;
  /** True for a to-many relation, where the value is a list rather than one record. */
  many: boolean;
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
  /**
   * A relation to an `ImageBlock` that pictures the record, or empty — the way a community's model
   * carries a photo, since an image is content with its own alt text rather than a string on the
   * record.
   *
   * Its own key rather than folded into `media`, because the two are read differently: `media` is
   * a value to hand a `we-image` directly, and this is an id (or ids) to look the image up by. A
   * template drawing `row[display.media]` as a picture keeps working, and draws nothing here rather
   * than an id as a URL.
   */
  mediaRelation: string;
  /** Every field worth showing, in order — title, summary and media included, with their role. */
  fields: DisplayField[];
}

/**
 * What a built-in model is called on screen — `EventBlock` is an "Event".
 *
 * `Block` is an implementation word. It says which layer of WE a class belongs to, which matters in
 * the codebase and to nobody reading a card, and it made a review card announce `EVENTBLOCK` over a
 * trip to Bristol. A community's own model already carries a name it chose, so only the built-ins
 * need this.
 *
 * The app was also disagreeing with itself: the extraction chips have humanised these all along
 * (`humanise` in the transcribe store), so the same model read "Event" above the panel and
 * "EventBlock" on the card below it.
 *
 * Exported because a label is not the display's alone — anything naming a model wants the same word.
 */
export function modelLabel(entity: string): string {
  const bare = entity.endsWith('Block') && entity !== 'Block' ? entity.slice(0, -'Block'.length) : entity;
  return humanise(bare);
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
  /**
   * The real list for a property whose vocabulary the community owns — see `vocabulary` on a
   * property declaration.
   *
   * A task's status is the case: its declared `options` are the three defaults an extraction model
   * is shown, and a space that has named "Blocked" can hold a task in a state that list does not
   * contain. Built from `options` alone, every picker in the app then refuses to offer the state the
   * record is already in.
   *
   * Optional, and answering `undefined` falls back to the declaration — which is what this did
   * before it existed, and what a caller with no view of a space still gets.
   */
  vocabularyFor?: (vocabulary: string) => string[] | undefined;
}

export function displayFor(source: DisplaySource): RecordDisplay {
  const { schema } = source;
  const names = fieldNames(schema, source.authorable);
  const properties = schema.properties;

  /**
   * What this property is allowed to hold: the community's list where it owns one, else the
   * declaration's.
   *
   * Empty is treated as absent, not as "nothing is allowed" — a space that has defined no states of
   * its own resolves to the defaults, and a resolver that has not loaded yet must not narrow a
   * picker to nothing on the way past.
   */
  const optionsFor = (name: string): string[] => {
    const property = properties[name];
    const owned = property.vocabulary ? source.vocabularyFor?.(property.vocabulary) : undefined;
    if (owned?.length) return owned.map(String);
    return (property.options ?? []).map(String);
  };

  const declared = schema.display ?? {};
  const pick = (hint: string | undefined, test: (name: string) => boolean): string => {
    if (hint && properties[hint]) return hint;
    return names.find(test) ?? '';
  };

  /*
    What names this record — one shared answer, not this file's own.

    It used to guess here: "the first required string, else the first string", over the *shown*
    field list. Both halves were wrong. Required-ness is a fact about storage that only correlates
    with naming, so `CodeBlock` (whose one required string is `code`) was headed by its entire code
    body, and a `LinkBlock` by its URL. And narrowing to the shown list meant a model that declares
    no field list — a composed document — had no name at all, however plainly its `title` said so.

    `namePropertyOf` reads the declaration first, then the property's *name*, then its shape, over
    every property. See its docblock: eight surfaces were each answering this, and the graph
    disagreeing with this file is what put "Untitled" over a note the canvas had labelled fine.
  */
  const title = namePropertyOf(schema);
  // A long-form string after the title is a summary; so is any other string when nothing is long.
  const summary =
    pick(declared.summary, (name) => name !== title && properties[name].control === 'textarea') ||
    pick(undefined, (name) => name !== title && isString(properties[name]));
  const media = pick(declared.media, (name) => properties[name].format === 'file');
  const relationsDeclared = schema.relations ?? {};
  const isPicture = (name: string) => relationsDeclared[name]?.target === 'ImageBlock';
  // Only when no property already pictures it: a declared `media` naming a relation, else the first
  // relation to an image.
  const mediaRelation = media
    ? ''
    : declared.media && isPicture(declared.media)
      ? declared.media
      : (Object.keys(relationsDeclared).find(isPicture) ?? '');

  const fields: DisplayField[] = names.map((name) => ({
    name,
    label: humanise(name),
    kind: kindFor(name, properties[name]),
    role: name === title ? 'title' : name === summary ? 'summary' : name === media ? 'media' : 'detail',
    // Stringified: a declaration may close a numeric set, and every consumer of this is a control
    // or a label, both of which deal in strings.
    options: optionsFor(name),
    vocabulary: properties[name].vocabulary ?? '',
    target: '',
    many: false,
  }));

  /*
    Relations, which this used to leave out entirely.

    `fields` was built from `properties` alone, so an edge to another record — a `Space`'s location,
    an `EventBlock`'s — was invisible to every surface deriving its display from the declaration. It
    did not render wrongly; it rendered *nothing*, and no diagnostic said a declared part of the
    model was missing from the thing whose whole job is to describe it.

    Appended after the properties rather than interleaved: `display.fields` and `authoring.fields`
    order the scalars, and a relation named in neither has no declared position, so the stable answer
    is "after what was ordered". A relation the author *does* place is picked up in order by the
    filter below, and only the unplaced ones fall to the end.
  */
  const relations = schema.relations ?? {};
  const declaredOrder = schema.display?.fields ?? schema.authoring?.fields ?? [];
  const relationNames = Object.keys(relations).sort((a, b) => {
    const ai = declaredOrder.indexOf(a);
    const bi = declaredOrder.indexOf(b);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  for (const name of relationNames) {
    fields.push({
      name,
      label: humanise(name),
      kind: 'relation',
      role: name === mediaRelation ? 'media' : 'detail',
      options: [],
      vocabulary: '',
      target: relations[name].target ?? '',
      many: relations[name].cardinality === 'many',
    });
  }

  return {
    entity: source.entity,
    label: source.label || source.entity,
    icon: source.icon || 'cube',
    title,
    summary,
    media,
    mediaRelation,
    fields,
  };
}
