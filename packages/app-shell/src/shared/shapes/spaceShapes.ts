/**
 * The models a space carries, as the shape store reads and offers them: data in, data out.
 *
 * What the store does with a space's stored models — validate each against what it may name, decide
 * which entities an interpretation pass could write, list what a relationship may point at — is the
 * same rule wherever it is asked, on screen or about a dataset that is not. It is written here once,
 * framework-free, so the store decides only when to ask and the rule is tested directly.
 */
import { type EntityManifest, interpretableEntities, type StoredShape, validateManifest } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';

import { foreignInterpretationCandidates } from './interpretationCandidates';

/**
 * The block composer's own iconography (BlockMenu.tsx), so a block is drawn the same way wherever
 * it is named. Blocks the composer has no insert entry for get the nearest documented icon.
 */
export const BLOCK_ICONS: Record<string, string> = {
  AudioBlock: 'speaker-high',
  CalloutBlock: 'megaphone',
  CodeBlock: 'code',
  // A stack of rows with one more arriving: a collection is a sequence of blocks somebody adds to.
  // `squares-four` is the app's glyph for "some node, kind unknown" — it is what `nodeTypeIcon`
  // falls back to — so a collection drawn with it was indistinguishable from a thing nothing knew
  // anything about.
  CollectionBlock: 'rows-plus-bottom',
  DividerBlock: 'minus',
  EmbedBlock: 'browser',
  EventBlock: 'calendar',
  FileBlock: 'paperclip',
  ImageBlock: 'image',
  LinkBlock: 'link',
  LocationBlock: 'map-pin',
  // Not a block, but drawn from this table wherever a core entity needs a glyph — the chooser, the
  // inspector, the key. Plugs rather than a link, which `LinkBlock` already is: a relationship joins
  // two records, and a URL is a different kind of pointing.
  Relationship: 'plugs',
  TagBlock: 'tag',
  TaskBlock: 'check-square',
  TextBlock: 'text-t',
  VideoBlock: 'youtube-logo',
  // A space's own vocabulary — shown in an inspector and on a map of what it has defined, so drawn
  // with the glyphs the Social DNA lists use.
  InvolvementType: 'hand-waving',
  RelationshipType: 'arrows-left-right',
  SignalType: 'heart',
  TaskState: 'circle-half',
  Topic: 'hash',
};

export interface SpaceShapeView {
  /** The Shape record's id. */
  id: string;
  /** Entity name — what `$query` resolves. */
  name: string;
  description: string;
  icon: string;
  shapeId: string;
  version: number;
  forkedFrom: string;
  propertyCount: number;
  /** Why this shape could not be adopted, empty for a healthy one. */
  problems: string[];
  manifest: EntityManifest | null;
  /** The stored form says exactly what the manifest says — see `StoredShape.editable`. */
  editable: boolean;
}

/** A we-select option row: icon drawn beside the label, group rendered once as a heading. */
export interface RelationshipTargetOption {
  label: string;
  value: string;
  icon?: string;
  group?: string;
}

/**
 * A space's stored models as views, each validated through the gate module manifests pass.
 *
 * Each is validated against everything nameable here except itself: core vocabulary, the classes
 * the space already had (`foreign`), and every other stored model — so sibling references resolve
 * whatever the record order. A model whose definition could not be read, or does not stand, carries
 * its problems and no manifest. One that stands but does not declare the entity it is named after
 * keeps its manifest and says so in its problems.
 */
export function shapeViewsOf(records: readonly StoredShape[], foreign: readonly string[]): SpaceShapeView[] {
  return records.map((record) => {
    const view: SpaceShapeView = {
      id: record.id,
      name: record.name,
      description: record.description,
      icon: record.icon,
      shapeId: record.shapeId,
      version: record.version,
      forkedFrom: record.forkedFrom,
      propertyCount: 0,
      problems: [],
      manifest: null,
      editable: record.editable,
    };
    if (!record.manifest) {
      view.problems = ['definition document missing or unreadable'];
      return view;
    }
    const gate = validateManifest(record.manifest, {
      externalEntities: [
        ...Object.keys(CORE_MANIFEST.entities),
        ...foreign,
        ...records.map((r) => r.name).filter((n) => n !== record.name),
      ],
    });
    if (!gate.valid) {
      view.problems = gate.errors.map((e) => `${e.path}: ${e.message}`);
      return view;
    }
    view.manifest = gate.manifest;
    const entity = gate.manifest.entities[record.name];
    view.propertyCount = entity ? Object.keys(entity.properties).length + Object.keys(entity.relations).length : 0;
    if (!entity) view.problems = [`definition does not declare an entity named "${record.name}"`];
    return view;
  });
}

