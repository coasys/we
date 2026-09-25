/**
 * Where does this node sit — answered from a *list*, never from a `find`.
 *
 * A canvas reads placements and asks each node where it goes. The obvious spelling of that question
 * is `placements.find(p => p.node === id)`, and it is the spelling that has to be unpicked the first
 * time a node has more than one placement on the same canvas. That day is already visible: freeform
 * placement is not responsive, and the mature conventions for making it responsive either scale one
 * coordinate set or store *several* — one per breakpoint. Every other way of adapting a placed
 * layout is a render-time choice over the same stored numbers; per-breakpoint placement is the one
 * that changes what is stored.
 *
 * Nothing writes a `tier` today, and nothing here asks anybody to. What this module buys is that the
 * code asking the question is already shaped to answer it from a list, so adding the field later is
 * a field rather than a refactor of every canvas query. Ten lines now against a migration later.
 *
 * ## The resolution rule
 *
 * "The most specific placement at or below the current tier", degrading exactly the way an absent
 * `mode` does in `modes.ts`:
 *
 * - a placement with **no tier applies everywhere**, and is what every placement written before this
 *   existed is;
 * - a placement naming a tier applies from that width **up**, so `md` still applies at `lg` — the
 *   same min-width cascade `mdUpProps` has, because it is the same ladder;
 * - the most specific applicable one wins, and equally specific rows are last-write-wins by the
 *   rows' own `updatedAt` (then id), never by where a query happened to list them.
 *
 * A caller that does not know the width passes no tier and gets the tierless placement. That is the
 * honest answer rather than a guess: a seed runs in the data layer and cannot see the box its nodes
 * will be drawn in, so picking a tier-keyed row there would be picking one at random.
 */

/**
 * The breakpoint ladder, narrowest first.
 *
 * Spelled out rather than imported from `@we/tokens`: the graph engine has no dependency on the
 * design system and should not grow one to read four strings. It is the same ladder — if it ever
 * stops being, the mismatch is a placement resolving at the wrong width, so keep them in step.
 */
const TIER_ORDER = ['base', 'sm', 'md', 'lg'] as const;

/** What a row must carry to be resolvable. Deliberately loose — these are query rows, not models. */
export type PlacementRow = Record<string, unknown>;

/** `-1` for "applies everywhere", the tier's rung otherwise, and `undefined` for a name we don't know. */
function specificity(row: PlacementRow): number | undefined {
  const tier = row.tier;
  if (typeof tier !== 'string' || tier === '') return -1;
  const index = TIER_ORDER.indexOf(tier as (typeof TIER_ORDER)[number]);
  /*
    An unrecognised tier name is ignored rather than treated as absent. Treating it as "applies
    everywhere" would make a placement written for a breakpoint this build has never heard of apply
    at *every* width — the loudest possible reading of a value we cannot interpret.
  */
  return index === -1 ? undefined : index;
}

/**
 * Group placement rows by the node each one positions.
 *
 * Rows naming no node are dropped: a placement whose node link never wrote names a type and points
 * at nothing, and the record it meant is not knowable from here.
 */
export function placementsFor<T extends PlacementRow>(rows: readonly T[]): Map<string, T[]> {
  const byNode = new Map<string, T[]>();
  for (const row of rows) {
    const node = typeof row.node === 'string' ? row.node : '';
    if (!node) continue;
    const list = byNode.get(node);
    if (list) list.push(row);
    else byNode.set(node, [row]);
  }
  return byNode;
}

/** When a row was last written, as epoch milliseconds — `-Infinity` for a row that does not say. */
function writtenAt(row: PlacementRow): number {
  const value = row.updatedAt;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const parsed = Number.isNaN(Number(value)) ? Date.parse(value) : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return -Infinity;
}

/**
 * Whether `row` beats `best` between two equally specific placements.
 *
 * Decided by the rows rather than by the order a query returned them in. The order is not something
 * two readers share, and a writer choosing the first row while a reader drew the last one was how a
 * card with two placements stopped moving: every drag updated the row nobody drew. Latest write
 * first — `updatedAt` moves on every update, so whichever row was dragged most recently is the one
 * shown — and the id after that, so rows no backend timestamps still resolve the same everywhere.
 */
function supersedes(row: PlacementRow, best: PlacementRow): boolean {
  const a = writtenAt(row);
  const b = writtenAt(best);
  if (a !== b) return a > b;
  return String(row.id ?? '') > String(best.id ?? '');
}

/**
 * The placement that applies, out of everything stored for one node.
 *
 * `tier` is the width the surface is currently at. Omit it where that is not knowable — a seed
 * running in the data layer — and only tierless placements are considered.
 */
export function resolvePlacement<T extends PlacementRow>(rows: readonly T[], tier?: string): T | undefined {
  /*
    `-1` is "tierless placements only", and both an absent tier and a name this build does not know
    resolve to it. An unknown name is the caller's half of the same question `specificity` answers
    for a row: the safe reading is the one that shows what every placement was authored against,
    rather than admitting rows written for a width we cannot place on the ladder.
  */
  const limit = tier === undefined ? -1 : TIER_ORDER.indexOf(tier as (typeof TIER_ORDER)[number]);

  let best: T | undefined;
  let bestRung = -Infinity;
  for (const row of rows) {
    const rung = specificity(row);
    if (rung === undefined || rung > limit) continue;
    // Equally specific rows are last-write-wins — see `supersedes` for why not by list position.
    if (rung > bestRung || (rung === bestRung && best !== undefined && supersedes(row, best))) {
      best = row;
      bestRung = rung;
    }
  }
  return best;
}
