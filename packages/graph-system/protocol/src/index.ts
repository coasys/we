/**
 * `@we/graph-protocol` — the contracts the graph system is assembled from, and nothing else.
 *
 * Types only: this package erases entirely at build time, so depending on it costs a consumer no
 * runtime weight. It is the import for someone *writing a plugin* — an expander, a layout, a
 * renderer, a behaviour, a metric — which is a different job from placing a graph in a template, and
 * increasingly a third-party one.
 *
 * The pieces, and where to look:
 * - `address.ts` — how anything that can be a node is named. The load-bearing decision.
 * - `graph.ts` — nodes, edges, fragments.
 * - `expander.ts` — the primary extension point: what is adjacent to this node?
 * - `layout.ts` — positioning, with containment and warm-start in the contract.
 * - `style.ts` — declarative rules, and the metric escape hatch.
 * - `render.ts` — node renderers and interaction behaviours.
 * - `spec.ts` — the JSON a template writes.
 */
export type { NodeAddress, NodeKind } from './address';
export {
  addressKind,
  clusterAddress,
  datasetAddress,
  entityAddress,
  literalAddress,
  parseAddress,
  propertyAddress,
  resourceAddress,
} from './address';
export type { GraphEdge, GraphFragment, GraphNode, GraphValue } from './graph';
export type {
  EntityShape,
  Expander,
  ExpanderContext,
  ExpanderFactory,
  ExpanderQuery,
  ExpandDirection,
  ExpandRequest,
  ExpandResult,
  SeedSource,
  WatchQuery,
} from './expander';
export type {
  EdgeCurve,
  EdgeGeometry,
  Layout,
  LayoutFactory,
  LayoutInput,
  LayoutResult,
  Placement,
  Point,
} from './layout';
export type {
  Behaviour,
  BehaviourContext,
  BehaviourFactory,
  ControlContext,
  GraphControl,
  GraphControlFactory,
  GraphEvent,
  NodeRenderer,
  NodeVisual,
  PointerInput,
} from './render';
export type { AutoExpandRule, BehaviourSpec, ExpansionSpec, GraphSpec, LayoutSpec, SeedSpec } from './spec';
export type {
  CardShape,
  EdgeStyle,
  EdgeStyleRules,
  FieldRef,
  MatchClause,
  MatchOperators,
  Metric,
  MetricRef,
  NodeStyle,
  NodeStyleRules,
  StyleRule,
  StyleRules,
  StyleValue,
} from './style';
