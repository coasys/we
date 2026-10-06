/**
 * The kinds the MapLibre globe draws — its own entry, so a host on the light engine loads MapLibre's
 * renderers and never Cesium's. See `./layers` for the Cesium registry, and `./engine` for which a
 * globe uses.
 */
export { maplibreLayerKinds } from '@we/globe-layers/maplibre';
