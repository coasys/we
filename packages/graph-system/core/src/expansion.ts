/**
 * Expansion state — which nodes are open, and what has to happen when one closes.
 *
 * This is where "resolution" becomes real, and where the two mistakes that make an explorer feel
 * broken live.
 *
 * **Collapse must be reference-counted, not tree-pruned.** The moment a node is reachable from two
 * open parents — guaranteed in any real knowledge graph — pruning the subtree under one of them
 * deletes nodes that are still legitimately on screen. So every node records *who introduced it*, and
 * closing a parent removes only what nothing else is holding open. Seeded nodes carry a permanent
 * opener and therefore survive every collapse.
 *
 * **Collapse must bundle, not hide.** If closing a collection silently drops the edges its children
 * had to the rest of the graph, the collapsed view is a lie: it shows an isolated node where there
 * were twelve relationships. Edges that crossed the boundary are re-attached to the collapsed node as
 * a single weighted edge, which is also — pleasingly — the entire mechanism a cluster map needs, since
 * a cluster is just a collapsed synthetic node.
 */
import type { GraphEdge } from '@we/graph-protocol';

import { GraphStore } from './store';

/** Opener recorded for anything that came from a seed rather than from expanding a node. */
export const SEED_OPENER = '$seed';

export interface CollapseResult {
  removedNodes: string[];
  /** Aggregate edges minted to stand in for the removed ones. */
  bundles: GraphEdge[];
}

export class ExpansionState {
  /** Nodes the user has opened. */
  private readonly expanded = new Set<string>();
  /** node → the openers holding it on screen. */
  private readonly openers = new Map<string, Set<string>>();
  /** edge → the openers holding it. */
  private readonly edgeOpeners = new Map<string, Set<string>>();
  /** collapsed node → the bundle edges its collapse produced, so re-expanding can retract them. */
  private readonly bundles = new Map<string, string[]>();
  /** Nodes known to have more neighbours than are loaded, with the cursor to fetch them. */
  private readonly cursors = new Map<string, { cursor?: string; total?: number; loaded: number }>();

  isExpanded(id: string): boolean {
    return this.expanded.has(id);
  }

  expandedIds(): string[] {
    return [...this.expanded];
  }

  /** Paging state for a node, if it has been expanded and had more to give. */
  pageState(id: string): { cursor?: string; total?: number; loaded: number } | undefined {
    return this.cursors.get(id);
  }

  hasMore(id: string): boolean {
    return this.cursors.get(id)?.cursor !== undefined;
  }

  /**
   * Record that `opener` introduced these nodes and edges.
   *
   * Called after the store has merged a fragment, with the ids the store reports as *new* plus the
   * ids it already held — both matter, because a second opener for an existing node is exactly what
   * stops a later collapse from removing it.
   */
  attribute(opener: string, nodeIds: Iterable<string>, edgeIds: Iterable<string>): void {
    for (const id of nodeIds) addOpener(this.openers, id, opener);
    for (const id of edgeIds) addOpener(this.edgeOpeners, id, opener);
  }

  /** Mark a node open, and record where its next page starts. */
  markExpanded(id: string, page: { cursor?: string; total?: number; added: number }): void {
    this.expanded.add(id);
    const previous = this.cursors.get(id);
    this.cursors.set(id, {
      cursor: page.cursor,
      total: page.total ?? previous?.total,
      loaded: (previous?.loaded ?? 0) + page.added,
    });
  }

  /**
   * Close a node: drop what only it was holding, and bundle the edges that crossed the boundary.
   *
   * Cascades — closing a node closes anything that only it kept open, including nodes that were
   * themselves expanded, so a deep drill-down folds back up in one action rather than leaving orphan
   * subtrees floating.
   */
  collapse(id: string, store: GraphStore): CollapseResult {
    if (!this.expanded.has(id)) return { removedNodes: [], bundles: [] };

    const removed = new Set<string>();
    const worklist = [id];

    while (worklist.length) {
      const opener = worklist.pop()!;
      this.expanded.delete(opener);
      this.cursors.delete(opener);

      for (const [nodeId, holders] of this.openers) {
        if (!holders.has(opener)) continue;
        holders.delete(opener);
        if (holders.size > 0 || removed.has(nodeId)) continue;
        // Nothing is holding this node open any more. It goes, and anything it opened is
        // reconsidered in turn.
        removed.add(nodeId);
        worklist.push(nodeId);
      }
    }

    // A node cannot remove itself: collapsing a node closes what it opened, it does not delete the
    // thing that was clicked.
    removed.delete(id);

    const bundles = this.buildBundles(id, removed, store);

    for (const nodeId of removed) {
      this.openers.delete(nodeId);
      this.bundles.delete(nodeId);
    }
    for (const edgeId of store.edgeIds(id)) this.edgeOpeners.delete(edgeId);

    return { removedNodes: [...removed], bundles };
  }

