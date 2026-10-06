/**
 * What the Cesium renderers of the data kinds share: colours, marker altitude and picking. Everything
 * else they share is engine-neutral and lives in `@we/globe-core`.
 */
import { createColorResolver, type Rgba, withOpacity } from '@we/globe-core';
import {
  Cartesian2,
  Color,
  defined,
  type Primitive,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer,
} from 'cesium';

import type { CesiumRendererContext } from '../types';

/**
 * The id a data kind's primitive carries, so a pick can be traced back to its layer and feature.
 * `label` marks a feature's text, which is pressable but is not the feature's shape.
 */
export interface PickId {
  layer: string;
  feature: string;
  label?: boolean;
}

export function isPickId(value: unknown, layer: string): value is PickId {
  return typeof value === 'object' && value !== null && (value as PickId).layer === layer;
}

/** A colour resolver for one mount, with Cesium colours out of it. Disposed with the layer. */
export function cesiumColors(context: CesiumRendererContext) {
  const resolver = createColorResolver(context.viewer.container as HTMLElement);
  context.onCleanup(() => resolver.dispose());
  const toColor = ([r, g, b, a]: Rgba) => new Color(r, g, b, a);
  return {
    /** A style value — a role, a token, CSS — as a Cesium colour, with `opacity` applied. */
    color(value: string | undefined, opacity?: number): Color {
      return toColor(withOpacity(resolver.rgba(value), opacity));
    },
    /** The same as CSS, for a canvas: an avatar's ring is drawn there. */
    css(value: string | undefined): string {
      const [r, g, b, a] = resolver.rgba(value);
      return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
    },
  };
}

/**
 * How far a marker floats above the ground, per zIndex level: a share of the camera's own altitude,
 * between a floor and a ceiling.
 *
 * Some height keeps a marker clear of what is drawn on the surface (borders, hexagons). It used to
 * be a fixed 5 km per level, which is right from orbit and absurd up close: zoom towards a house and
 * the marker stayed 5 km overhead, sliding away across the screen as the camera came down beneath
 * it. Proportional to the camera's height, a marker sits where it belongs at every zoom: still 5 km
 * per level from far out, as before, and a metre or two at street level.
 */
const ALTITUDE_PER_CAMERA_METRE = 0.002;
const MIN_METERS_PER_Z_LEVEL = 1;
const MAX_METERS_PER_Z_LEVEL = 5_000;

export function markerAltitude(viewer: Viewer, zIndex: number | undefined): number {
  const height = viewer.camera.positionCartographic.height;
  const perLevel = Math.min(
    MAX_METERS_PER_Z_LEVEL,
    Math.max(MIN_METERS_PER_Z_LEVEL, height * ALTITUDE_PER_CAMERA_METRE),
  );
  return (zIndex ?? 1) * perLevel;
}

/** Metres one pixel covers at the ground below the camera — what clustering's cell is measured in. */
export function metresPerPixel(viewer: Viewer): number {
  const height = Math.max(1, viewer.camera.positionCartographic.height);
  const fovy = (viewer.camera.frustum as { fovy?: number }).fovy ?? Math.PI / 3;
  return (2 * height * Math.tan(fovy / 2)) / Math.max(1, viewer.scene.canvas.clientHeight);
}

/**
 * One handler for presses and hovers on this layer's primitives. `select` gets the feature id under a
 * press, its label included. `hover` gets the feature whose shape is under the pointer, or null —
 * a label alone is pressable and shows the pointer, but does not count as hovering the feature: the
 * gap between a name and its marker would otherwise end the hover on the way from one to the other,
 * and a marker growing on hover would shrink and grow again as the pointer crossed it.
 */
export function pickFeatures(
  context: CesiumRendererContext,
  handlers: { select(feature: string): void; hover?(feature: string | null): void },
): void {
  const { viewer, id: layer } = context;
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  const at = (position: Cartesian2): PickId | null => {
    // drillPick rather than pick: a marker raised above the ground can sit behind the globe in the
    // pick buffer while drawing in front of it. A shape wins over a label drawn on it, as a cluster's
    // count is.
    const hits = viewer.scene
      .drillPick(position, 5)
      .map((p: { id?: unknown; primitive?: Primitive }) => (defined(p) && isPickId(p.id, layer) ? p.id : null))
      .filter((id: PickId | null): id is PickId => id !== null);
    return hits.find((id: PickId) => !id.label) ?? hits[0] ?? null;
  };
  handler.setInputAction((click: { position: Cartesian2 }) => {
    const hit = at(click.position);
    if (hit) handlers.select(hit.feature);
  }, ScreenSpaceEventType.LEFT_CLICK);
  let pressable = false;
  let hovered: string | null = null;
  handler.setInputAction((move: { endPosition: Cartesian2 }) => {
    const hit = at(move.endPosition);
    if (!!hit !== pressable) {
      pressable = !!hit;
      viewer.scene.canvas.style.cursor = pressable ? 'pointer' : '';
    }
    const shape = hit && !hit.label ? hit.feature : null;
    if (shape === hovered) return;
    hovered = shape;
    handlers.hover?.(shape);
  }, ScreenSpaceEventType.MOUSE_MOVE);
  context.onCleanup(() => {
    handler.destroy();
    viewer.scene.canvas.style.cursor = '';
  });
}
