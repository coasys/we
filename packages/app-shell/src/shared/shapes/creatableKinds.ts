/**
 * Which kinds of record can be made here, which can be shown, and how each is laid out — the record
 * store's lists, worked out from the manifests with nothing reactive about them.
 *
 * The store holds them as memos over the space's shapes and the dataset's classes; these are the rules,
 * so they can be read and tested without one.
 */
import { type EntityManifestEntry, type EntitySchema, namePropertyOf } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';

import { kindHue } from '../kindHue';
import { WE_PLUMBING_CLASSES } from './interpretationCandidates';
import { displayFor, modelLabel, type RecordDisplay } from './recordDisplay';
import { type CreationPath, creationPath, type RelationTargetAbilities } from './recordDraft';
import { BLOCK_ICONS, type SpaceShapeView } from './spaceShapes';

/** A `we-select` row: the model's name, drawn with its icon and grouped by where it comes from. */
export interface CreatableEntity {
  label: string;
  value: string;
  icon: string;
  /** The palette hue it is drawn in where the community has not chosen a colour — see `kindHue`. */
  hue: string;
  group: string;
  /** What this kind of thing is, in a line — the manifest's `description`, or the shape's. Empty when neither says. */
  description: string;
  /**
   * How it is made. A surface that can only host a form — the record form's type selector — lists
   * the `form` ones; a surface that can open the composer too (a canvas) lists them all.
   */
  via: CreationPath;
}

/** A kind that can be shown, made or not: a creatable row without how it is made. */
export type DisplayableKind = Omit<CreatableEntity, 'via' | 'description'>;

/**
 * Models that can be *shown* but are not content anybody creates from a picker — see
 * {@link displayableKinds}. Every core block is shown as well, whether or not it can be made.
 *
 * `Relationship` is drawn between two things rather than filled in from a picker, and it is read
 * constantly all the same: a line on a canvas is one, and clicking it is exactly the moment somebody
 * wants to read it.
 *
 * The space's vocabulary is made in its settings, never from a picker, and is read in an inspector
 * and on a map of what the space has defined — each as the fields its settings form asks for.
 */
export const DISPLAY_ONLY = [
  'Relationship',
  'SignalType',
  'RelationshipType',
  'TaskState',
  'InvolvementType',
  'Topic',
] as const;

/**
 * WE's own content a person can make, read straight off the core manifest — every block there is a
 * way to make, and how. See `creationPath`.
 *
 * Derived rather than listed, so a block that gains a form appears here with no second edit in a
 * different package — the failure mode a hardcoded table has is that it is correct on the day it is
 * written and silently stale afterwards. And by declaration rather than by name: nothing that is not
 * content needs a flag to stay out.
 */