  /**
   * Drop one opener's claim on everything except what it still holds, and report what nothing is
   * holding any more.
   *
   * This is what makes a *refresh* different from a restart. Re-running the seeds hands back the
   * rows that exist now; anything the seeds used to introduce and no longer do has to go, while
   * everything reached by expanding a node has to stay exactly where it is. Recomputing that by
   * clearing and reloading would be correct and would also throw away every position, every pin and
   * every open node on screen — which is the whole reason a live graph could not be built on
   * {@link reset}.
   *
   * Cascades for the same reason {@link collapse} does: a released node may itself have been open,
   * and what it was the only holder of goes with it. Deliberately shares that logic's shape rather
   * than its code — collapse keeps the node it was called on, and this one is releasing a *pseudo*
   * opener that is not a node at all.
   */
  releaseFrom(
    opener: string,
    keepNodes: ReadonlySet<string>,
    keepEdges: ReadonlySet<string>,
  ): { nodes: string[]; edges: string[] } {
    const removed = new Set<string>();
    const releasedEdges: string[] = [];
    const worklist = [opener];

    while (worklist.length) {
      const holder = worklist.pop()!;
      // The opener itself is not a node and was never "expanded"; anything cascaded from it is.
      if (holder !== opener) {
        this.expanded.delete(holder);
        this.cursors.delete(holder);
      }
      // `keep` applies only to the opener's own direct claims. A node that survives in the new seed
      // set is kept whatever else happens; one that is merely *reachable* from a released node is not.
      const honourKeep = holder === opener;

      for (const [nodeId, holders] of this.openers) {
        if (honourKeep && keepNodes.has(nodeId)) continue;
        if (!holders.has(holder)) continue;
        holders.delete(holder);
        if (holders.size > 0 || removed.has(nodeId)) continue;
        removed.add(nodeId);
        worklist.push(nodeId);
      }

      for (const [edgeId, holders] of this.edgeOpeners) {
        if (honourKeep && keepEdges.has(edgeId)) continue;
        if (!holders.has(holder)) continue;
        holders.delete(holder);
        if (holders.size > 0) continue;
        this.edgeOpeners.delete(edgeId);
        releasedEdges.push(edgeId);
      }
    }

    for (const nodeId of removed) {
      this.openers.delete(nodeId);
      this.bundles.delete(nodeId);
    }

    return { nodes: [...removed], edges: releasedEdges };
  }

  /** Bundle edges owed to a node, so re-expanding it can retract them. */
  bundlesFor(id: string): string[] {
    return this.bundles.get(id) ?? [];
  }

  clearBundles(id: string): void {
    this.bundles.delete(id);
  }

  reset(): void {
    this.expanded.clear();
    this.openers.clear();
    this.edgeOpeners.clear();
    this.bundles.clear();
    this.cursors.clear();
  }

  /**
   * One aggregate edge per surviving neighbour of the removed set.
   *
   * Weight is the number of original edges it stands for, so a renderer can thicken the line and
   * label the count — the difference between a collapsed view that reads as "twelve things in here
   * relate to that" and one that reads as "nothing here relates to anything".
   */
  private buildBundles(collapsed: string, removed: Set<string>, store: GraphStore): GraphEdge[] {
    if (!removed.size) return [];
    const counts = new Map<string, { weight: number; outward: boolean }>();

    for (const nodeId of removed) {
      for (const edgeId of store.edgeIds(nodeId)) {
        const edge = store.edge(edgeId);
        if (!edge) continue;
        const other = edge.source === nodeId ? edge.target : edge.source;
        // Edges wholly inside the collapsed region vanish with it — they have no surviving endpoint
        // to attach to and are not information the collapsed view can carry.
        if (removed.has(other) || other === collapsed) continue;
        const outward = edge.source === nodeId;
        const existing = counts.get(other);
        if (existing) existing.weight += 1;
        else counts.set(other, { weight: 1, outward });
      }
    }

    const edges: GraphEdge[] = [];
    for (const [other, { weight, outward }] of counts) {
      const id = `bundle|${collapsed}|${other}`;
      edges.push({
        id,
        source: outward ? collapsed : other,
        target: outward ? other : collapsed,
        type: 'bundle',
        weight,
        label: String(weight),
      });
    }
    this.bundles.set(
      collapsed,
      edges.map((e) => e.id),
    );
    return edges;
  }
}

function addOpener(map: Map<string, Set<string>>, key: string, opener: string): void {
  const existing = map.get(key);
  if (existing) existing.add(opener);
  else map.set(key, new Set([opener]));
}
