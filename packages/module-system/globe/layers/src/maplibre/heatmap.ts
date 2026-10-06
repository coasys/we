/**
 * `heatmapLayer` on MapLibre: its own heatmap layer, which draws exactly this.
 *
 * Shaded along the same ramp as on Cesium (`@we/globe-core`'s {@link heatColorStops}), with each
 * row's weight as a property so a fading row adds less, and the spread in screen pixels.
 */
import {
  DEFAULT_HEAT_RAMP,
  followTime,
  heatColorStops,
  heatIntensity,
  type HeatmapOptions,
  heatOpacity,
  heatPoints,
  heatRadius,
} from '@we/globe-core';
import type { ExpressionSpecification } from 'maplibre-gl';

import type { LayerRenderer, MapLibreRendererContext } from '../types';
import { addSource, maplibreColors } from './shared';

export function renderHeatmap(
  context: MapLibreRendererContext,
  initial: HeatmapOptions,
): LayerRenderer<HeatmapOptions> {
  const { map, id } = context;
  const layer = `${id}:heat`;
  const source = addSource(context, [
    { id: layer, type: 'heatmap', source: id, paint: { 'heatmap-weight': ['get', 'weight'] } },
  ]);
  let options = initial;
  const colors = maplibreColors(context, () => paintStyle());
  const time = followTime(context, () => draw());

  /** The ramp, spread, strength and opacity, which change with the options and the theme. */
  function paintStyle() {
    if (!map.getLayer(layer)) return;
    const ramp = (options.colors?.length ? options.colors : [...DEFAULT_HEAT_RAMP]).map((color) => colors.color(color));
    const none = colors.color(options.colors?.[0] ?? DEFAULT_HEAT_RAMP[0], 0);
    map.setPaintProperty(layer, 'heatmap-color', [
      'interpolate',
      ['linear'],
      ['heatmap-density'],
      ...heatColorStops(ramp, none),
    ] as ExpressionSpecification);
    map.setPaintProperty(layer, 'heatmap-radius', heatRadius(options));
    map.setPaintProperty(layer, 'heatmap-intensity', heatIntensity(options));
    map.setPaintProperty(layer, 'heatmap-opacity', heatOpacity(options));
  }

  function draw() {
    const points = heatPoints(options, time.slice(options.data, options));
    // Relative to the heaviest row, as on Cesium, so a weighted layer and a counted one both use the
    // whole ramp.
    const heaviest = points.reduce((most, point) => Math.max(most, point.weight), 0) || 1;
    source.set(
      points.map(({ position, weight }, index) => ({
        type: 'Feature',
        id: index,
        geometry: { type: 'Point', coordinates: [position[0], position[1]] },
        properties: { weight: weight / heaviest },
      })),
    );
  }

  const update = (next: HeatmapOptions) => {
    options = next;
    paintStyle();
    draw();
  };

  update(initial);
  return { update };
}
