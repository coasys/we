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
import { deviceHints, engineChoiceFrom, imageryChoiceFrom, ionTokenFrom, resolveEngine } from '@we/module-globe';
import { createMemo, lazy, Show } from 'solid-js';

import { clockRegistry } from '../../../shared/clocks';
import { moduleRegistry } from '../../../shared/registries/moduleRegistry';

/**
 * The globe, drawn by whichever engine the globe module's `engine` setting resolves to on this device:
 * Cesium, the full 3D globe, or MapLibre, the light one. Templates name `CesiumGlobe` and never an
 * engine; the name predates the second engine and is kept so no template, stored or shipped, changes.
 *
 * Each engine is its own chunk, with its own layer registry, so a device on MapLibre never downloads
 * Cesium. The imagery choice and its key are filled in here from the module's settings, after the
 * template's own props so a template cannot supply them: see `CesiumGlobeProps.imagery`. So are the
 * app's clocks, which a template's `clock: "<name>"` resolves against, so the globe follows the same
 * clock `clockStore` plays.
 */
const globeSettings = () => moduleRegistry.settingsOf('globe');

const CesiumEngine = lazy(async () => {
  const [{ CesiumGlobe }, { layerKinds }] = await Promise.all([
    import('@we/globe-widget'),
    import('@we/module-globe/layers'),
  ]);
  return {
    default: (props: Record<string, unknown>) => (
      <CesiumGlobe
        {...props}
        layerKinds={layerKinds}
        clocks={clockRegistry}
        imagery={imageryChoiceFrom(globeSettings())}
        ionAccessToken={ionTokenFrom(globeSettings())}
      />
    ),
  };
});

const MapLibreEngine = lazy(async () => {
  const [{ MapLibreGlobe }, { maplibreLayerKinds }] = await Promise.all([
    import('@we/globe-widget/maplibre'),
    import('@we/module-globe/layers-maplibre'),
  ]);
  return {
    default: (props: Record<string, unknown>) => (
      <MapLibreGlobe
        {...props}
        layerKinds={maplibreLayerKinds}
        clocks={clockRegistry}
        imagery={imageryChoiceFrom(globeSettings())}
      />
    ),
  };
});

export function GlobeOnDemand(props: Record<string, unknown>) {
  // The device does not change under a mounted globe; the setting can, and switches the engine.
  const device = deviceHints();
  const engine = createMemo(() => resolveEngine(engineChoiceFrom(globeSettings()), device));
  return (
    <Show when={engine() === 'maplibre'} fallback={<CesiumEngine {...props} />}>
      <MapLibreEngine {...props} />
    </Show>
  );
}

/** The graph engine, its expanders, layouts and d3-force — loaded when a template first draws one. */
export const GraphViewOnDemand = lazy(() => import('../components/GraphHost'));

/** What `initializeIntegrations` hands each module factory. */
export const moduleHostComponents: Record<string, unknown> = {
  CesiumGlobe: GlobeOnDemand,
  GraphView: GraphViewOnDemand,
};
