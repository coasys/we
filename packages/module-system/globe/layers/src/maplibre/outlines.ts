/**
 * `countryOutlinesLayer` on MapLibre: the countries' borders as lines, from the same file the Cesium
 * renderer reads, which the app serves so they draw offline.
 */
import { outlinesUrl } from '../planet/countries';
import type { CountryOutlinesOptions } from '../planet/country-outlines';
import type { MapLibreRendererContext } from '../types';

export function renderOutlines(context: MapLibreRendererContext, options: CountryOutlinesOptions): void {
  const { map, id, onCleanup } = context;
  const { color = '#ffffff', opacity = 0.5, width = 2 } = options;
  map.addSource(id, { type: 'geojson', data: outlinesUrl(options.dataUrl) });
  map.addLayer({
    id: `${id}:outlines`,
    type: 'line',
    source: id,
    paint: { 'line-color': color, 'line-opacity': opacity, 'line-width': width },
  });
  onCleanup(() => {
    if (map.getLayer(`${id}:outlines`)) map.removeLayer(`${id}:outlines`);
    if (map.getSource(id)) map.removeSource(id);
  });
}
