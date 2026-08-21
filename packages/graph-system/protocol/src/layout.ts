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
  /**
   * The world rectangle currently on screen.
   *
   * For a layout that has to *put* something rather than derive where it goes. A node with no
   * position of its own has to land somewhere, and the origin is the one place guaranteed to be
   * wrong — it is wherever the reader is not. Absent before a surface has been measured, which is
   * why it is optional and why a layout falls back to the origin rather than requiring it.
   */
  visible?: { x: number; y: number; width: number; height: number };
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
  /**
   * Anything the layout could not do, in the author's terms.
   *
   * A layout that finds nothing to work with still has to return positions, so without somewhere to
   * say so its only options are to fail silently or to invent an arrangement and pretend it derived
   * one. `manual` is the case that forced this: asked to read positions from node data that does not
   * carry any, it keeps what is already there — indistinguishable, on screen, from a layout that ran
   * and decided nothing needed moving.
   */
  warnings?: string[];
}

/**
 * A layout strategy.
 *
 * Stateful on purpose: a force simulation has to keep velocities between ticks, and throwing them
 * away each frame is what makes naive force layouts vibrate.
 */
export interface Layout {
  id: string;
  /**
   * Whether this layout works out where nodes go, as opposed to reading it from them.
   *
   * Almost all of them do, so it is omitted by default and only `manual` says otherwise. What it
   * buys is the difference between a pinned node being an *exception* and being the rule: a node held
   * against a force or tree layout is worth marking, because the layout would otherwise move it, while
   * on a board every node is placed by definition and the same mark is on everything and means
   * nothing.
   */
  derivesPositions?: boolean;
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
 * The shape an edge is drawn with.
 *
 * Named for what it looks like rather than for the maths behind it, because these names are written by
 * hand into templates and chosen by a model from a sentence like "show me how these connect". `arc`
 * says bows-to-one-side; `bezier` said quadratic-with-one-control, which is both harder to picture and
 * actively misleading — in most node editors "bezier" means the S-curve, which is `smooth` here.
 *
 * - `straight` — a direct line. Says the least, and is the right answer when the layout is doing the
 *   talking.
 * - `arc` — bows to one side. Deliberate curvature, when a graph is dense enough that lines need
 *   telling apart by shape.
 * - `smooth` — leaves and arrives along the dominant axis, the flow-chart S. The default: it reads as
 *   direction without insisting on it, and it is the shape people expect from a node graph.
 * - `step` — right angles. For containment and org charts, where the eye follows a rank rather than a
 *   line.
 */
export type EdgeCurve = 'straight' | 'arc' | 'smooth' | 'step';

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
  /**
   * First control point: the whole of an `arc`'s quadratic, or the departure tangent of a `smooth`
   * cubic. Absent for `straight` and `step`.
   */
  control?: Point;
  /** Second control point — the arrival tangent of a `smooth` cubic. Its presence is what makes the
   * route cubic rather than quadratic, so a renderer picks its path command from that alone. */
  control2?: Point;
  /**
   * Corners of a `step` route, between `from` and `to`.
   *
   * A list rather than the single point this used to be, because a step turns twice, and which way it
   * turns first depends on the axis the edge mostly runs along. Storing one corner forced every
   * consumer to re-derive the second and to assume horizontal-first, which is wrong for a graph laid
   * out top-to-bottom.
   */
  elbows?: Point[];
  curve: EdgeCurve;
  /** Midpoint of the drawn route — where a label sits. */
  mid: Point;
}
