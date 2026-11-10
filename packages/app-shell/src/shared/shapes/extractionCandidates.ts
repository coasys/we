/**
 * Classes a space already has — registered by another app, or by hand — that a call may extract into.
 *
 * WE offers its own extractable vocabulary and the shapes a community adopted in WE. A space can also
 * hold SHACL classes WE did not write (`foreignSchemas`), and the executor extracts into those just
 * as well: it resolves a class by name from the space's SHACL, with no WE model involved. What it
 * cannot know is whether a class was *meant* for extraction, so the class says so itself: one that
 * carries a class-level interpretation hint is offered, one without is not. A class registered for
 * some app's own bookkeeping stays out of the call panel.
 *
 * A foreign class named like a class WE already offers or defines is **not** offered. The executor
 * and `getEntityForDataset` both resolve a name to one class, and for a shared name that is WE's —
 * so a chip with that name would extract into WE's class, not the one the space registered. Reported
 * as `shadowed` so the caller can say so, rather than merged in silence.
 *
 * `adopted` are the shapes this community defined in WE. Their SHACL reads as foreign too (no WE
 * model is registered globally for them), but they are offered — or not — by their own manifest's
 * `extractable`, so they are skipped here without a word.
 */
export function foreignExtractionCandidates(
  foreign: readonly { name: string; interpretationHint?: string }[],
  { taken, adopted }: { taken: Iterable<string>; adopted: Iterable<string> },
): { offered: string[]; shadowed: string[] } {
  const takenNames = new Set(taken);
  const adoptedNames = new Set(adopted);
  const hinted = foreign.filter((entry) => entry.interpretationHint?.trim() && !adoptedNames.has(entry.name));
  const offered = new Set<string>();
  const shadowed = new Set<string>();
  for (const { name } of hinted) (takenNames.has(name) ? shadowed : offered).add(name);
  return { offered: [...offered].sort(), shadowed: [...shadowed].sort() };
}
