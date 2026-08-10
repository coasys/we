/**
 * `@we/graph-core` — the engine, with no framework and no backend in it.
 *
 * Two layers live here, and keeping them apart is deliberate:
 *
 * - **The scene** — {@link Viewport}, {@link SpatialIndex}, selection, positions. Everything needed to
 *   draw and interact with a set of placed nodes, knowing nothing about where they came from.
 * - **Exploration** — {@link GraphStore}, {@link ExpansionState}, {@link GraphEngine}. Expanders,
 *   expansion state, reference-counted collapse, bundling, budgets.
 *
 * A board built on this uses the scene and none of the exploration; a knowledge map uses both. That
 * is the split that stops a board dragging in expansion state it has no use for, and stops undo and
 * marquee selection leaking into an explorer that will never want them.
 */
export {
  defaultBehaviours,
  dispatchPointer,
  dragNodeBehaviour,
  expandOnClickBehaviour,
  expandOnDoubleClickBehaviour,
  panZoomBehaviour,
  selectBehaviour,
} from './behaviours';
export type { PanZoomOptions, SelectOptions } from './behaviours';
export { GraphEngine, kindOf } from './engine';
export type { ChangeReason, EngineOptions, EngineStatus } from './engine';
export { ExpansionState, SEED_OPENER } from './expansion';
export type { CollapseResult } from './expansion';
export { PluginRegistry } from './registry';
export type { GraphPlugins } from './registry';
export { SpatialIndex } from './spatial';
export type { IndexedNode } from './spatial';
export { GraphStore } from './store';
export type { StoreChange } from './store';
export { edgeVisual, matches, nodeVisual, resolveColor, resolveNumber, resolveStyle } from './style';
export type { EdgeVisual, MetricValues } from './style';
export { boundsOf, Viewport } from './viewport';
export type { Bounds, ViewportState } from './viewport';
