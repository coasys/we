/**
 * `pointLocationsLayer`: named markers from a fixed row shape, kept for the templates that use it.
 *
 * It is `pointsLayer` with its options spelled the way they were before the data kinds existed —
 * `locations`, `markerSize`, `defaultColor`, `onLocationClick` — translated here into rows and style
 * rules. So it gains everything `pointsLayer` does (updates by diff, primitives rather than entities)
 * and there is one marker renderer rather than two.
 */
import type { PointsOptions } from '@we/globe-core';

import type { CesiumRendererContext, LayerKind, LayerRenderer } from '../../types';
import { renderPoints } from '../points';

export interface UserLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  color?: string;
  /** URL for the avatar image — displayed as a circular pin when provided. */
  avatar?: string;
}

export interface PointLocationsOptions {
  locations: UserLocation[] | string | (() => UserLocation[] | string);
  /** Marker size in pixels. Default 15. */
  markerSize?: number;
  /** Colour of a marker with no `color` of its own. Default "#00ffff". */
  defaultColor?: string;
  /** Called when a marker is pressed, with its location. */
  onLocationClick?: (location: UserLocation) => void;
}

function locationsOf(options: PointLocationsOptions | undefined): UserLocation[] {
  const raw = typeof options?.locations === 'function' ? options.locations() : (options?.locations ?? []);
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as UserLocation[];
    } catch (error) {
      console.error('[point-locations] locations is not JSON:', error);
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

/** The same markers as `pointsLayer` options. */
export function asPointsOptions(options: PointLocationsOptions): PointsOptions {
  return {
    data: locationsOf(options) as unknown as PointsOptions['data'],
    label: 'name',
    style: [
      // role-audit: palette — a pin's colour says which set it belongs to, not what it is for; the
      // default is the one this layer has always documented.
      { style: { size: options.markerSize ?? 15, color: options.defaultColor ?? '#00ffff', borderColor: 'white' } },
      // A field a row does not have leaves the rule above standing, so a location without a colour
      // takes the default and one without an avatar is a dot.
      { style: { color: { from: 'data.color' }, image: { from: 'data.avatar' } } },
    ],
    onSelect: options.onLocationClick as PointsOptions['onSelect'],
  };
}

export const pointLocationsLayer: LayerKind<PointLocationsOptions> = {
  id: 'pointLocationsLayer',
  slot: 'planet',
  description: 'Display named point location markers with labels and click interactions.',
  renderers: {
    cesium: async (context: CesiumRendererContext, options) => {
      const points = await renderPoints(context, asPointsOptions(options));
      return {
        update: (next) => points.update?.(asPointsOptions(next)),
      } satisfies LayerRenderer<PointLocationsOptions>;
    },
  },
};
