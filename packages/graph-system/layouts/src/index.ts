/**
 * `@we/graph-layouts` — positioning strategies, each a self-contained implementation of `Layout`.
 *
 * Split between one iterative layout (force, over d3-force) and four deterministic ones. A module may
 * contribute more without touching this package; these are simply the set WE ships.
 */
export { forceLayout } from './force';
export type { ForceLayoutOptions } from './force';
export { forestLayout } from './forest';
export type { ForestLayoutOptions, UnattachedPlacement } from './forest';
export { gridLayout, manualLayout, radialLayout, treeLayout } from './deterministic';
export type { GridLayoutOptions, ManualLayoutOptions, RadialLayoutOptions, TreeLayoutOptions } from './deterministic';

import { gridLayout, manualLayout, radialLayout, treeLayout } from './deterministic';
import { forceLayout } from './force';
import { forestLayout } from './forest';

/** The default set, keyed by the id a template names in `layout.type`. */
export function defaultLayouts() {
  return {
    force: forceLayout,
    tree: treeLayout,
    forest: forestLayout,
    radial: radialLayout,
    grid: gridLayout,
    manual: manualLayout,
  };
}
