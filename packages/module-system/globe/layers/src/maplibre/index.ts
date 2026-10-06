/**
 * `@we/globe-layers/maplibre`: the kinds MapLibre draws, for a globe on the light engine.
 *
 * Each is the same kind as on Cesium — the same id, slot and options, from `../meta` — with a
 * MapLibre renderer. A separate entry so a MapLibre build never imports Cesium. What MapLibre does not
 * draw is simply not here: the space around the earth (skybox, stars, the solar system) and the bare
 * H3 grid, which a template on this engine finds absent rather than broken — listed with no renderer, so
 * the globe says so once.
 */
import type { AreasOptions, HexbinOptions, PathsOptions, PointsOptions } from '@we/globe-core';

import {
  AREAS,
  COUNTRY_OUTLINES,
  H3_GRID,
  HEXBIN,
  PATHS,
  POINT_LOCATIONS,
  POINTS,
  PROCEDURAL_STARS,
  SKYBOX,
  SOLAR_SYSTEM,
} from '../meta';
import type { CountryOutlinesOptions } from '../planet/country-outlines';
import { asPointsOptions, type PointLocationsOptions } from '../planet/point-locations/options';
import type { LayerKind, LayerKinds, LayerRenderer } from '../types';
import { renderOutlines } from './outlines';
import { renderPaths } from './paths';
import { renderPoints } from './points';
import { renderAreas, renderHexbin } from './polygons';

export const pointsLayer: LayerKind<PointsOptions> = { ...POINTS, renderers: { maplibre: renderPoints } };
export const pathsLayer: LayerKind<PathsOptions> = { ...PATHS, renderers: { maplibre: renderPaths } };
export const areasLayer: LayerKind<AreasOptions> = { ...AREAS, renderers: { maplibre: renderAreas } };
export const hexbinLayer: LayerKind<HexbinOptions> = { ...HEXBIN, renderers: { maplibre: renderHexbin } };

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
    pointLocationsLayer,
    countryOutlinesLayer,
    ...[SKYBOX, PROCEDURAL_STARS, SOLAR_SYSTEM, H3_GRID].map((meaning): LayerKind => ({ ...meaning, renderers: {} })),
  ].map((kind) => [kind.id, kind]),
);
