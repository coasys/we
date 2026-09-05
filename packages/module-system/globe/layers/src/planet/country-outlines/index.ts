import { Cartesian3, Color } from 'cesium';

import type { LayerContext, LayerFactory } from '../../types';

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

/**
 * Where the country boundaries come from — a **tagged release**, not a branch.
 *
 * This was `.../natural-earth-vector/master/...`, which is a third party's moving branch: every
 * globe in every deployment fetched whatever was at the tip of somebody else's repository at page
 * load, unpinned and unverified, and a change there changed what WE drew with nothing to notice it.
 * Natural Earth publishes versioned tags precisely so a consumer does not have to do that.
 *
 * Move it forward deliberately, and look at what changed when you do — these are national borders,
 * and which lines are drawn where is not a detail to inherit silently from upstream.
 */
export const COUNTRY_OUTLINES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson';

export const countryOutlinesLayer: LayerFactory<CountryOutlinesOptions> = (options?: CountryOutlinesOptions) => ({
  name: 'country-outlines',

  metadata: {
    requiresIonAccount: false,
    description: 'Country boundaries from Natural Earth 50m data. Good balance of detail and performance.',
  },

  onMount: async (context: LayerContext) => {
    const { viewer, events, onCleanup } = context;
    const { color = '#ffffff', opacity = 0.5, width = 2, dataUrl = COUNTRY_OUTLINES_URL } = options || {};

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

  onUnmount: () => {
    // Cleanup handled by onCleanup callbacks
  },
});
