/**
 * Which signal types a reaction can currently be *given* with.
 *
 * ## Why the filter lives here and not in the query
 *
 * The first reason is the one that decides it: **one subscription answers two different questions.**
 * A view hoists `signalTypes` once and uses it both to render the controls — which must exclude a
 * retired type — and to resolve a slug for a count projection,
 * `find(local.signalTypes, { slug: 'like' }).id`, which must still *find* a retired type or every
 * like anybody ever gave reads as zero the moment the word is withdrawn. A `where` on the shared
 * query can only serve one of those. `PostsList`, `EdgeDetail` and the showcase's `signalRow` all
 * ask both, so the filter has to be at the point of use, and using the same spelling in the two
 * globe modals (which happen to ask only one) keeps it one rule rather than two.
 *
 * The second is that the obvious `where` is subtly wrong. `{ retired: { not: true } }` matches an
 * absent property client-side (`undefined !== true`) and does *not* match one on AD4M, where `!=`
 * over an unbound variable excludes the row — so it would pass every test and come back empty in
 * production against any record predating the field.
 *
 * This used to name `{ OR: [{ retired: false }, { retired: { exists: false } }] }` as the correct
 * pushed-down spelling. It is not: the executor has no `exists` operator, and a `$query` written
 * that way answered nothing at all rather than answering wrongly. A `$query` using it is now refused
 * outright, which is the point at which the absence became visible. Nothing here changes, because
 * this filters client-side, where `exists` does work — but do not lift the spelling into a `$query`.
 *
 * The list is a handful of rows per space, so there is nothing to push down anyway.
 *
 * Reads `local.signalTypes`, so it is only valid inside a node that declares that subscription —
 * the same constraint `signalRow` documents.
 */
export const OFFERED_SIGNAL_TYPES = 'filter(local.signalTypes, { retired: { not: true } })';

/** The same list, as a `$if` condition: is there anything left to react *with*? */
export const HAS_OFFERED_SIGNAL_TYPES = `count(${OFFERED_SIGNAL_TYPES})`;

/**
 * The one reaction a space is created with.
 *
 * A community names its own vocabulary and nothing chooses it for them — but arriving with NONE is
 * not neutrality, it is a blank: every reaction surface draws nothing, and the only way to learn
 * that a space names its own is to find Settings → Vocabulary unprompted. A like is the starting
 * point nobody has to be taught, and it is adapted or retired in two presses.
 *
 * Here rather than inline at the place it is written, because the SLUG is a shared fact: the cards
 * feed resolves `like` by slug for its like count and for sorting by it, and until a space had one
 * that quietly counted nothing. Two files naming the same string is how the two come apart — see
 * `LIKE_COUNT_TYPE`, which is built from this.
 *
 * `semantic` is the closed fact under the community's own word, so "is this approval?" survives a
 * rename to "Appreciate".
 */
export const DEFAULT_SIGNAL_TYPE = {
  name: 'Like',
  slug: 'like',
  description: 'The ordinary yes — you read it and you are glad it is here.',
  icon: 'heart',
  mode: 'toggle',
  aggregate: 'count',
  semantic: 'approval',
  rangeMin: 0,
  rangeMax: 1,
} as const;

/**
 * The default type, found by slug, for a count projection or a sort.
 *
 * Deliberately NOT filtered by `OFFERED_SIGNAL_TYPES`: a retired type must still be found here, or
 * every like anybody ever gave reads as zero the moment the word is withdrawn. See the note at the
 * top of this file, which is the same rule stated from the other side.
 */
export const LIKE_COUNT_TYPE = `find(local.signalTypes, { slug: '${DEFAULT_SIGNAL_TYPE.slug}' })`;
