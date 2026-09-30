import type { GraphNode, GraphValue } from '@we/graph-protocol';

/**
 * Optimistic fields, and the moment they stop being needed.
 *
 * A host draws an edit before the write comes back (see `GraphHostBindings.pendingData`). The only
 * hard part is letting go: too early and the card flicks back to the old value until the data
 * arrives, too late and it keeps showing something that was never stored.
 *
 * "Too early" is not hypothetical. Confirming at the point the *data* was read looks right and is
 * half a second wrong — the seed reads its rows, then queries more, then lays out, and only then do
 * the nodes carry the new value. Clearing on the read put the old value back for the whole of that
 * window: the card flashed to the new size, snapped back, and arrived again a moment later.
 *
 * So the question is asked of the drawn node instead. When the node's own data already says what the
 * patch says, the patch is redundant *at the moment it is removed*, and nothing on screen moves.
 */

/** Whether a node's own data already carries everything a patch was standing in for. */
export function isSettled(node: GraphNode, patch: Record<string, GraphValue>): boolean {
  // Every field, not any: a node that has caught up on a card's colour but not its size is still a
  // node the optimistic size is needed for.
  return Object.entries(patch).every(([field, value]) => node.data?.[field] === value);
}

/**
 * Apply a patch to a node, or hand back the node when there is nothing to apply.
 *
 * Returns the *same object* when the patch is empty or absent, which is what keeps this free on the
 * ordinary frame: the nodes memo runs on every graph change, and a fresh object per node would
 * defeat every identity check downstream.
 */
export function patched(node: GraphNode, patch: Record<string, GraphValue> | undefined): GraphNode {
  if (!patch || !Object.keys(patch).length) return node;
  return { ...node, data: { ...node.data, ...patch } };
}
