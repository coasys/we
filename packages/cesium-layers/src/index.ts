/**
 * @we/cesium-layers
 *
 * Modular layer system for CesiumJS globe
 */

// Export layer types
export type {
  CesiumLayer,
  LayerFactory,
  LayerConfig,
  LayerContext,
  LayerEventBus,
  LayerStore,
  LayerMetadata,
  CameraState,
} from './types';

// Export planet layers (surface layers)
export {
  userLocationsLayer,
  countryOutlinesLayer,
  h3HexagonsLayer,
  spaceLocationsLayer,
  agentLocationsLayer,
} from './planet';
export type {
  UserLocation,
  UserLocationsOptions,
  CountryOutlinesOptions,
  H3HexagonsOptions,
  SpaceLocationsOptions,
  AgentLocationsOptions,
} from './planet';

// Export background layers (space layers)
export { skyboxLayer, proceduralStarsLayer, solarSystemLayer } from './background';
export type { SkyboxLayerOptions, ProceduralStarsLayerOptions, SolarSystemLayerOptions } from './background';
