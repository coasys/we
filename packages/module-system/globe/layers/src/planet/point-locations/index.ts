/**
 * `pointLocationsLayer`: named markers from a fixed row shape, kept for the templates that use it.
 *
 * It is `pointsLayer` with its options spelled the way they were before the data kinds existed —
 * `locations`, `markerSize`, `defaultColor`, `onLocationClick` — translated here into rows and style
 * rules. So it gains everything `pointsLayer` does (updates by diff, primitives rather than entities)
 * and there is one marker renderer rather than two.
 */
import { POINT_LOCATIONS } from '../../meta';
import type { CesiumRendererContext, LayerKind, LayerRenderer } from '../../types';
import { renderPoints } from '../points';
import { asPointsOptions, type PointLocationsOptions } from './options';

export { asPointsOptions, type PointLocationsOptions, type UserLocation } from './options';

export const pointLocationsLayer: LayerKind<PointLocationsOptions> = {
  ...POINT_LOCATIONS,
  renderers: {
    cesium: async (context: CesiumRendererContext, options) => {
      const points = await renderPoints(context, asPointsOptions(options));
      return {
        update: (next) => points.update?.(asPointsOptions(next)),
      } satisfies LayerRenderer<PointLocationsOptions>;
    },
  },
};
