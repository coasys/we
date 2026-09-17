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
 * {@link foldGraph} sits with the scene rather than with exploration, which is why it is not part of
 * {@link ExpansionState}: folding a card on a canvas is a reader hiding what is *already loaded*,
 * where expanding is a graph fetching what it has not got. Same two rules — never take a card
 * somebody else is holding, and say what went away — asked of the edges instead of of provenance.
 *
 * A canvas built on this uses the scene and none of the exploration; a knowledge map uses both. That
 * is the split that stops a canvas dragging in expansion state it has no use for, and stops undo and
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
export {
  DEFAULT_CONTROLS,
  defaultControls,
  fitControl,
  relayoutControl,
  zoomInControl,
  zoomOutControl,
} from './controls';
export { connectionTarget } from './connect';
export { GraphEngine, kindOf } from './engine';
export {
  anchorsOf,
  bowOffsets,
  distanceToEdge,
  bendPoints,
  edgeBounds,
  endOf,
  fractionAlong,
  groupByEndpoints,
  orthogonalThrough,
  pointAlong,
  polyline,
  routeEdge,
  routesAlike,
  splineThrough,
  trimToRadius,
  waypointFromWorld,
  waypointsOf,
  waypointToWorld,
} from './geometry';
export type { EdgeClearance, EdgeWaypoint } from './geometry';
export { communityMetric, defaultMetrics, degreeMetric } from './metrics';
export type { ChangeReason, EngineOptions, EngineStatus } from './engine';
export { ExpansionState, SEED_OPENER } from './expansion';
export type { CollapseResult } from './expansion';
export { FOLD_BUNDLE, foldableIn, foldGraph, wouldFold } from './fold';
export type { FoldResult } from './fold';
export { PluginRegistry } from './registry';
export type { GraphPlugins } from './registry';
export { SpatialIndex } from './spatial';
export type { IndexedNode } from './spatial';
export { GraphStore } from './store';
export type { StoreChange } from './store';
export {
  edgeVisual,
  matches,
  nodeVisual,
  readField,
  resolveColor,
  resolveNumber,
  resolveStyle,
  resolveText,
} from './style';
export type { EdgeVisual, MetricValues } from './style';
export { boundsOf, Viewport } from './viewport';
export type { Bounds, ViewportState } from './viewport';
