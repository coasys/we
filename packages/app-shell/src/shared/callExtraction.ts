/**
 * Which models an extraction pass writes, and whether it runs at all — resolved across the levels
 * that get a say.
 *
 * ## Why this is its own module
 *
 * These four functions were inline closures in `SpaceStore`, inside a 2,952-line provider, and so
 * had no test of their own. What they encode is the one thing about extraction settings that is
 * easy to lose and impossible to see the loss of: **a call's participants overrule the space.**
 *
 * That layer is unusual here. Every other capability setting resolves along one axis — who is
 * asking (deployment → agent everywhere → community here → agent here), which is what
 * `moduleSettings.ts` implements. These resolve along a second: *which call*. A per-call decision
 * belongs to that call's participants rather than to whoever administers the space, because
 * stopping a standing pass mid-meeting is about the conversation in the room.
 *
 * The practical hazard is that the generic settings resolver looks like the obvious home for
 * `autoInterpret` and `extractionTargets`, and moving them there would compile, pass, and silently
 * drop this axis. See the `moduleSettings` docblock on `Space` in `@we/entities`. These tests are
 * what would fail if somebody tried.
 *
 * ## Absent is not off
 *
 * Three states, not two, at both levels. A space or a call that has never been asked has **no
 * opinion** and defers; only a value somebody wrote counts as an answer. `auto` is stored as
 * `'on'` / `'off'` / `''` rather than a boolean for exactly this reason — and because a
 * `CallExtraction` record is created the moment somebody narrows the *targets*, an untouched `auto`
 * on that record must not read as a refusal of the space's default.
 */

/**
 * What a space extracts before anybody decides — the two classes that were hardcoded until the
 * setting existed.
 *
 * A migration floor, not a default anybody chose. `Space.extractionTargets` follows the
 * `enabledModules` rule that empty means "not decided", and reading it as "none" would make every
 * space that predates the field silently stop extracting with nothing on screen to say why. The
 * first toggle writes the resolved list and the community owns it from then on.
 */
export const LEGACY_EXTRACTION_TARGETS = ['TaskBlock', 'EventBlock'];

/**
 * A JSON array of entity names as stored on `Space.extractionTargets` / `CallExtraction.entities`.
 *
 * `null` means "nothing was written" and is the caller's cue to defer to the level above. It is
 * distinct from `[]`, which is a group that turned everything off — the distinction the record
 * exists to make, and why this cannot be a set of links.
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
 * The models this space extracts: its own list where it has one, else the migration floor —
 * narrowed to what is actually extractable here.
 *
 * Narrowing matters beyond tidiness: a pass whose perspective has no shape for a listed model fails
 * `assertShapesInstalled` and takes the whole pass down, so a list naming a model since deleted, or
 * one whose `extractable` was withdrawn in a release, has to narrow quietly rather than break
 * extraction for the space. Order follows `candidates` so a settings list reads the same way every
 * time rather than in whatever order somebody happened to tick things.
 */
export function resolveSpaceExtractionTargets(candidates: readonly string[], spaceRaw: string | undefined): string[] {
  const chosen = parseEntityList(spaceRaw) ?? LEGACY_EXTRACTION_TARGETS;
  return candidates.filter((entity) => chosen.includes(entity));
}

/**
 * The models one call extracts: its participants' list where they gave one, else the space's.
 *
 * A record with `entities: '[]'` is a group that turned everything off and answers `[]` — not the
 * space's list. That is the whole point of the level.
 */
export function resolveCallExtractionTargets(
  candidates: readonly string[],
  spaceRaw: string | undefined,
  callRaw: string | undefined,
): string[] {
  const own = parseEntityList(callRaw);
  if (!own) return resolveSpaceExtractionTargets(candidates, spaceRaw);
  return candidates.filter((entity) => own.includes(entity));
}

/**
 * Whether one call is extracted as it happens: its participants' answer where they gave one, else
 * the space's.
 *
 * Anything that is not exactly `'on'` or `'off'` is silence, including the empty string a record
 * carries when it was created to narrow targets rather than to answer this.
 */
export function resolveCallAutoInterpret(spaceAuto: boolean, callAuto: string | undefined): boolean {
  if (callAuto === 'on') return true;
  if (callAuto === 'off') return false;
  return spaceAuto;
}