/** Core vocabulary that declares itself interpretable — `TaskBlock`, `EventBlock` and `Relationship` today. */
const CORE_INTERPRETATION_TARGETS = interpretableEntities(CORE_MANIFEST);

/**
 * What could be interpreted in a space: core vocabulary, then the shapes the community adopted,
 * then the classes the space already had.
 *
 * Core first because those are the entities every space has, so a list that grows as a community
 * defines models reads as an addition rather than a reshuffle. A shape with adoption problems is
 * excluded by `manifest` being null — an entity that is not queryable cannot be minted into either,
 * and offering it would produce a pass that fails on a name the backend has no shape for.
 *
 * The space's own classes come last, so WE's own read first: every class WE did not write, apart
 * from WE's own plumbing, those carrying an interpretation hint first — see
 * `foreignInterpretationCandidates`. One the name of which is already taken (`registered`: core and
 * every entity this session resolves) is `shadowed`, not offered.
 *
 * Deduplicated, because a space may name a shape after core vocabulary: the registry prefers the
 * native class, so the two names resolve to one class and requesting it twice would put the same
 * shape in the prompt twice at the community's expense.
 *
 * Candidacy is which models may be extracted into, not which names the registry happens to resolve:
 * an adopted model whose manifest is not extractable resolves all the same.
 */
export function interpretationCandidatesOf(
  shapes: readonly { name: string; manifest: EntityManifest | null }[],
  foreign: readonly { name: string; interpretationHint?: string }[],
  registered: readonly string[],
): { candidates: string[]; shadowed: string[] } {
  const { offered, shadowed } = foreignInterpretationCandidates(foreign, {
    taken: [...Object.keys(CORE_MANIFEST.entities), ...registered],
    adopted: shapes.map((shape) => shape.name),
  });
  return {
    candidates: [
      ...new Set([
        ...CORE_INTERPRETATION_TARGETS,
        ...shapes.flatMap((shape) => (shape.manifest ? interpretableEntities(shape.manifest) : [])),
        ...offered,
      ]),
    ],
    shadowed,
  };
}

/**
 * What a relationship may point at here, grouped by where it comes from and labelled for the
 * picker: this space's own models first (the interesting case when modelling), then the block
 * vocabulary (attaching content — a photo, a place), then any foreign app's models.
 *
 * Core entities are offered **only** where they are block types. The rest of core is
 * infrastructure — `Template`, `Theme`, `AgentSettings`, `SpacePreference` — which no community
 * shape should point at, and offering them made the picker read as a dump of everything the app
 * happens to define. The block-suffix rule is the one WE's own model conventions already enforce
 * (`blocks/` holds exactly the `*Block` classes), and it fails safe: a new block type appears here
 * automatically, a new infrastructure entity stays out.
 *
 * Grouped rather than suffixed. "ImageBlock — block" said the name twice, and the suffixes were
 * inconsistent between groups — worst of all "— another app", which asserted an origin nothing
 * established: the backend's foreign classes are every one in the dataset that is not WE's own,
 * whoever put it there. The heading claims only where the model lives, which is all that is known.
 *
 * Block icons are the block composer's own (BlockMenu.tsx), so the two surfaces name a block the
 * same way; a space shape brings the icon its author picked in the wizard.
 */
export function relationshipTargetOptions(
  shapes: readonly { name: string; icon: string; manifest: EntityManifest | null }[],
  foreign: readonly { name: string }[],
): RelationshipTargetOption[] {
  const entry = (name: string, group: string, icon?: string) => ({ label: name, value: name, group, icon });
  const dedupeSort = <T extends { value: string }>(rows: T[]) => {
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.value) && seen.add(r.value)).sort((a, b) => a.value.localeCompare(b.value));
  };
  return [
    ...dedupeSort(shapes.filter((s) => s.manifest).map((s) => entry(s.name, 'This space', s.icon || 'cube'))),
    ...dedupeSort(
      Object.keys(CORE_MANIFEST.entities)
        .filter((name) => name.endsWith('Block'))
        .map((name) => entry(name, 'Blocks', BLOCK_ICONS[name] ?? 'cube')),
    ),
    ...dedupeSort(foreign.map((m) => entry(m.name, 'Other models in this space'))),
  ];
}

/**
 * Entity names a model may legitimately reference: core, the space's own classes, and its other
 * models — every one but the model being edited (`exclude`, its record id).
 */
export function knownEntityNames(
  shapes: readonly { id: string; name: string }[],
  foreign: readonly { name: string }[],
  exclude?: string,
): string[] {
  return [
    ...Object.keys(CORE_MANIFEST.entities),
    ...foreign.map((m) => m.name),
    ...shapes.filter((s) => s.id !== exclude).map((s) => s.name),
  ];
}
