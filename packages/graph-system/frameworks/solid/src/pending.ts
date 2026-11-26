import type { GraphNode, GraphValue } from '@we/graph-protocol';

/**
 * Apply a patch to a node — the engine's data overlay (`GraphEngine.setDataOverlay`) — or hand back
 * the node when there is nothing to apply.
 *
 * Returns the *same object* when the patch is empty or absent, which is what keeps this free on the
 * ordinary frame: the nodes memo runs on every graph change, and a fresh object per node would
 * defeat every identity check downstream.
 */
export function patched(node: GraphNode, patch: Record<string, GraphValue> | undefined): GraphNode {
  if (!patch || !Object.keys(patch).length) return node;
  return { ...node, data: { ...node.data, ...patch } };
}
