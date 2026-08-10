/**
 * The graph's own value types — nodes, edges, and the shape an expander returns.
 *
 * Kept apart from the plugin contracts in `expander.ts` / `layout.ts` for the reason the globe splits
 * its protocol from its widget props: someone reading "what is a node" and someone writing a plugin
 * are doing different jobs, and one file that answers both makes each reader skip half of it.
 */
import type { NodeKind } from './address';

/** A scalar an expander may attach to a node or edge. Anything richer belongs behind a `nodeTemplate`. */
export type GraphValue = string | number | boolean | null;

export interface GraphNode {
  /** Stable address — see `address.ts`. The identity for dedup, persistence and hit-testing. */
  id: string;
  /** Structural kind, denormalised from the address so styling and dispatch never parse. */
  kind: NodeKind;
  /**
   * What this node *means*: an entity class name, a property name, a cluster generator. Style rules
   * and the renderer registry key on this or on {@link kind}.
   */
  type: string;
  /** Display label. Expanders should fill this; the renderer falls back to the type. */
  label?: string;
  /** Scalars the template may read as `$node.data.<key>`, and style rules may match on. */
  data?: Record<string, GraphValue>;
  /**
   * The node exists but its content has not been read.
   *
   * Normal, not exceptional: a relation target whose instance has not synced yet, a space that has
   * not been joined, a dataset behind a permission. Without this the renderer cannot tell "nothing
   * there" from "not here yet", and every expander invents its own placeholder.
   */
  unresolved?: boolean;
  /** Which expander produced it — for debugging, and so re-expansion can be attributed. */
  source?: string;
}

export interface GraphEdge {
  /** Stable id. Convention: `<source>|<predicate>|<target>`, so re-expansion is idempotent. */
  id: string;
  source: string;
  target: string;
  /** What relates them: a relation name, a predicate, `contains`. Style rules match on it. */
  type: string;
  label?: string;
  data?: Record<string, GraphValue>;
  /**
   * How many original edges this one stands for. `> 1` means it is a bundle produced by collapsing —
   * see `bundling.ts` in the core. Renderers use it to thicken the line and label the count.
   */
  weight?: number;
  /**
   * Set when the edge is an entity in its own right (a reified relationship carrying properties).
   * Holds that entity's address, so clicking the edge can select the underlying record.
   */
  reifiedAs?: string;
}

/** A batch of graph, as returned by an expander or a seed source. */
export interface GraphFragment {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
