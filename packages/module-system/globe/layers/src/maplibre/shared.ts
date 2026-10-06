/**
 * What the MapLibre renderers share: colours, scale, label pictures, pressing, and the sources and
 * layers each one adds and must take away again. Everything they share with the Cesium renderers is
 * in `@we/globe-core`.
 */
import { createColorResolver, EARTH_RADIUS, type Rgba, withOpacity } from '@we/globe-core';
import type { Feature } from 'geojson';
import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';

import type { MapLibreRendererContext } from '../types';

/** A colour as MapLibre takes it: CSS, its alpha included. */
const css = ([r, g, b, a]: Rgba) =>
  `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;

/**
 * A colour resolver for one mount, giving CSS MapLibre can paint, under the theme of the map's own
 * element. `repaint` runs when that theme changes: the colours were resolved when the layer drew, and
 * a theme switch changes none of its options.
 */
export function maplibreColors(context: MapLibreRendererContext, repaint: () => void) {
  const resolver = createColorResolver(context.map.getContainer());
  const unsubscribe = resolver.onThemeChange(repaint);
  context.onCleanup(() => {
    unsubscribe();
    resolver.dispose();
  });
  return {
    /** A style value — a role, a token, CSS — with `opacity` applied. */
    color(value: string | undefined, opacity?: number): string {
      return css(withOpacity(resolver.rgba(value), opacity));
    },
  };
}

/** The tile size MapLibre's zoom is measured in. */
const TILE = 512;

/** Metres one pixel covers at the centre of the view — what clustering's radius is measured in. */
export function metresPerPixel(map: MapLibreMap): number {
  const latitude = (map.getCenter().lat * Math.PI) / 180;
  return (2 * Math.PI * EARTH_RADIUS * Math.cos(latitude)) / (TILE * 2 ** map.getZoom());
}

/** How high the camera is above the ground at the centre, in metres, as Cesium measures it. */
export function cameraAltitude(map: MapLibreMap): number {
  const fov = map.getVerticalFieldOfView() * (Math.PI / 180);
  return (metresPerPixel(map) * map.getCanvas().clientHeight) / (2 * Math.tan(fov / 2));
}

/**
 * A GeoJSON source and the layers drawing it, added under this mount's id and removed when it goes.
 * `promoteId` makes each feature's own id its identity, which hover state is keyed by.
 */
export function addSource(context: MapLibreRendererContext, layers: LayerSpecification[]) {
  const { map, id } = context;
  map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
  for (const layer of layers) map.addLayer(layer);
  context.onCleanup(() => {
    for (const layer of layers) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
    if (map.getSource(id)) map.removeSource(id);
  });
  return {
    set(features: Feature[]) {
      (map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
    },
  };
}

/**
 * Pictures added to the map's sprite for one mount, by name, and removed with it. A name already
 * added is not added again.
 */
export function mountImages(context: MapLibreRendererContext) {
  const { map } = context;
  const added = new Set<string>();
  context.onCleanup(() => {
    for (const name of added) if (map.hasImage(name)) map.removeImage(name);
  });
  return {
    has: (name: string) => added.has(name),
    add(name: string, canvas: HTMLCanvasElement, pixelRatio: number) {
      if (added.has(name)) return;
      const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height);
      if (!data) return;
      map.addImage(name, data, { pixelRatio });
      added.add(name);
    },
  };
}

/** Labels are drawn at twice their size, for a sharp edge on a high-density screen. */
export const LABEL_RATIO = 2;

/**
 * A line of text as a picture, white or a given colour with a dark outline, as the Cesium labels are
 * drawn. Pictures rather than MapLibre's own text, which needs a font server and so draws nothing
 * offline; and a globe's labels are a few hundred names, not a road map's thousands.
 */
export function labelPicture(text: string, color: string, bold = false): HTMLCanvasElement {
  const size = 14 * LABEL_RATIO;
  const font = `${bold ? 'bold ' : ''}${bold ? 12 * LABEL_RATIO : size}px sans-serif`;
  const outline = 2 * LABEL_RATIO;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  if (!measure) return canvas;
  measure.font = font;
  canvas.width = Math.ceil(measure.measureText(text).width + outline * 2) || 1;
  canvas.height = Math.ceil(size * 1.3 + outline * 2);
  const context = canvas.getContext('2d')!;
  context.font = font;
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = outline * 2;
  context.strokeStyle = 'rgba(0, 0, 0, 1)';
  context.strokeText(text, outline, canvas.height / 2);
  context.fillStyle = color;
  context.fillText(text, outline, canvas.height / 2);
  return canvas;
}

/**
 * Presses and hovers on this mount's layers. `select` gets the feature id under a press, on a shape
 * or on its label. `hover` gets the feature whose shape is under the pointer: a label is pressable
 * and shows the pointer, but does not count as hovering — the gap between a name and its marker
 * would end the hover on the way from one to the other.
 */
export function pickFeatures(
  context: MapLibreRendererContext,
  layers: { shapes: string[]; labels?: string[] },
  handlers: { select(feature: string): void; hover?(feature: string | null): void },
): void {
  const { map } = context;
  const at = (event: MapMouseEvent): { feature: string; label: boolean } | null => {
    const shapes = layers.shapes.filter((id) => map.getLayer(id));
    const labels = (layers.labels ?? []).filter((id) => map.getLayer(id));
    const shape = shapes.length ? map.queryRenderedFeatures(event.point, { layers: shapes })[0] : undefined;
    if (shape) return { feature: String(shape.properties.id), label: false };
    const label = labels.length ? map.queryRenderedFeatures(event.point, { layers: labels })[0] : undefined;
    return label ? { feature: String(label.properties.id), label: true } : null;
  };
  let pressable = false;
  let hovered: string | null = null;
  const onMove = (event: MapMouseEvent) => {
    const hit = at(event);
    if (!!hit !== pressable) {
      pressable = !!hit;
      map.getCanvas().style.cursor = pressable ? 'pointer' : '';
    }
    const shape = hit && !hit.label ? hit.feature : null;
    if (shape === hovered) return;
    hovered = shape;
    handlers.hover?.(shape);
  };
  const onClick = (event: MapMouseEvent) => {
    const hit = at(event);
    if (hit) handlers.select(hit.feature);
  };
  map.on('mousemove', onMove);
  map.on('click', onClick);
  context.onCleanup(() => {
    map.off('mousemove', onMove);
    map.off('click', onClick);
    if (pressable) map.getCanvas().style.cursor = '';
  });
}

/**
 * Longitudes made continuous along a line, so one crossing the antimeridian goes the short way rather
 * than round the world.
 */
export function continuous(positions: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = [];
  let shift = 0;
  positions.forEach(([lon, lat], index) => {
    if (index > 0) {
      const previous = positions[index - 1][0];
      if (lon - previous > 180) shift -= 360;
      else if (previous - lon > 180) shift += 360;
    }
    out.push([lon + shift, lat]);
  });
  return out;
}
