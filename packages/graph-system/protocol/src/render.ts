/**
 * Renderer and behaviour contracts — the two plugin points that touch the screen.
 *
 * Both are declared here, in the framework-neutral package, and neither names a framework. A node
 * renderer describes *what to draw* as data; the framework adapter decides how. That keeps the
 * decision "DOM element or canvas shape" out of the plugin and in the renderer, which is what lets
 * the same graph run as a hundred rich cards or as ten thousand dots without the plugins knowing.
 */
import type { GraphEdge, GraphNode } from './graph';
import type { Point } from './layout';
import type { CardShape, NodeStyle } from './style';

/**
 * A drawing instruction for one node, resolved from its style rules.
 *
 * Deliberately a small vocabulary of shapes rather than arbitrary drawing: everything here can be
 * painted by a DOM element *and* by a canvas context, which is the property that makes dense mode
 * possible later without rewriting the plugins that produce these.
 */
export interface NodeVisual {
  shape: 'circle' | 'rect' | 'card' | 'template';
  /** Radius for a mark; half-height for a box. A card uses `width`/`height` instead. */
  size: number;
  /** Card geometry, in world units. Present only for `shape: 'card'`. */
  width?: number;
  height?: number;
  color: string;
  borderColor?: string;
  borderWidth?: number;
  opacity?: number;
  label?: string;
  labelColor?: string;
  labelSize?: number;
  /** False pins the label to a constant on-screen size. See `NodeStyle.scaleLabelWithZoom`. */
  scaleLabelWithZoom?: boolean;
  icon?: string;
  image?: string;
  /** Registered node-content renderer to draw inside a card — see `NodeStyle.content`. */
  content?: string;
  /** Zoom below which the content is hidden and the label stands in for it. */
  contentMinZoom?: number;
  /** The card's outline. See `NodeStyle.cardShape`. */
  cardShape?: CardShape;
  /** Multiplier on the size the card's content is drawn at. See `NodeStyle.contentScale`. */
  contentScale?: number;
}

/**
 * A registered node renderer.
 *
 * The default renderer turns {@link NodeStyle} into a {@link NodeVisual}; a plugin overrides that for
 * the kinds it claims — an avatar for agents, a swatch for colours, a sparkline for a metric.
 * Renderers that need real DOM (an editable text node) declare `requiresDom`, which is what a dense
 * canvas mode checks before refusing to enter.
 */
export interface NodeRenderer {
  id: string;
  description?: string;
  /** Structural kinds this claims. Absent means it is only used when named explicitly by a style rule. */
  kinds?: string[];
  requiresDom?: boolean;
  visual(node: GraphNode, style: NodeStyle): NodeVisual;
}

/** What a behaviour is allowed to do to the scene. Deliberately narrow. */
export interface BehaviourContext {
  /** Nodes currently under the pointer, nearest first. */
  hitTest(at: Point): string[];
  /**
   * The edge under the pointer, if any, within a tolerance.
   *
   * Separate from {@link hitTest} because nodes win: an edge passing behind a node is not what you
   * meant to click, and a caller that wants both asks for nodes first.
   */
  hitTestEdge(at: Point, tolerance?: number): string | null;
  select(ids: string[], mode?: 'replace' | 'add' | 'toggle'): void;
  selection(): string[];
  /** Ask the engine to expand a node — the click-to-explore behaviour's whole job. */
  expand(id: string, direction?: 'in' | 'out' | 'both'): void;
  collapse(id: string): void;
  /** Pin a node at a world position, or release it. */
  pin(id: string, at: Point | null): void;
  /**
   * Whether the user is currently allowed to move nodes.
   *
   * Read by anything that moves one on a gesture, so a locked graph refuses at the point the gesture
   * starts rather than by silently discarding the result.
   */
  locked(): boolean;
  /**
   * Where a node currently is, in world units.
   *
   * Needed by anything that moves a node *relative* to where it already was — a drag has to preserve
   * the offset between the node's centre and the point you grabbed it by, or it snaps to the cursor.
   */
  positionOf(id: string): Point | null;
  /** Move the camera. */
  pan(dx: number, dy: number): void;
  zoomAt(at: Point, factor: number): void;
  /** Screen ↔ world conversion, since pointer events arrive in screen space. */
  toWorld(at: Point): Point;
  toScreen(at: Point): Point;
  /**
   * Show a line being drawn from a node to a point in world space; `null` clears it.
   *
   * The one piece of *transient* scene state a behaviour is allowed to set, and it is here rather
   * than owned by the behaviour because the renderer has to draw it and behaviours never touch the
   * DOM. A drag with nothing following the pointer is the difference between a gesture and a guess:
   * without it, connecting two nodes means pressing on one, moving across a graph that looks
   * completely inert, and hoping.
   */
  drawConnection(from: string | null, to?: Point): void;
  /** Emit a graph event to the host — what a template binds `onNodeClick` and friends to. */
  emit(event: GraphEvent): void;
}

