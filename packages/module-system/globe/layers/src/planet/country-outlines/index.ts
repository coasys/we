import { permittedDataUrl } from '@we/globe-core';
import { Cartesian3, Color } from 'cesium';

import type {} from '../../env';
import { COUNTRY_OUTLINES } from '../../meta';
import type { CesiumRendererContext, LayerKind } from '../../types';
import { COUNTRY_OUTLINES_URL, outlinesUrl } from '../countries';

export interface CountryOutlinesOptions {
  /** Outline color (CSS color string) */
  color?: string;
  /** Outline opacity (0-1) */
  opacity?: number;
  /** Line width in pixels */
  width?: number;
  /**
   * GeoJSON URL for country boundaries. Defaults to Natural Earth 50m, served by the app itself (see
   * `assets/README.md`), or to the same release on GitHub in a host that does not serve it.
   *
   * Only a URL on the app's own origin is fetched — see {@link permittedDataUrl}.
   */
  dataUrl?: string;
}

/** Only a URL on the app's own origin is fetched; see `permittedDataUrl` in `@we/globe-core`. */
export { permittedDataUrl };

/**
 * Country Outlines Layer
 *
 * Displays country boundaries on the globe using GeoJSON data.
 * Uses Natural Earth 50m data by default - good balance of detail and performance.
 * Renders borders using Entity API for simplicity and reliability.
 */

export { COUNTRY_OUTLINES_URL };

export const countryOutlinesLayer: LayerKind<CountryOutlinesOptions> = {
  ...COUNTRY_OUTLINES,
  renderers: {
    cesium: async (context: CesiumRendererContext, options: CountryOutlinesOptions) => {
      const { viewer, events, onCleanup } = context;
      const { color = '#ffffff', opacity = 0.5, width = 2 } = options;
      const dataUrl = outlinesUrl(options.dataUrl);

      const entities: string[] = [];
      let cancelled = false;

      // Register cleanup first
      onCleanup(() => {
        cancelled = true;
        entities.forEach((id) => {
          try {
            viewer.entities.removeById(id);
          } catch (error) {
            console.warn('[country-outlines] Cleanup error:', error);
          }
        });
      });

      try {
        // Fetch GeoJSON data
        const response = await fetch(dataUrl);
        if (cancelled) return;
        if (!response.ok) throw new Error(`${dataUrl} answered ${response.status}`);

        const geojson = await response.json();
        if (cancelled) return;

        const polylineColor = Color.fromCssColorString(color).withAlpha(opacity);

        // Process features
        const features = geojson.features || [];
        for (const feature of features) {
          if (cancelled) break;

          const geometry = feature.geometry;
          if (!geometry) continue;

          const processCoordinates = (coords: number[][]) => {
            if (coords.length < 2) return;

            try {
              const positions = coords
                .map(([lng, lat]) => {
                  // Validate coordinates
                  if (
                    typeof lng !== 'number' ||
                    typeof lat !== 'number' ||
                    !isFinite(lng) ||
                    !isFinite(lat) ||
                    lng < -180 ||
                    lng > 180 ||
                    lat < -90 ||
                    lat > 90
                  ) {
                    return null;
                  }
                  return Cartesian3.fromDegrees(lng, lat);
                })
                .filter((pos): pos is Cartesian3 => pos !== null);

              // Only add if we have at least 2 valid positions
              if (positions.length >= 2) {
                const entity = viewer.entities.add({
                  polyline: {
                    positions,
                    width,
                    material: polylineColor,
                    // Drape the line on the ellipsoid surface using GroundPolylinePrimitive.
                    // Ground-clamped polylines render in a dedicated surface-decal pass
                    // that is always sorted behind any entity with a positive height,
                    // regardless of entity creation order or depth-buffer precision.
                    clampToGround: true,
                  },
                });
                entities.push(entity.id);
              }
            } catch (error) {
              console.warn('[country-outlines] Error processing coordinates:', error);
            }
          };

          // Handle different geometry types
          if (geometry.type === 'Polygon') {
            geometry.coordinates.forEach((ring: number[][]) => processCoordinates(ring));
          } else if (geometry.type === 'MultiPolygon') {
            geometry.coordinates.forEach((polygon: number[][][]) => {
              polygon.forEach((ring: number[][]) => processCoordinates(ring));
            });
          } else if (geometry.type === 'LineString') {
            processCoordinates(geometry.coordinates);
          } else if (geometry.type === 'MultiLineString') {
            geometry.coordinates.forEach((line: number[][]) => processCoordinates(line));
          }
        }

        if (cancelled) {
          return;
        }

        events.emit('country-outlines-loaded', { count: entities.length });
      } catch (error) {
        if (!cancelled) {
          console.error('[country-outlines] Error loading:', error);
          events.emit('country-outlines-error', { error });
        }
      }
    },
  },
};
