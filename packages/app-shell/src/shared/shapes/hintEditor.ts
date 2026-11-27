/**
 * What the hint editor shows for one hint — the rule for reading stored state against a declaration.
 *
 * Pure and framework-free, like the rest of `shared/shapes`, because the decision is subtle enough
 * to be worth stating once and testing directly rather than inferring from a store.
 */
import { type EntityHintState, type EntityManifest, manifestEntries } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';

/**
 * The hint to display, given what the space stores and what the model declares.
 *
 * The hard case is an **absent** stored hint, which storage cannot tell apart from a deliberate one:
 * `writeInterpretationHints` removes the link for an empty hint rather than storing a blank, so a
 * hint a community cleared on purpose and a hint nobody ever touched look identical by the time they
 * are read back.
 *
 * The customized marker is what separates them, and is exactly what it exists for:
 *
 * - **Not customized** — nothing here is the community's doing, so an absent hint means the space
 *   never had one and the declaration is what applies. Showing it is showing the truth.
 * - **Customized** — the space owns this entity's interpretation, so an absent hint is a hint
 *   somebody deleted. Falling back to the declaration would put their deleted words back in front of
 *   them, and re-saving would silently reinstate them.
 *
 * Getting this wrong in one direction was visible immediately: property hints read
 * `stored ? (propHints[predicate] ?? '') : declared`, which reached for the declaration only when
 * *nothing at all* was stored — so every saved model opened its editor with every property blank,
 * while the class hint (whose fallback was written the other way) showed correctly.
 */
export function hintToDisplay(args: {
  /** What the space stores for this hint, or undefined when it stores none. */
  stored: string | undefined;
  /** What the model declares — the reset baseline. */
  declared: string;
  /** Whether the space has taken ownership of this entity's hints. */
  customized: boolean;
}): string {
  const { stored, declared, customized } = args;
  if (customized) return stored ?? '';
  return stored ?? declared;
}

export interface HintEntityView {
  entity: string;
  /** 'core' = ships with WE (structure immutable, hints tunable); 'shape' = this space's own. */
  source: 'core' | 'shape';
}

export interface HintEditorRow {
  name: string;
  hint: string;
  /** What the declaration ships — the value reset returns to. */
  defaultHint: string;
}

export interface HintEditorState {
  entity: string;
  classHint: string;
  defaultClassHint: string;
  rows: HintEditorRow[];
  customized: boolean;
}

/** Core entities worth offering the hint editor: the ones whose declaration carries any hint. */
export const CORE_HINT_ENTITIES: readonly string[] = Object.entries(CORE_MANIFEST.entities)
  .filter(
    ([, entity]) => entity.interpretationHint || Object.values(entity.properties).some((p) => p.interpretationHint),
  )
  .map(([name]) => name);

/** The entities offering hint tuning: core interpretable vocabulary first, then the space's own models. */
export function hintEntitiesOf(shapes: readonly { name: string; manifest: EntityManifest | null }[]): HintEntityView[] {
  return [
    ...CORE_HINT_ENTITIES.map((entity) => ({ entity, source: 'core' as const })),
    ...shapes.filter((s) => s.manifest).map((s) => ({ entity: s.name, source: 'shape' as const })),
  ];
}

/** What an entity's declaration ships: its class hint and a hint per non-link property. */
export interface DeclaredHints {
  classHint: string;
  rows: { name: string; hint: string }[];
}

/**
 * The declared hints for an entity, from whichever manifest declares it: the space's own model of
 * that name when it has one that stands, core vocabulary otherwise.
 */
export function declaredHintsOf(
  entity: string,
  shapes: readonly { name: string; manifest: EntityManifest | null }[],
): DeclaredHints {
  const shape = shapes.find((s) => s.name === entity && s.manifest);
  const manifest = shape?.manifest ?? CORE_MANIFEST;
  const entry = manifestEntries(manifest, { parents: CORE_MANIFEST }).find((e) => e.name === entity);
  return {
    classHint: entry?.interpretationHint ?? '',
    rows: (entry?.properties ?? [])
      .filter((p) => p.type !== 'uri')
      .map((p) => ({ name: p.name, hint: p.interpretationHint ?? '' })),
  };
}

/**
 * The editor as it opens: each hint read against its declaration by one rule, class and properties
 * alike — they disagreed before, and the properties had it wrong. See {@link hintToDisplay}.
 */
export function hintEditorStateOf(
  entity: string,
  declared: DeclaredHints,
  stored: EntityHintState | null | undefined,
): HintEditorState {
  const customized = stored?.customized ?? false;
  return {
    entity,
    classHint: hintToDisplay({ stored: stored?.classHint, declared: declared.classHint, customized }),
    defaultClassHint: declared.classHint,
    rows: declared.rows.map((row) => ({
      name: row.name,
      hint: hintToDisplay({ stored: stored?.propHints[row.name], declared: row.hint, customized }),
      defaultHint: row.hint,
    })),
    customized,
  };
}
