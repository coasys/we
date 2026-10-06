/**
 * `pathsLayer` on MapLibre: a line per feature, following the earth's curve, and arcing where asked.
 *
 * A flat line is MapLibre's own line layer. A line between two places with an `arcHeight` is raised
 * off the ground by {@link ArcLayer}, a custom layer drawing the same samples Cesium draws, so the
 * two engines draw a route the same way. A route through several places lies on the ground, as on
 * Cesium. Dashed lines are their own layer, since a dash pattern is not something MapLibre lets each
 * feature choose; an arc is drawn solid.
 */
import {
  arcPositions,
  followTime,
  type LonLat,
  type PathFeature,
  pathFeatures,
  type PathsOptions,
} from '@we/globe-core';
import type { LineLayerSpecification, MapMouseEvent } from 'maplibre-gl';

import type { LayerRenderer, MapLibreRendererContext } from '../types';
import { type Arc, ArcLayer } from './arcs';
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

/** Only a line between two places arcs; a route through several is drawn along them. */
const arcs = (feature: PathFeature) => feature.arcHeight > 0 && feature.positions.length === 2;

export function renderPaths(context: MapLibreRendererContext, initial: PathsOptions): LayerRenderer<PathsOptions> {
  const { id, map } = context;
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
  const raised = new ArcLayer(`${id}:arcs`);
  map.addLayer(raised);
  context.onCleanup(() => {
    if (map.getLayer(raised.id)) map.removeLayer(raised.id);
  });

  let options = initial;
  let byId = new Map<string, PathFeature>();
  const colors = maplibreColors(context, () => update(options));
  const time = followTime(context, () => update(options));

  const update = (next: PathsOptions) => {
    options = next;
    const features = pathFeatures(next, time.slice(next.data, next));
    byId = new Map(features.map((f) => [f.id, f]));
    source.set(
      features
        .filter((feature) => !arcs(feature))
        .map((feature) => ({
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
    raised.set(
      features.filter(arcs).map((feature): Arc => ({
        id: feature.id,
        positions: arcPositions(feature.positions[0], feature.positions[1], feature.arcHeight, 64),
        color: colors.channels(feature.color, feature.opacity),
        width: feature.width,
      })),
    );
  };

  const select = (feature: string) => {
    const row = byId.get(feature)?.row;
    if (row) options.onSelect?.(row);
  };
  pickFeatures(context, { shapes: [solid, dashed] }, { select });

  // The raised arcs answer a press themselves, when no flat line is under it; see `ArcLayer`.
  const flatAt = (event: MapMouseEvent) =>
    map.queryRenderedFeatures(event.point, { layers: [solid, dashed].filter((layer) => map.getLayer(layer)) }).length >
    0;
  const onClick = async (event: MapMouseEvent) => {
    if (flatAt(event)) return;
    const hit = await raised.pick(event.point.x, event.point.y);
    if (hit) select(hit);
  };
  let asking = false;
  let pointing = false;
  const onMove = async (event: MapMouseEvent) => {
    if (asking || flatAt(event)) return;
    asking = true;
    const hit = await raised.pick(event.point.x, event.point.y);
    asking = false;
    if (!!hit === pointing) return;
    pointing = !!hit;
    map.getCanvas().style.cursor = pointing ? 'pointer' : '';
  };
  map.on('click', onClick);
  map.on('mousemove', onMove);
  context.onCleanup(() => {
    map.off('click', onClick);
    map.off('mousemove', onMove);
  });

  update(initial);
  return { update };
}
