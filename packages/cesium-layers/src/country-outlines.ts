import { Cartesian3, Color } from 'cesium';

import type { LayerContext, LayerFactory } from './types';

export interface CountryOutlinesOptions {
  /** Outline color (CSS color string) */
  color?: string;
  /** Outline opacity (0-1) */
  opacity?: number;
  /** Line width in pixels */
  width?: number;
  /** GeoJSON URL for country boundaries (defaults to Natural Earth 50m balanced) */
  dataUrl?: string;
}

/**
 * Country Outlines Layer
 *
 * Displays country boundaries on the globe using GeoJSON data.
 * Uses Natural Earth 50m data by default - good balance of detail and performance.
 * Renders borders using Entity API for simplicity and reliability.
 */

export const countryOutlinesLayer: LayerFactory<CountryOutlinesOptions> = (options?: CountryOutlinesOptions) => ({
  name: 'country-outlines',

  onMount: async (context: LayerContext) => {
    const { viewer, events, onCleanup } = context;
    const {
      color = '#ffffff',
      opacity = 0.5,
      width = 2,
      dataUrl = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson',
    } = options || {};

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

  onUnmount: () => {
    // Cleanup handled by onCleanup callbacks
  },
});
