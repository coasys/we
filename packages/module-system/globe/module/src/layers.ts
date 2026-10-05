/**
 * The layer set this module ships — a **module-private registry**, nested inside the module system.
 *
 * Worth noting as a shape: a module may own a plugin system of its own without the host needing a
 * generic "sub-registry" concept. Third-party layers do not need to live in this package either, since
 * `CesiumGlobe` resolves layers through an injected `Record<string, LayerFactory>` — an external layer
 * is just a package exporting a factory.
 *
 * ## Why this is its own entry
 *
 * Every layer reaches for Cesium, so importing this pulls a 3D engine behind it. The module
 * *definition* needs none of that — it describes slots, capabilities and a component name — so
 * keeping them in one file meant registering the module cost megabytes before anything rendered a
 * globe. Separate entries let the host load the definition eagerly and the layers only when a globe
 * actually mounts.
 */
import {
  countryOutlinesLayer,
  h3HexagonsLayer,
  type LayerKinds,
  pointLocationsLayer,
  pointsLayer,
  proceduralStarsLayer,
  skyboxLayer,
  solarSystemLayer,
} from '@we/globe-layers';

/**
 * The kinds this module ships, by id: what a template's `factory` resolves against. A module-private
 * registry; a third-party kind is a package exporting a `LayerKind`, added here.
 *
 * Keyed by each kind's own `id`, so the name a template writes and the name a kind declares cannot
 * drift apart.
 */
export const layerKinds: LayerKinds = Object.fromEntries(
  [
    pointsLayer,
    pointLocationsLayer,
    countryOutlinesLayer,
    h3HexagonsLayer,
    skyboxLayer,
    proceduralStarsLayer,
    solarSystemLayer,
  ].map((kind) => [kind.id, kind]),
);
