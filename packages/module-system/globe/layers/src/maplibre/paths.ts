/**
 * `pathsLayer` on MapLibre: a line per feature, following the earth's curve.
 *
 * Drawn flat. MapLibre's lines lie on the ground, so `arcHeight` raises nothing here — the one thing
 * this engine draws differently from Cesium, and said so in the catalogue. Dashed lines are their own
 * layer, since a dash pattern is not something MapLibre lets each feature choose.
 */
import { arcPositions, type LonLat, type PathFeature, pathFeatures, type PathsOptions } from '@we/globe-core';
import type { LineLayerSpecification } from 'maplibre-gl';

import type { LayerRenderer, MapLibreRendererContext } from '../types';
import { addSource, continuous, maplibreColors, pickFeatures } from './shared';

/** The line as drawn: each segment along its great circle, longitudes continuous. */
function line(feature: PathFeature): [number, number][] {
  const out: (readonly [number, number])[] = [];
  for (let i = 1; i < feature.positions.length; i++) {
    const segment = arcPositions(feature.positions[i - 1] as LonLat, feature.positions[i] as LonLat, 0, 24);
    segment.forEach(([lon, lat], index) => {
      if (i === 1 || index > 0) out.push([lon, lat]);
    });
  }
  return continuous(out);
}

export function renderPaths(context: MapLibreRendererContext, initial: PathsOptions): LayerRenderer<PathsOptions> {
  const { id } = context;
  const solid = `${id}:lines`;
  const dashed = `${id}:dashes`;
  const paint: LineLayerSpecification['paint'] = {
    'line-color': ['get', 'color'],
    'line-width': ['get', 'width'],
  };
  const source = addSource(context, [
    { id: solid, type: 'line', source: id, filter: ['!', ['get', 'dashed']], layout: { 'line-cap': 'round' }, paint },
    { id: dashed, type: 'line', source: id, filter: ['get', 'dashed'], paint: { ...paint, 'line-dasharray': [2, 2] } },
  ]);
  let options = initial;
  let byId = new Map<string, PathFeature>();
  const colors = maplibreColors(context, () => update(options));

  const update = (next: PathsOptions) => {
    options = next;
    const features = pathFeatures(next);
    byId = new Map(features.map((f) => [f.id, f]));
    source.set(
      features.map((feature) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: line(feature) },
        properties: {
          id: feature.id,
          color: colors.color(feature.color, feature.opacity),
          width: feature.width,
          dashed: feature.dashed,
        },
      })),
    );
  };

  pickFeatures(
    context,
    { shapes: [solid, dashed] },
    {
      select(feature) {
        const row = byId.get(feature)?.row;
        if (row) options.onSelect?.(row);
      },
    },
  );

  update(initial);
  return { update };
}
