/**
 * Framework components the host lends to bundled modules that contribute them.
 *
 * The globe module contributes `CesiumGlobe` and the graph module `GraphView`, and neither package
 * may import Solid — a module package importing a framework is the second-runtime hazard the whole
 * contract is arranged to avoid. So the host holds the Solid half, hands it to each module's
 * `createModule(host)`, and the module hands it back as a contribution the registry records. That
 * round trip is what makes `moduleRegistry.components()` the truth about which module a component
 * came from, which is what `requiredBy` and the settings screen depend on.
 *
 * Fetched when something first renders them, rather than before anything renders at all: each
 * carries a dependency far larger than the app around it. This is code-splitting inside one build —
 * Rollup still gives every chunk the same `solid-js`, so the single-instance guarantee holds.
 */
import { lazy } from 'solid-js';

/** Cesium, three, and the layer stack — several times the size of the rest of the app. */
export const CesiumGlobeOnDemand = lazy(async () => {
  const [{ CesiumGlobe }, { layerFactoryRegistry }] = await Promise.all([
    import('@we/globe-widget'),
    import('@we/module-globe/layers'),
  ]);
  return {
    default: (props: Record<string, unknown>) => <CesiumGlobe {...props} layerFactoryRegistry={layerFactoryRegistry} />,
  };
});

/** The graph engine, its expanders, layouts and d3-force — loaded when a template first draws one. */
export const GraphViewOnDemand = lazy(() => import('../components/GraphHost'));

/** What `initializeIntegrations` hands each module factory. */
export const moduleHostComponents: Record<string, unknown> = {
  CesiumGlobe: CesiumGlobeOnDemand,
  GraphView: GraphViewOnDemand,
};
