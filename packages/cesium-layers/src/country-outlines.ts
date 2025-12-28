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

    try {
      // Load GeoJSON data
      const dataSource = await GeoJsonDataSource.load(dataUrl, {
        stroke: Color.fromCssColorString(color).withAlpha(opacity),
        fill: Color.TRANSPARENT,
        strokeWidth: width,
      });

      // Add to viewer
      await viewer.dataSources.add(dataSource);

      // Emit loaded event
      events.emit('country-outlines-loaded', { dataSource });

      // Register cleanup
      onCleanup(() => {
        viewer.dataSources.remove(dataSource, true);
      });
    } catch (error) {
      console.error('Error loading country outlines:', error);
      events.emit('country-outlines-error', { error });
    }
  },

  onUnmount: (context: any) => {
    // Cleanup is handled by onCleanup callbacks
  },
});
