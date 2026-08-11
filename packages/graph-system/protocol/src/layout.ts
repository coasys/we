/**
 * The layout contract.
 *
 * Two things here are load-bearing and neither is obvious from the name.
 *
 * **Containment.** Expansion produces nesting — a collection holding children, a cluster holding its
 * members — so a layout may be asked to place children *inside* their parent's region. Simple layouts
 * ignore {@link LayoutInput.containment}; compound ones use it. It is in the contract from the start
 * because adding a hierarchy parameter once four layouts exist means rewriting four layouts.
 *
 * **Warm start.** Nodes arrive continuously: from expansion, and (once interpretation runs on a live
 * call) from the data layer while the user is looking at the map. A layout that re-runs from scratch
 * on every insert makes the graph jump every few seconds. So a layout receives the positions it
 * already produced and is expected to keep them roughly, moving new nodes into place around them.
 */
import type { GraphEdge, GraphNode } from './graph';

export interface Point {
  x: number;
  y: number;
}

/** A node's placement. `fixed` means the user pinned it and the layout must not move it. */
export interface Placement extends Point {
  fixed?: boolean;
}

export interface LayoutInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /**
   * Positions from the previous run, by node address. Nodes present here should stay near where they
   * were; nodes absent are new and may be placed freely.
   */
  previous?: ReadonlyMap<string, Placement>;
  /**
   * Parent → children, for layouts that place children within a parent's region. Only nodes that
   * actually contain others appear as keys.
   */
  containment?: ReadonlyMap<string, string[]>;
  /** The area to lay out into, in world units. */
  viewport: { width: number; height: number };
}

export interface LayoutResult {
  positions: Map<string, Placement>;
  /**
   * True while the layout is still settling — a force simulation between ticks.
   *
   * The driver polls {@link Layout.tick} while this is set, then stops. A layout that computes in one
   * pass simply never sets it, and costs nothing.
   */
  running?: boolean;
}

/**
 * A layout strategy.
 *
 * Stateful on purpose: a force simulation has to keep velocities between ticks, and throwing them
 * away each frame is what makes naive force layouts vibrate.
 */
export interface Layout {
  id: string;
  description?: string;
  /** Seed or re-seed. Called when the node set changes. */
  init(input: LayoutInput): LayoutResult;
  /** Advance one step. Only called while the previous result reported `running`. */
  tick?(): LayoutResult;
  /** Pin a node — a drag in progress, or a user-fixed position. */
  fix?(id: string, at: Point | null): void;
  /** Release resources. */
  stop?(): void;
}

export type LayoutFactory<TOptions = unknown> = (options?: TOptions) => Layout;

/**
 * Where an edge actually runs, in world units.
 *
 * Geometry, not drawing instructions: control points rather than an SVG path string, so the engine can
 * measure an edge — for picking — without knowing how any particular renderer expresses it, and a
 * canvas renderer can stroke the same curve without re-deriving it.
 *
 * That split is what lets the DOM stop owning edge hit-testing. While `pointer-events: stroke` did the
 * picking, edges were the one thing behaviours could only reach through the DOM, which is also why a
 * canvas renderer could not have supported clicking one.
 */
export interface EdgeGeometry {
  id: string;
  from: Point;
  /** Trimmed to the target's edge, so an arrowhead lands on the node rather than under it. */
  to: Point;
  /** Quadratic control point. Absent for straight and orthogonal routes. */
  control?: Point;
  /** Corner for an orthogonal route: from → elbow → to. */
  elbow?: Point;
  curve: 'straight' | 'bezier' | 'orthogonal';
  /** Midpoint of the drawn route — where a label sits. */
  mid: Point;
}
