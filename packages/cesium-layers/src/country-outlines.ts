import { Color, GeoJsonDataSource } from 'cesium';

import type { LayerFactory } from './types';

export interface CountryOutlinesOptions {
  /** Outline color (CSS color string) */
  color?: string;
  /** Outline opacity (0-1) */
  opacity?: number;
  /** Line width in pixels */
  width?: number;
  /** GeoJSON URL for country boundaries (defaults to Natural Earth 110m) */
  dataUrl?: string;
}

/**
 * Country Outlines Layer
 *
 * Displays country boundaries on the globe using GeoJSON data.
 * By default uses Natural Earth 110m country boundaries from CDN.
 *
 * Note: For high-resolution boundaries, consider using Cesium ion's World Borders
 * or vector tile services which provide level-of-detail streaming.
 */

export const countryOutlinesLayer: LayerFactory<CountryOutlinesOptions> = (options?: CountryOutlinesOptions) => ({
  name: 'country-outlines',

  onMount: async (context: any) => {
    const { viewer, events, onCleanup } = context;
    const {
      color = '#ffffff',
      opacity = 0.5,
      width = 2,
      dataUrl = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
    } = options || {};

    let dataSource: GeoJsonDataSource | null = null;
    let cancelled = false;

    // Register cleanup
    onCleanup(() => {
      cancelled = true;
      if (dataSource && viewer.dataSources.contains(dataSource)) {
        viewer.dataSources.remove(dataSource, true);
      }
    });

    try {
      // Simple approach: just load it
      dataSource = await GeoJsonDataSource.load(dataUrl, {
        stroke: Color.fromCssColorString(color).withAlpha(opacity),
        fill: Color.TRANSPARENT,
        strokeWidth: width,
      });

      if (cancelled) {
        return;
      }

      await viewer.dataSources.add(dataSource);

      events.emit('country-outlines-loaded', { dataSource });
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
