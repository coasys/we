/**
 * `@we/globe-core`: everything about drawing a globe that is not drawing.
 *
 * Shared by every engine's renderers, so a kind behaves the same on each: which layers are mounted
 * and when they update, reading geometry from rows, resolving style rules, aggregating, clustering
 * and diffing. A renderer only turns what this produces into its engine's calls.
 */
export { cellShape, groupByCell, groupByKey, hexResolution, MAX_HEX_RESOLUTION, reduce, type Group } from './aggregate';
export {
  findArea,
  indexAreas,
  loadAreas,
  permittedDataUrl,
  polygonsOf,
  type AreaIndex,
  type NamedArea,
  type Polygon,
} from './areas';
export { ClockLink, type FollowedClock, NO_CLOCK } from './clockLink';
export { clusterCellDegrees, ClusterLevels, clusterPoints, type Cluster } from './cluster';
export { clusterMark, clusterRadiusOf, DEFAULT_CLUSTER_RADIUS, type Mark, markOf, marksOf } from './marks';
export { PICTURE_OVERSAMPLE, ringedPicture } from './pictures';
export { createColorResolver, withOpacity, type ColorResolver, type Rgba } from './color';
export { drawingKey, FeatureDiffer, type FeatureDiff } from './diff';
export { EventBus } from './events';
export {
  areaFeatures,
  GLOBE_HEAT,
  hexFeatures,
  pathFeatures,
  pointFeatures,
  type AreaFeature,
  type FeatureBase,
  type HexFeature,
  type PathFeature,
  type PointFeature,
} from './features';
export {
  DEFAULT_HEAT_RAMP,
  type HeatBounds,
  heatColorStops,
  heatIntensity,
  type HeatmapOptions,
  heatOpacity,
  type HeatPoint,
  heatPoints,
  heatRadius,
  paintHeat,
  paletteOf,
} from './heat';
export { cellAt, cellOutline, cellsAround, type GridPlan, gridPlan, primaryResolution, viewRadiusMetres } from './grid';
export { arcPositions, distance, EARTH_RADIUS, isLonLat, type LonLat, type LonLatHeight } from './geo';
export { forwardingHandlers, LayerSet, type LayerSetOptions, optionsEqual } from './layerSet';
export type {
  Aggregate,
  AggregateOptions,
  AreaSet,
  AreaStyle,
  AreasOptions,
  DataLayerOptions,
  HexbinOptions,
  HexbinStyle,
  PathsOptions,
  PathStyle,
  PointsOptions,
  PointStyle,
  PositionPaths,
} from './options';
export {
  OVERLAY_CREDIT,
  OVERLAY_DAY_INTERVAL,
  OVERLAY_PRODUCTS,
  overlayDay,
  overlayOpacity,
  type OverlayProduct,
  overlayProduct,
  overlayUrl,
  type SatelliteOverlayOptions,
} from './overlay';
export { flattenRow, readNumber, readPath, readText, rowId, subjectOf, type Row } from './rows';
export { computeMetrics, StyleResolver } from './style';
export { followTime, TimeIndex, type TimeOptions, type TimeSlice } from './time';
