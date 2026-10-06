/**
 * @we/cesium-layers
 *
 * Modular layer system for CesiumJS globe
 */

// Export the layer contract
export type {
  CesiumRendererContext,
  GlobeEngine,
  LayerConfig,
  LayerEventBus,
  LayerKind,
  LayerKinds,
  LayerRenderer,
  LayerRenderers,
  MapLibreRendererContext,
  RendererContext,
  RendererFactory,
} from './types';

// Export planet layers (surface layers)
export {
  areasLayer,
  countryOutlinesLayer,
  h3HexagonsLayer,
  heatmapLayer,
  hexbinLayer,
  pathsLayer,
  pointLocationsLayer,
  pointsLayer,
  satelliteOverlayLayer,
} from './planet';
export type {
  AreasOptions,
  CountryOutlinesOptions,
  H3HexagonsOptions,
  HeatmapOptions,
  HexbinOptions,
  PathsOptions,
  PointLocationsOptions,
  PointsOptions,
  SatelliteOverlayOptions,
  UserLocation,
} from './planet';

// Export background layers (space layers)
export { skyboxLayer, proceduralStarsLayer, solarSystemLayer } from './background';
export type { SkyboxLayerOptions, ProceduralStarsLayerOptions, SolarSystemLayerOptions } from './background';
