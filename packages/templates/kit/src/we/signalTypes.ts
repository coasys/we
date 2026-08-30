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
 * production against any record predating the field. The correct pushed-down spelling is
 * `{ OR: [{ retired: false }, { retired: { exists: false } }] }`, which is supported but costs the
 * query's sort pushdown. See the conformance tests in `@we/backend-inmemory`.
 *
 * The list is a handful of rows per space, so there is nothing to push down anyway.
 *
 * Reads `local.signalTypes`, so it is only valid inside a node that declares that subscription —
 * the same constraint `signalRow` documents.
 */
export const OFFERED_SIGNAL_TYPES = 'filter(local.signalTypes, { retired: { not: true } })';

/** The same list, as a `$if` condition: is there anything left to react *with*? */
export const HAS_OFFERED_SIGNAL_TYPES = `count(${OFFERED_SIGNAL_TYPES})`;
