/**
 * `areasLayer` and `hexbinLayer` on MapLibre: filled shapes, flat or raised, with borders.
 *
 * A flat shape is a fill and a raised one a fill-extrusion, each its own layer filtered by height.
 * MapLibre will not let each extruded shape choose its own opacity, so the solids share one: the
 * layer's highest. Borders are drawn on flat shapes, as lines.
 */
import {
  type AreaFeature,
  areaFeatures,
  type AreaIndex,
  type AreasOptions,
  type HexbinOptions,
  type HexFeature,
  hexFeatures,
  loadAreas,
  type Polygon,
} from '@we/globe-core';

import { countriesUrl } from '../planet/countries';
import type { LayerRenderer, MapLibreRendererContext } from '../types';
import { addSource, continuous, maplibreColors, pickFeatures } from './shared';

interface Shape {
  id: string;
  polygons: Polygon[];
  color: string;
  opacity: number;
  height: number;
  borderColor?: string;
  borderWidth: number;
}

/** A mount's fills, solids and borders, drawn from shapes. */
function shapeLayers(context: MapLibreRendererContext, repaint: () => void) {
  const { map, id } = context;
  const fills = `${id}:fills`;
  const solids = `${id}:solids`;
  const borders = `${id}:borders`;
  const source = addSource(context, [
    {
      id: fills,
      type: 'fill',
      source: id,
      filter: ['==', ['get', 'height'], 0],
      paint: { 'fill-color': ['get', 'color'] },
    },
    {
      id: solids,
      type: 'fill-extrusion',
      source: id,
      filter: ['>', ['get', 'height'], 0],
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-opacity': 0.9,
      },
    },
    {
      id: borders,
      type: 'line',
      source: id,
      filter: ['all', ['>', ['get', 'borderWidth'], 0], ['==', ['get', 'height'], 0]],
      paint: { 'line-color': ['get', 'borderColor'], 'line-width': ['get', 'borderWidth'] },
    },
  ]);
  const colors = maplibreColors(context, repaint);
  return {
    layers: [fills, solids],
    draw(shapes: Shape[]) {
      const raised = shapes.filter((shape) => shape.height > 0);
      if (raised.length && map.getLayer(solids)) {
        map.setPaintProperty(solids, 'fill-extrusion-opacity', Math.max(...raised.map((shape) => shape.opacity)));
      }
      source.set(
        shapes.map((shape) => ({
          type: 'Feature',
          geometry: {
            type: 'MultiPolygon',
            coordinates: shape.polygons.map((polygon) => polygon.map((ring) => continuous(ring))),
          },
          properties: {
            id: shape.id,
            // A solid takes the layer's opacity; a flat fill carries its own in its colour.
            color: colors.color(shape.color, shape.height > 0 ? 1 : shape.opacity),
            height: shape.height,
            borderColor: shape.borderColor ? colors.color(shape.borderColor) : 'rgba(0, 0, 0, 0)',
            borderWidth: shape.borderColor ? shape.borderWidth : 0,
          },
        })),
      );
    },
  };
}

export async function renderAreas(
  context: MapLibreRendererContext,
  initial: AreasOptions,
): Promise<LayerRenderer<AreasOptions>> {
  let options = initial;
  let byId = new Map<string, AreaFeature>();
  let countries: AreaIndex | undefined;
  let disposed = false;
  context.onCleanup(() => (disposed = true));
  const shapes = shapeLayers(context, () => void update(options));

  const update = async (next: AreasOptions) => {
    options = next;
    if (next.area === 'countries' && !countries) {
      try {
        countries = await loadAreas(countriesUrl());
      } catch (error) {
        console.error('[areas] The countries could not be loaded:', error);
      }
      if (disposed) return;
    }
    const features = areaFeatures(options, countries);
    byId = new Map(features.map((f) => [f.id, f]));
    shapes.draw(features);
  };

  pickFeatures(
    context,
    { shapes: shapes.layers },
    {
      select(feature) {
        const area = byId.get(feature);
        if (area) options.onSelect?.(area.selected);
      },
    },
  );

  await update(initial);
  return { update };
}

export function renderHexbin(context: MapLibreRendererContext, initial: HexbinOptions): LayerRenderer<HexbinOptions> {
  let options = initial;
  let byId = new Map<string, HexFeature>();
  const shapes = shapeLayers(context, () => update(options));

  const update = (next: HexbinOptions) => {
    options = next;
    const features = hexFeatures(next);
    byId = new Map(features.map((f) => [f.id, f]));
    shapes.draw(features.map((cell) => ({ ...cell, polygons: [[cell.boundary]], borderWidth: 0 })));
  };

  pickFeatures(
    context,
    { shapes: shapes.layers },
    {
      select(feature) {
        const cell = byId.get(feature);
        if (!cell) return;
        const { rows, count, value } = cell.group;
        options.onSelect?.({ cell: cell.cell, rows, count, value });
      },
    },
  );

  update(initial);
  return { update };
}
