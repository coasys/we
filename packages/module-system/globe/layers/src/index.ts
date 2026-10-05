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
export { pointLocationsLayer, countryOutlinesLayer, h3HexagonsLayer } from './planet';
export type { UserLocation, PointLocationsOptions, CountryOutlinesOptions, H3HexagonsOptions } from './planet';

// Export background layers (space layers)
export { skyboxLayer, proceduralStarsLayer, solarSystemLayer } from './background';
export type { SkyboxLayerOptions, ProceduralStarsLayerOptions, SolarSystemLayerOptions } from './background';
