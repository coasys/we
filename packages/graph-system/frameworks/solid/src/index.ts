/**
 * `@we/graph-solid` — the Solid binding for the graph engine.
 *
 * One component and its props. Everything interesting is in `@we/graph-core`; this package exists so
 * that a second framework is a second adapter of this size rather than a second engine.
 */
export { GraphView } from './GraphView.solid';
export type { GraphHostBindings, GraphViewProps } from './GraphView.types';
export { bowOffsets, edgePath, groupByEndpoints, trimToRadius } from './geometry';
