import { Cartesian3, Color } from 'cesium';

import type {} from '../../env';
import type { LayerContext, LayerFactory } from '../../types';

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

/**
 * A `dataUrl` if it may be fetched, or undefined to fall back to the default.
 *
 * Layer options come from the template, and this layer `fetch`es whatever the option says. A template
 * could build `https://attacker.example/?data=…` out of what it reads and have the layer send it —
 * and the Content-Security-Policy cannot stop that, because `connect-src` has to allow any https
 * host: the node's address is chosen at runtime. So the rule is here instead: the app's own origin
 * only, which is where every WE app serves the boundaries anyway. A deployment wanting other borders
 * serves them itself.
 */
export function permittedDataUrl(url: string | undefined, pageOrigin: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, pageOrigin).origin === new URL(pageOrigin).origin ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Country Outlines Layer
 *
 * Displays country boundaries on the globe using GeoJSON data.
 * Uses Natural Earth 50m data by default - good balance of detail and performance.
 * Renders borders using Entity API for simplicity and reliability.
 */

/**
 * Where the country boundaries come from in a host that does not serve them itself — a **tagged
 * release**, not a branch. Every WE app serves a reduced copy of this same file (`assets/`), which is
 * what lets the borders draw offline; this is the fallback.
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
    slot: 'planet',
    requiresIonAccount: false,
    description: 'Country boundaries from Natural Earth 50m data. Good balance of detail and performance.',
  },

  onMount: async (context: LayerContext) => {
    const { viewer, events, onCleanup } = context;
    const served = import.meta.env.WE_GLOBE_LAYER_ASSETS_URL;
    const { color = '#ffffff', opacity = 0.5, width = 2 } = options || {};
    const requested = permittedDataUrl(options?.dataUrl, window.location.href);
    if (options?.dataUrl && !requested) {
      console.warn(
        `[country-outlines] dataUrl ${options.dataUrl} is not on this app's origin, so the default is used.`,
      );
    }
    const dataUrl = requested ?? (served ? `${served}country-outlines.geojson` : COUNTRY_OUTLINES_URL);

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

  onUnmount: () => {
    // Cleanup handled by onCleanup callbacks
  },
});
