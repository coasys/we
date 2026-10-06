/**
 * `@we/globe-layers/maplibre`: the kinds MapLibre draws, for a globe on the light engine.
 *
 * Each is the same kind as on Cesium — the same id, slot and options, from `../meta` — with a
 * MapLibre renderer. A separate entry so a MapLibre build never imports Cesium. What MapLibre does not
 * draw is simply not here: the space around the earth (skybox, stars, the solar system), which a template on this engine finds absent rather than broken — listed with no renderer, so
 * the globe says so once.
 */
import type {
  AreasOptions,
  HeatmapOptions,
  HexbinOptions,
  PathsOptions,
  PointsOptions,
  SatelliteOverlayOptions,
} from '@we/globe-core';

import {
  AREAS,
  COUNTRY_OUTLINES,
  H3_GRID,
  HEATMAP,
  HEXBIN,
  PATHS,
  POINT_LOCATIONS,
  POINTS,
  PROCEDURAL_STARS,
  SATELLITE_OVERLAY,
  SKYBOX,
  SOLAR_SYSTEM,
} from '../meta';
import type { CountryOutlinesOptions } from '../planet/country-outlines';
import type { H3HexagonsOptions } from '../planet/h3-hexagons';
import { asPointsOptions, type PointLocationsOptions } from '../planet/point-locations/options';
import type { LayerKind, LayerKinds, LayerRenderer } from '../types';
import { renderGrid } from './grid';
import { renderHeatmap } from './heatmap';
import { renderOutlines } from './outlines';
import { renderSatelliteOverlay } from './overlay';
import { renderPaths } from './paths';
import { renderPoints } from './points';
import { renderAreas, renderHexbin } from './polygons';

export const pointsLayer: LayerKind<PointsOptions> = { ...POINTS, renderers: { maplibre: renderPoints } };
export const pathsLayer: LayerKind<PathsOptions> = { ...PATHS, renderers: { maplibre: renderPaths } };
export const areasLayer: LayerKind<AreasOptions> = { ...AREAS, renderers: { maplibre: renderAreas } };
export const hexbinLayer: LayerKind<HexbinOptions> = { ...HEXBIN, renderers: { maplibre: renderHexbin } };
export const heatmapLayer: LayerKind<HeatmapOptions> = { ...HEATMAP, renderers: { maplibre: renderHeatmap } };
export const satelliteOverlayLayer: LayerKind<SatelliteOverlayOptions> = {
  ...SATELLITE_OVERLAY,
  renderers: { maplibre: renderSatelliteOverlay },
};

export const pointLocationsLayer: LayerKind<PointLocationsOptions> = {
  ...POINT_LOCATIONS,
  renderers: {
    maplibre: async (context, options) => {
      const points = await renderPoints(context, asPointsOptions(options));
      return {
        update: (next) => points.update?.(asPointsOptions(next)),
      } satisfies LayerRenderer<PointLocationsOptions>;
    },
  },
};

export const h3HexagonsLayer: LayerKind<H3HexagonsOptions> = { ...H3_GRID, renderers: { maplibre: renderGrid } };

export const countryOutlinesLayer: LayerKind<CountryOutlinesOptions> = {
  ...COUNTRY_OUTLINES,
  renderers: { maplibre: renderOutlines },
};

/**
 * The kinds this engine knows, by id: those it draws, and those only Cesium draws, with no renderer
 * here, so a template naming one is told it is not drawn on this engine rather than that it does not
 * exist.
 */
export const maplibreLayerKinds: LayerKinds = Object.fromEntries(
  [
    pointsLayer,
    pathsLayer,
    areasLayer,
    hexbinLayer,
    heatmapLayer,
    satelliteOverlayLayer,
    pointLocationsLayer,
    countryOutlinesLayer,
    h3HexagonsLayer,
    ...[SKYBOX, PROCEDURAL_STARS, SOLAR_SYSTEM].map((meaning): LayerKind => ({ ...meaning, renderers: {} })),
  ].map((kind) => [kind.id, kind]),
);
