/**
 * Which models an extraction pass writes, and whether it runs by itself — for one collection.
 *
 * ## Two levels, and only one of them is live
 *
 * A space holds **defaults** (`Space.autoInterpret`, `Space.extractionTargets`); every collection
 * that can be extracted — a call, a channel, the space's own collection of messages typed outside
 * any call — holds **its own answer** (`CollectionBlock.autoExtract`, `.extractionTargets`), copied
 * from the defaults when it is made. From then on the collection's answer is the answer, and the
 * only way it changes is somebody changing it on that collection.
 *
 * A copy rather than a live fallback is the decision worth guarding. With live inheritance a
 * community changing its default would quietly change every conversation that never chose — right
 * by the rule, and exactly what a participant cannot see coming. The fallback below exists only for
 * a collection made without a copy, by something that never heard of extraction.
 *
 * ## Why not the generic settings resolver
 *
 * `moduleSettings.ts` resolves along one axis, who is asking. These resolve by *which collection*,
 * and a collection's answer belongs to whoever is in that conversation rather than to whoever
 * administers the space. Moving them into the generic resolver would compile, pass, and silently
 * turn a starting point into a setting that overrules every conversation. The tests beside this
 * are what fails instead.
 *
 * ## Absent is not off
 *
 * Unset (`undefined`, or `''` for the list) is a collection made without a copy, and defers to the
 * space. `'[]'` is a conversation whose participants turned everything off, and answers `[]`.
 */

/**
 * What a space extracts before anybody decides — the two classes that were hardcoded until the
 * setting existed.
 *
 * A floor, not a default anybody chose. `Space.extractionTargets` follows the `enabledModules` rule
 * that empty means "not decided", and reading it as "none" would make a space that never touched
 * the setting extract nothing with nothing on screen to say why.
 */
export const LEGACY_EXTRACTION_TARGETS = ['TaskBlock', 'EventBlock'];

/**
 * A JSON array of entity names as stored on `Space.extractionTargets` and
 * `CollectionBlock.extractionTargets`.
 *
 * `null` means "nothing was written" and is the caller's cue to defer to the level above. It is
 * distinct from `[]`, which is a decision to extract nothing — the reason this is a string rather
 * than a set of links.
 */
export function parseEntityList(raw: string | undefined | null): string[] | null {
  if (raw === undefined || raw === null || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * The models this space's new collections start with: its own list where it has one, else the
 * floor — narrowed to what is actually extractable here.
 *
 * Narrowing matters beyond tidiness: a pass whose perspective has no shape for a listed model fails
 * `assertShapesInstalled` and takes the whole pass down, so a list naming a model since deleted, or
 * one whose `extractable` was withdrawn in a release, has to narrow quietly rather than break
 * extraction. Order follows `candidates` so a list reads the same way every time rather than in
 * whatever order somebody happened to tick things.
 */
export function resolveSpaceExtractionTargets(candidates: readonly string[], spaceRaw: string | undefined): string[] {
  const chosen = parseEntityList(spaceRaw) ?? LEGACY_EXTRACTION_TARGETS;
  return candidates.filter((entity) => chosen.includes(entity));
}

/**
 * The models one collection extracts: its own list, else — for a collection made without a copy —
 * the space's. Narrowed to the candidates either way.
 */
export function resolveCollectionExtractionTargets(
  candidates: readonly string[],
  spaceRaw: string | undefined,
  ownRaw: string | undefined,
): string[] {
  const own = parseEntityList(ownRaw);
  if (!own) return resolveSpaceExtractionTargets(candidates, spaceRaw);
  return candidates.filter((entity) => own.includes(entity));
}

/** Whether one collection is extracted as it grows: its own answer, else the space's default. */
export function resolveCollectionAutoExtract(spaceAuto: boolean, own: boolean | undefined | null): boolean {
  return typeof own === 'boolean' ? own : spaceAuto;
}

/**
 * The copy a new collection is made with — the space's defaults as they stand right now.
 *
 * The list is copied as the space states it (or the floor), not narrowed: narrowing happens on
 * every read, so a model that becomes extractable later is picked up by a collection that already
 * named it, and nothing here needs to know the candidates.
 *
 * `undefined` for a dataset with no space, which leaves the collection unset — and an unset
 * collection reads as off wherever there is no space to defer to.
 */
export function collectionExtractionDefaults(
  space: { autoInterpret?: boolean; extractionTargets?: string } | null | undefined,
): { autoExtract: boolean; extractionTargets: string } | undefined {
  if (!space) return undefined;
  return {
    autoExtract: space.autoInterpret === true,
    extractionTargets: JSON.stringify(parseEntityList(space.extractionTargets) ?? LEGACY_EXTRACTION_TARGETS),
  };
}
