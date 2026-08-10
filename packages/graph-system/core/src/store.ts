/**
 * The graph store — nodes, edges, and the adjacency the rest of the engine reads.
 *
 * Deliberately our own structure rather than a general-purpose graph library. Not because adjacency
 * is hard — it is two `Map`s — but because the fields that make this engine work (structural kind,
 * unresolved placeholders, which expander produced a node, the provenance that collapse refcounts
 * against) are not a general graph library's model, and holding them in a foreign attribute bag would
 * make this file a translation layer instead of a store.
 *
 * Graph *algorithms* are the opposite case and are handled the opposite way: community detection and
 * centrality are hard, easy to get subtly wrong, and stateless. Those project the visible graph out
 * to a library on demand rather than living here — see `@we/graph-algorithms`.
 *
 * ## Reverse adjacency is not optional
 *
 * WE's relations are one-directional by construction: the neutral manifest does not emit `reverseOf`,
 * and the query IR only walks forward. So "what points at this node" cannot be answered by the data
 * layer alone for anything already loaded, and a map that can only be walked in one direction is a
 * tree with extra steps. The store keeps both directions; the cost is one extra `Set` per node.
 */
import type { GraphEdge, GraphFragment, GraphNode } from '@we/graph-protocol';

export interface StoreChange {
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
}

const NO_CHANGE: StoreChange = { addedNodes: [], removedNodes: [], addedEdges: [], removedEdges: [] };

export class GraphStore {
  private readonly nodesById = new Map<string, GraphNode>();
  private readonly edgesById = new Map<string, GraphEdge>();
  /** node → edge ids where it is the source. */
  private readonly outgoing = new Map<string, Set<string>>();
  /** node → edge ids where it is the target. */
  private readonly incoming = new Map<string, Set<string>>();

  get nodeCount(): number {
    return this.nodesById.size;
  }

  get edgeCount(): number {
    return this.edgesById.size;
  }

  nodes(): IterableIterator<GraphNode> {
    return this.nodesById.values();
  }

  edges(): IterableIterator<GraphEdge> {
    return this.edgesById.values();
  }

  node(id: string): GraphNode | undefined {
    return this.nodesById.get(id);
  }

  edge(id: string): GraphEdge | undefined {
    return this.edgesById.get(id);
  }

  hasNode(id: string): boolean {
    return this.nodesById.has(id);
  }

  /**
   * Merge a fragment in.
   *
   * Merge, not replace: the same node legitimately arrives from several expanders — a Belief reached
   * from its author and from its topic is one node — and the later arrival usually knows *less*
   * (a relation target comes back as a bare id). So a node that is already resolved is never
   * downgraded to a placeholder, and known fields survive an emptier repeat.
   */
  merge(fragment: GraphFragment): StoreChange {
    const addedNodes: string[] = [];
    const addedEdges: string[] = [];

    for (const node of fragment.nodes) {
      const existing = this.nodesById.get(node.id);
      if (!existing) {
        this.nodesById.set(node.id, { ...node });
        addedNodes.push(node.id);
        continue;
      }
      this.nodesById.set(node.id, mergeNode(existing, node));
    }

    for (const edge of fragment.edges) {
      // An edge whose endpoints are not both present would be an invisible dangling reference, and
      // every consumer would have to defend against it. Expanders are expected to include the
      // endpoint — as a placeholder if that is all they have.
      if (!this.nodesById.has(edge.source) || !this.nodesById.has(edge.target)) continue;
      if (this.edgesById.has(edge.id)) {
        this.edgesById.set(edge.id, { ...this.edgesById.get(edge.id)!, ...edge });
        continue;
      }
      this.edgesById.set(edge.id, { ...edge });
      addSetEntry(this.outgoing, edge.source, edge.id);
      addSetEntry(this.incoming, edge.target, edge.id);
      addedEdges.push(edge.id);
    }

    if (!addedNodes.length && !addedEdges.length) return NO_CHANGE;
    return { addedNodes, removedNodes: [], addedEdges, removedEdges: [] };
  }

  /** Remove nodes and every edge touching them. */
  removeNodes(ids: Iterable<string>): StoreChange {
    const removedNodes: string[] = [];
    const removedEdges: string[] = [];
    for (const id of ids) {
      if (!this.nodesById.delete(id)) continue;
      removedNodes.push(id);
      for (const edgeId of [...(this.outgoing.get(id) ?? []), ...(this.incoming.get(id) ?? [])]) {
        if (this.dropEdge(edgeId)) removedEdges.push(edgeId);
      }
      this.outgoing.delete(id);
      this.incoming.delete(id);
    }
    if (!removedNodes.length && !removedEdges.length) return NO_CHANGE;
    return { addedNodes: [], removedNodes, addedEdges: [], removedEdges };
  }

  removeEdges(ids: Iterable<string>): StoreChange {
    const removedEdges: string[] = [];
    for (const id of ids) if (this.dropEdge(id)) removedEdges.push(id);
    if (!removedEdges.length) return NO_CHANGE;
    return { addedNodes: [], removedNodes: [], addedEdges: [], removedEdges };
  }

  /** Edge ids touching a node, in the given direction. */
  edgeIds(nodeId: string, direction: 'in' | 'out' | 'both' = 'both'): string[] {
    const out = direction === 'in' ? [] : [...(this.outgoing.get(nodeId) ?? [])];
    const inc = direction === 'out' ? [] : [...(this.incoming.get(nodeId) ?? [])];
    return [...out, ...inc];
  }

  /** Adjacent node ids, in the given direction. */
  neighbours(nodeId: string, direction: 'in' | 'out' | 'both' = 'both'): string[] {
    const result = new Set<string>();
    for (const edgeId of this.edgeIds(nodeId, direction)) {
      const edge = this.edgesById.get(edgeId);
      if (!edge) continue;
      result.add(edge.source === nodeId ? edge.target : edge.source);
    }
    result.delete(nodeId);
    return [...result];
  }

  /** Degree, counting both directions unless narrowed. */
  degree(nodeId: string, direction: 'in' | 'out' | 'both' = 'both'): number {
    return this.edgeIds(nodeId, direction).length;
  }

  clear(): void {
    this.nodesById.clear();
    this.edgesById.clear();
    this.outgoing.clear();
    this.incoming.clear();
  }

  private dropEdge(id: string): boolean {
    const edge = this.edgesById.get(id);
    if (!edge) return false;
    this.edgesById.delete(id);
    this.outgoing.get(edge.source)?.delete(id);
    this.incoming.get(edge.target)?.delete(id);
    return true;
  }
}

/**
 * Merge a repeat sighting of a node into the one already held.
 *
 * The rule that matters: a resolved node never becomes unresolved, and a known label is never
 * replaced by nothing. Both happen constantly — a relation target arrives as a bare id long after the
 * instance itself was loaded — and getting it backwards makes nodes flicker into placeholders as the
 * graph grows, which reads as data loss.
 */
function mergeNode(existing: GraphNode, incoming: GraphNode): GraphNode {
  const resolved = existing.unresolved !== true || incoming.unresolved !== true;
  return {
    ...existing,
    ...incoming,
    label: incoming.label ?? existing.label,
    data: existing.data || incoming.data ? { ...existing.data, ...incoming.data } : undefined,
    unresolved: resolved ? undefined : true,
  };
}

function addSetEntry(map: Map<string, Set<string>>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) existing.add(value);
  else map.set(key, new Set([value]));
}
