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
  RendererContext,
  RendererFactory,
} from './types';

// Export planet layers (surface layers)
export { countryOutlinesLayer, h3HexagonsLayer, pointLocationsLayer, pointsLayer } from './planet';
export type {
  CountryOutlinesOptions,
  H3HexagonsOptions,
  PointLocationsOptions,
  PointsOptions,
  UserLocation,
} from './planet';

// Export background layers (space layers)
export { skyboxLayer, proceduralStarsLayer, solarSystemLayer } from './background';
export type { SkyboxLayerOptions, ProceduralStarsLayerOptions, SolarSystemLayerOptions } from './background';