/** Events a template may bind handlers to. Payloads are plain data, addressable from `$event.detail`. */
export type GraphEvent =
  | { type: 'nodeClick'; node: GraphNode }
  | { type: 'nodeDoubleClick'; node: GraphNode }
  | { type: 'nodeHover'; node: GraphNode | null }
  | { type: 'edgeClick'; edge: GraphEdge }
  | { type: 'selectionChange'; ids: string[] }
  | { type: 'nodeDragEnd'; node: GraphNode; position: Point }
  /**
   * The user resized a card, to this size in world units.
   *
   * Intent rather than a mutation, like every other event here: the engine has no write path, and
   * where a card's size *lives* is the consumer's business — on a board it belongs to the placement,
   * so the same note can be a wide banner on one board and a small square on another.
   *
   * Emitted on release rather than continuously. The drag itself is drawn locally, so what you see
   * follows the pointer without a write per frame.
   */
  | { type: 'nodeResize'; node: GraphNode; width: number; height: number }
  /**
   * The user drew a line from one node to another.
   *
   * Intent, never a mutation — the same rule `we-sortable` follows. What connecting two things
   * *means* is the consumer's business and differs completely: a knowledge map creates a
   * relationship record somebody can argue with, a board might draw an arrow that is only ever
   * decoration, an outline would reparent. A gesture that wrote one of those would be useless to the
   * others, and the engine has no write path anyway.
   */
  | { type: 'edgeCreate'; source: GraphNode; target: GraphNode }
  /**
   * The user double-clicked empty canvas, at this point in world space.
   *
   * Intent again, and the position is the whole of it: "make something here" is a different request
   * from "make something", and a surface where position is the data cannot ask the second one. What
   * gets made is the consumer's business — a board creates a card, an outline might do nothing.
   */
  | { type: 'canvasDoubleClick'; at: Point }
  | { type: 'expanded'; id: string; added: number; total?: number }
  | { type: 'budgetReached'; limit: number };

/** A normalised pointer event, so behaviours never touch a DOM event directly. */
export interface PointerInput {
  /** Screen-space position within the graph surface. */
  at: Point;
  buttons: number;
  shiftKey: boolean;
  metaKey: boolean;
  /** Wheel delta, `wheel` only. */
  delta?: number;
}

/**
 * A registered interaction.
 *
 * Additive and ordered: several are active at once, and one may claim an event by returning `true`,
 * which stops later behaviours seeing it. That is how drag-node takes precedence over pan-canvas
 * without either knowing the other exists.
 */
export interface Behaviour {
  id: string;
  description?: string;
  onPointerDown?(input: PointerInput, ctx: BehaviourContext): boolean | void;
  onPointerMove?(input: PointerInput, ctx: BehaviourContext): boolean | void;
  onPointerUp?(input: PointerInput, ctx: BehaviourContext): boolean | void;
  /**
   * The gesture was abandoned — the pointer was captured away, the window lost focus, a touch was
   * interrupted. Any behaviour holding state across a gesture must reset here, or it stays latched.
   */
  onPointerCancel?(input: PointerInput, ctx: BehaviourContext): boolean | void;
  onWheel?(input: PointerInput, ctx: BehaviourContext): boolean | void;
  onDoubleClick?(input: PointerInput, ctx: BehaviourContext): boolean | void;
}

export type BehaviourFactory<TOptions = unknown> = (options?: TOptions) => Behaviour;

/**
 * A button in the graph's own chrome.
 *
 * Declared as data — an icon, a title and what it does — rather than as a component, so the renderer
 * draws every control the same way and a module can contribute one without shipping framework code.
 * The same reasoning as a module's `launcher`: the contributor knows what the control *means*, only
 * the host knows where controls go and how they should look.
 */
export interface GraphControl {
  id: string;
  /** Phosphor icon name. */
  icon: string;
  /** Tooltip, and the accessible name. */
  title: string;
  run(ctx: ControlContext): void;
  /**
   * Whether this control is currently *on*.
   *
   * Every control used to be a momentary action — zoom, fit, re-run the layout — so there was nothing
   * for a button to be. A lock is not that: it has a state, and a toggle that does not show its own
   * state is a switch you have to remember the position of. Omitted for an action, which is most of
   * them.
   */
  active?(ctx: ControlContext): boolean;
  /**
   * Whether it can be used at all right now.
   *
   * Pinning acts on the selection, so with nothing selected it has nothing to act on. A button that
   * silently does nothing teaches people it is broken.
   */
  enabled?(ctx: ControlContext): boolean;
  /** Icon and tooltip while active, for a toggle that reads better as two states than one pressed one. */
  activeIcon?: string;
  activeTitle?: string;
}

/**
 * What a control is allowed to do.
 *
 * Narrow on purpose: chrome acts on the *scene* — what is on screen and how it is arranged — and
 * never on the data. `relayout` has always moved nodes, so the line was never "does not touch
 * positions"; it is that nothing here writes anything back. Pinning and locking sit on the same side
 * of it: a pinned node is held by the layout, not saved, and persisting a position remains the job of
 * `onNodeDragEnd` and the host that listens to it.
 */
export interface ControlContext {
  zoomBy(factor: number): void;
  fit(): void;
  relayout(): void;
  viewport(): { x: number; y: number; zoom: number; width: number; height: number };
  /** Ids currently selected. */
  selection(): readonly string[];
  /** Whether a node is held where it was put, so a layout will not move it. */
  isPinned(id: string): boolean;
  /** Hold nodes where they are, or release them back to the layout. */
  setPinned(ids: readonly string[], pinned: boolean): void;
  /**
   * Whether node movement by the user is blocked.
   *
   * Deliberately about the user rather than the layout: locking a board stops it being rearranged by
   * accident, and freezing a force simulation is a different request that nobody has made.
   */
  isLocked(): boolean;
  setLocked(locked: boolean): void;
}

export type GraphControlFactory<TOptions = unknown> = (options?: TOptions) => GraphControl;