export function coreCreatables(): CreatableEntity[] {
  return Object.entries(CORE_MANIFEST.entities)
    .flatMap(([name, entity]) => {
      const via = creationPath(entity);
      if (!via) return [];
      return [
        {
          label: modelLabel(name),
          value: name,
          icon: BLOCK_ICONS[name] ?? 'cube',
          hue: kindHue(name),
          group: 'Built in',
          description: entity.description ?? '',
          via,
        },
      ];
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Models this community defined. Healthy ones only — a shape that failed adoption is not queryable. */
export function shapeCreatables(shapes: readonly SpaceShapeView[]): CreatableEntity[] {
  return shapes
    .filter((shape) => shape.manifest && !shape.problems.length)
    .map((shape) => ({
      label: shape.name,
      value: shape.name,
      icon: shape.icon || 'cube',
      hue: kindHue(shape.name),
      group: 'This space',
      description: shape.description ?? '',
      via: 'form' as const,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Every model that can be *shown*, which is not the same set as every model that can be *made*.
 *
 * `Relationship` is the case that separated them, and the reason this exists. It is excluded from
 * the creatable list on purpose — a connection is drawn between two things rather than filled in from
 * a picker, so offering it in the "new record" list would be offering a form with two endpoints nobody
 * had chosen. But it is a `WeNode` with a label, a description, comments and signals, and clicking the
 * line that stands for it is exactly the moment somebody wants to read all of that.
 *
 * Deriving one list from the other quietly made "cannot be created here" mean "cannot be displayed",
 * so the inspector showed an empty panel for a connector whose name was drawn on the line beside it.
 * Two questions, two lists — and `CollectionBlock` is the second name it needed: every note on a
 * canvas is one, and every one of them opened that same empty panel.
 *
 * A space's own model named after one of these is left alone: it is already in the creatable list with
 * its own icon and label, and a display derived from the community's shape is the one that should win.
 * The creatable list is handed back as it is when nothing is added.
 */
export function displayableKinds(creatable: CreatableEntity[]): DisplayableKind[] {
  const named = new Set(creatable.map((entity) => entity.value));
  /*
    Every core block too, including the ones there is no way to make — a divider still appears in a
    post, and a quote dropped on a canvas is an embed. The key and the inspector read a kind's name
    and glyph from here.
  */
  const blocks = Object.entries(CORE_MANIFEST.entities)
    .filter(([, entity]) => entity.blockable)
    .map(([name]) => name);
  const extra = [...new Set([...DISPLAY_ONLY, ...blocks])]
    .filter((name) => !named.has(name) && CORE_MANIFEST.entities[name])
    .map((name) => ({
      label: modelLabel(name),
      value: name,
      icon: BLOCK_ICONS[name] ?? 'cube',
      hue: kindHue(name),
      group: 'Built in',
    }));
  return extra.length ? [...creatable, ...extra] : creatable;
}

/** The schema behind a model's name, and whether every property of it belongs to the author. */
export interface KindSchema {
  schema: EntitySchema;
  authorable: boolean;
  icon: string;
  label: string;
}

/**
 * The schema behind a name, and whether every property of it belongs to the author.
 *
 * A community shape carries its own manifest and is authorable in full; a core entity is offered
 * only the fields it declared. Shapes are consulted first so a space that names a model after one
 * of WE's own gets its own, which is the same precedence the graph host uses in reverse and for
 * the same reason — whichever is more local should win where the two can collide.
 */
export function kindSchemaOf(shapes: readonly SpaceShapeView[], entity: string): KindSchema | undefined {
  const shape = shapes.find((row) => row.name === entity && row.manifest);
  const fromShape = shape?.manifest?.entities[entity];
  if (fromShape) return { schema: fromShape, authorable: true, icon: shape?.icon || 'cube', label: entity };

  const core = CORE_MANIFEST.entities[entity];
  if (core) return { schema: core, authorable: false, icon: BLOCK_ICONS[entity] ?? 'cube', label: modelLabel(entity) };
  return undefined;
}

/** The property that holds a target's picture — a file whose name reads as one. */
export function imagePropertyOf(schema: EntitySchema): string {
  return (
    Object.keys(schema.properties).find(
      (name) =>
        schema.properties[name].format === 'file' &&
        /image|avatar|photo|picture|thumbnail|cover|poster|src/i.test(name),
    ) ?? ''
  );
}

/**
 * Whether a relation's target is better made where the relation is than in a form of its own.
 *
 * A place is picked on a map, and a picture is chosen and cropped — neither is a list of fields.
 * The generic nested form asked for a location as two number boxes and showed nothing of an image
 * once it was chosen. So those two targets get the controls WE already has for them, inline: the
 * location picker (with its name and address beneath, as the profile page has) and the image
 * editor with its cropper and a preview.
 */
export function inlineEditorFor(target: string, schema: EntitySchema): RelationTargetAbilities['inline'] {
  if (target === 'LocationBlock') return 'location';
  const picture = imagePropertyOf(schema);
  return picture && schema.properties[picture]?.required ? 'image' : '';
}

/**
 * The property an extraction prompt names a record by — its dedup key, which the backend lists an
 * existing entry under as `title` — or its display name where it declares none.
 */
export function titleFieldOf(schema: EntitySchema): string {
  return Object.entries(schema.properties).find(([, spec]) => spec.identity)?.[0] ?? namePropertyOf(schema);
}

/**
 * Displays for the classes the dataset already had — every one its schema lists from other apps, which is
 * also every one a call may extract into — beside the ones `known` holds.
 *
 * No WE model says how to show one, so its scalar properties are listed as its schema names them —
 * without this an accepted record of one is an empty card, and opening the class from the schema lists
 * nothing readable. Display only: nothing here makes one creatable or placeable. WE's own structural
 * classes are left out, as is any class `known` already shows.
 */
export function foreignDisplays(
  entries: readonly EntityManifestEntry[],
  known: Readonly<Record<string, RecordDisplay>>,
): Record<string, RecordDisplay> {
  const out: Record<string, RecordDisplay> = {};
  const plumbing = new Set<string>(WE_PLUMBING_CLASSES);
  for (const entry of entries) {
    if (known[entry.name] || out[entry.name] || plumbing.has(entry.name)) continue;
    const scalars = entry.properties.filter((p) => p.relatedEntity === undefined);
    const properties = Object.fromEntries(
      scalars.map((p) => [p.name, { type: p.type === 'uri' ? ('string' as const) : p.type }]),
    );
    out[entry.name] = displayFor({
      entity: entry.name,
      label: modelLabel(entry.name),
      icon: 'cube',
      schema: { properties, relations: {}, display: { fields: Object.keys(properties) } },
      authorable: false,
    });
  }
  return out;
}
