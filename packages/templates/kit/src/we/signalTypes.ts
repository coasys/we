/**
 * Which signal types a reaction can currently be *given* with.
 *
 * ## Why a shared constant and not a `where`
 *
 * The obvious spelling is `{ entity: 'SignalType', where: { retired: { not: true } } }`, and it is
 * wrong in a way that only shows up against real data. A `where` on `retired` pushes down to a
 * SPARQL filter over a property that every `SignalType` created before the field existed simply
 * does not have — an unbound variable excludes the row — so every reaction a community defined
 * before this shipped would silently disappear from every space. Filtered client-side, an absent
 * value reads as "not retired", which is the right answer for those records and stays right after
 * `default: false` starts materialising the property on new ones.
 *
 * ## Why the subscription itself stays unfiltered
 *
 * Offered and countable are different questions. A template resolves a type by slug to count what
 * people gave — `find(local.signalTypes, { slug: 'like' }).id` — and that has to keep resolving a
 * retired type, or every like anybody ever gave would read as zero the moment the word was
 * withdrawn. Retiring stops the type being *offered*; it does not erase its history. So the query
 * fetches everything and only the places that put a control on screen filter.
 *
 * Reads `local.signalTypes`, so it is only valid inside a node that declares that subscription —
 * the same constraint `signalRow` documents.
 */
export const OFFERED_SIGNAL_TYPES = 'filter(local.signalTypes, { retired: { not: true } })';

/** The same list, as a `$if` condition: is there anything left to react *with*? */
export const HAS_OFFERED_SIGNAL_TYPES = `count(${OFFERED_SIGNAL_TYPES})`;
