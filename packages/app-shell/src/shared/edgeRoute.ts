/**
 * What pinning or clearing one end of a connection does to the record holding its route.
 *
 * A pure function, extracted for the reason `connect.ts` and `dockGeometry.ts` are: the call site is
 * three awaits against a peer-to-peer data layer and cannot be tested without one, while the *rule*
 * is a handful of branches and is where the behaviour actually lives.
 *
 * One `EdgeRoute` holds two different things — the sides a connection is pinned to, and the points
 * it is bent through — and the awkwardness this rule exists to contain is that a cleared anchor
 * cannot be an update. `Ad4mModel`'s update skips `''` exactly as it skips `undefined`, so writing an
 * empty side leaves the old one stored and the line does not move; the record has to be replaced.
 * Replacing it is where the bends went missing, because anything the new record does not restate is
 * gone — which is how dropping an end on another card silently discarded every point somebody had
 * drawn.
 */

/** The stored route, as much of it as the decision needs. */
export interface StoredRoute {
  sourceAnchor?: string;
  targetAnchor?: string;
  /** The bends, as stored — a JSON array, or absent. */
  points?: string;
}

/**
 * What to do with the record.
 *
 * `create` and `replace` differ only in whether there is an existing record to remove first, and are
 * kept apart because the caller must not delete something that was never there.
 */
export type RouteWrite =
  | { action: 'none' }
  | { action: 'create'; fields: Record<string, string> }
  | { action: 'replace'; fields: Record<string, string> }
  | { action: 'update'; fields: Record<string, string> }
  | { action: 'delete' };

/** Whether a stored `points` value actually holds a bend, as opposed to being absent or empty. */
function bent(points: string | undefined): points is string {
  return typeof points === 'string' && points !== '' && points !== '[]';
}

/**
 * Decide the write for pinning `end` of a connection to `side` on one board.
 *
 * An empty `side` clears that end. The bends survive every path here: letting go of a side says
 * nothing about the shape somebody drew, and a waypoint is stored in the connection's own frame
 * precisely so it keeps its proportions when an end moves.
 */
export function routeWrite(existing: StoredRoute | undefined, end: 'source' | 'target', side: string): RouteWrite {
  const field = end === 'source' ? 'sourceAnchor' : 'targetAnchor';
  const otherField = end === 'source' ? 'targetAnchor' : 'sourceAnchor';

  if (!existing) {
    // Nothing to clear, and nothing worth storing: a route recording "no anchors" is a record that
    // changes nothing and would have to be swept up later.
    return side ? { action: 'create', fields: { [field]: side } } : { action: 'none' };
  }

  const other = existing[otherField];
  const points = existing.points;

  if (side) return { action: 'update', fields: { [field]: side } };
  // Nothing pinned and nothing drawn — the way back out leaves nothing behind, or a board
  // accumulates a route per connection anybody ever touched.
  if (!other && !bent(points)) return { action: 'delete' };
  return {
    action: 'replace',
    fields: { ...(other ? { [otherField]: other } : {}), ...(bent(points) ? { points } : {}) },
  };
}
