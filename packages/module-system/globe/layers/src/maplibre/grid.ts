/**
 * `h3HexagonsLayer` on MapLibre: the H3 grid around the centre of the view, finer as the camera comes
 * closer, with the cell under the pointer filled and a pressed one held.
 *
 * Which resolutions show, how many rings and how strongly is `@we/globe-core`'s `gridPlan`, shared
 * with Cesium's renderer, so the grid fades from one size of cell to the next the same way on both.
 */
import {
  cellAt,
  cellOutline,
  cellsAround,
  type GridPlan,
  gridPlan,
  primaryResolution,
  viewRadiusMetres,
} from '@we/globe-core';
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl';

import type { H3HexagonsOptions } from '../planet/h3-hexagons';
import type { MapLibreRendererContext } from '../types';
import { addSource, cameraAltitude, continuous } from './shared';

/** A resolution weaker than this is not drawn: it would be invisible, and is hundreds of lines. */
const FAINTEST = 0.03;
/** The share of the way to its new strength a resolution moves each frame, as on Cesium. */
const FADE = 0.22;
const HOVER_FADE = 0.28;

export function renderGrid(context: MapLibreRendererContext, options: H3HexagonsOptions): void {
  const { map, id, events, onCleanup } = context;
  const {
    maxResolution = 8,
    color = '#3388ff',
    opacity = 0.6,
    width = 2,
    hoverColor = '#3388ff',
    hoverOpacity = 0.3,
    onHexagonClick,
  } = options;

  const lines = addSource(context, [
    {
      id: `${id}:cells`,
      type: 'line',
      source: id,
      paint: { 'line-color': color, 'line-width': width, 'line-opacity': ['*', opacity, ['get', 'alpha']] },
    },
  ]);

  // The hovered or pressed cell, filled.
  const fillId = `${id}:fill`;
  map.addSource(fillId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: fillId, type: 'fill', source: fillId, paint: { 'fill-color': hoverColor, 'fill-opacity': 0 } });
  onCleanup(() => {
    if (map.getLayer(fillId)) map.removeLayer(fillId);
    if (map.getSource(fillId)) map.removeSource(fillId);
  });

  /** Each resolution's strength as drawn, easing towards the plan's. */
  const shown = new Map<number, number>();
  let plan: GridPlan[] = [];
  let hovered: string | null = null;
  let selected: string | null = null;
  let fill = 0;
  let fillTarget = 0;
  let frame = 0;

  const planNow = () => {
    const canvas = map.getCanvas();
    const fov = map.getVerticalFieldOfView() * (Math.PI / 180);
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight) || 1;
    return gridPlan(viewRadiusMetres(cameraAltitude(map), fov, aspect), maxResolution);
  };

  const draw = () => {
    const { lng, lat } = map.getCenter();
    const features = plan.flatMap((p) => {
      const alpha = shown.get(p.res) ?? 0;
      if (alpha < FAINTEST) return [];
      return cellsAround([lng, lat], p.res, p.ring).map((cell) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: continuous(cellOutline(cell)) },
        properties: { alpha },
      }));
    });
    lines.set(features);
    const cell = selected ?? hovered;
    const outline = cell ? [continuous(cellOutline(cell))] : [];
    (map.getSource(fillId) as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: outline.length
        ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: outline }, properties: {} }]
        : [],
    });
    if (map.getLayer(fillId)) map.setPaintProperty(fillId, 'fill-opacity', fill);
  };

  /** Eases the resolutions and the fill towards where they are going, a frame at a time, then stops. */
  const step = () => {
    frame = 0;
    let moving = false;
    for (const p of plan) {
      const current = shown.get(p.res) ?? p.alpha;
      const next = Math.abs(p.alpha - current) < 0.005 ? p.alpha : current + (p.alpha - current) * FADE;
      if (next !== p.alpha) moving = true;
      shown.set(p.res, next);
    }
    fill = Math.abs(fillTarget - fill) < 0.005 ? fillTarget : fill + (fillTarget - fill) * HOVER_FADE;
    if (fill !== fillTarget) moving = true;
    draw();
    if (moving) frame = requestAnimationFrame(step);
  };
  const kick = () => {
    if (!frame) frame = requestAnimationFrame(step);
  };

  const onMove = () => {
    plan = planNow();
    kick();
  };
  const cellUnder = (event: MapMouseEvent) =>
    plan.length ? cellAt([event.lngLat.lng, event.lngLat.lat], primaryResolution(plan)) : null;
  const onPointer = (event: MapMouseEvent) => {
    if (selected) return;
    const cell = cellUnder(event);
    if (cell === hovered) return;
    hovered = cell;
    fillTarget = cell ? hoverOpacity : 0;
    kick();
  };
  const onLeave = () => {
    if (selected) return;
    hovered = null;
    fillTarget = 0;
    kick();
  };
  // A press holds a cell, and a second press on it lets it go, as on Cesium.
  const onClick = (event: MapMouseEvent) => {
    const cell = cellUnder(event);
    if (!cell) return;
    if (selected === cell) {
      selected = null;
      hovered = null;
      fillTarget = 0;
    } else {
      selected = cell;
      fillTarget = 0.65;
    }
    kick();
    events.emit('hexagon-clicked', cell);
    onHexagonClick?.(cell);
  };

  map.on('move', onMove);
  map.on('mousemove', onPointer);
  map.on('mouseout', onLeave);
  map.on('click', onClick);
  onCleanup(() => {
    if (frame) cancelAnimationFrame(frame);
    map.off('move', onMove);
    map.off('mousemove', onPointer);
    map.off('mouseout', onLeave);
    map.off('click', onClick);
  });

  plan = planNow();
  for (const p of plan) shown.set(p.res, p.alpha);
  draw();
}
