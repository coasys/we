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
import type { NodeStyle } from './style';

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
}

/** What a control is allowed to do. Narrow on purpose — chrome nudges the view, it does not edit it. */
export interface ControlContext {
  zoomBy(factor: number): void;
  fit(): void;
  relayout(): void;
  viewport(): { x: number; y: number; zoom: number; width: number; height: number };
}

export type GraphControlFactory<TOptions = unknown> = (options?: TOptions) => GraphControl;
