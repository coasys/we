/**
 * WE's own structural classes: the space itself, its containers, its settings and vocabularies, how
 * a board is drawn, who holds which role, what a model run did. None of them is something said in a
 * call, so none is offered for extraction — even where a space carries one under a target class WE
 * does not recognise (an older WE wrote it, or another WE-shaped app did), which is how one of these
 * names reaches `foreignExtractionCandidates` at all.
 *
 * One explicit list, taken from the core manifest rather than worked out by a heuristic: everything
 * in it is a core entity that is not `extractable` (a test holds both). WE's content classes — the
 * blocks, `Topic`, a task — are deliberately absent, so a foreign class named like one of those is
 * reported as `shadowed` rather than dropped without a word.
 */
export const WE_PLUMBING_CLASSES: readonly string[] = [
  // The space and what holds things in it
  'Space',
  'CollectionBlock',
  'SpaceLandmark',
  'Shape',
  // Per-agent and per-space settings
  'AgentSettings',
  'SpacePreference',
  'SpaceTemplatePreference',
  'Template',
  'Theme',
  'ReadMarker',
  'MutedAgent',
  // Who may do what
  'Policy',
  'Role',
  'RoleGrant',
  // A community's vocabularies — the kinds, not the things
  'SignalType',
  'TaskState',
  'RelationshipType',
  'InvolvementType',
  // Reactions and parts people have in a record
  'Signal',
  'Involvement',
  // How a board or canvas draws its records
  'Placement',
  'TypeStyle',
  'EdgeRoute',
  // What a model did
  'ModelRun',
  'Amendment',
];

/**
 * Classes a space already has — registered by another app, or by hand — that a call may extract into.
 *
 * WE offers its own extractable vocabulary and the shapes a community adopted in WE. A space can also
 * hold SHACL classes WE did not write (`foreignSchemas`), and the executor extracts into those just
 * as well: it resolves a class by name from the space's SHACL, with no WE model involved, and reads
 * an interpretation hint where the class has one and goes without where it does not. So every such
 * class is offered — a space's DNA is the community's to point a call at, not WE's to filter. A class
 * that carries a class-level hint sorts first: it says how it should be read, so it is the likelier
 * thing to want. WE's own plumbing (`WE_PLUMBING_CLASSES`) is never offered.
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
  const skipped = new Set([...adopted, ...WE_PLUMBING_CLASSES]);
  const hinted = new Set<string>();
  const unhinted = new Set<string>();
  const shadowed = new Set<string>();
  for (const { name, interpretationHint } of foreign) {
    if (skipped.has(name)) continue;
    if (takenNames.has(name)) shadowed.add(name);
    else (interpretationHint?.trim() ? hinted : unhinted).add(name);
  }
  for (const name of hinted) unhinted.delete(name);
  return { offered: [...[...hinted].sort(), ...[...unhinted].sort()], shadowed: [...shadowed].sort() };
}
