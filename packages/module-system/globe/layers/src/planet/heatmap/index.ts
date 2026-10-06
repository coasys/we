/**
 * `heatmapLayer` on Cesium: the glow painted into a canvas and draped over the ground.
 *
 * Cesium has no heatmap of its own, so the heat is drawn with `@we/globe-core`'s {@link paintHeat}
 * over the part of the earth in view and a margin beyond it, and laid on the ground as one textured
 * rectangle. A row's spread is measured in screen pixels, as MapLibre's is, so the heat is drawn
 * again when the camera settles somewhere the drawn rectangle does not cover well.
 *
 * ## Repainting without rebuilding
 *
 * The rows change far more often than the view: every few frames while a clock plays. So the
 * rectangle's geometry is built only when the view needs a new one, and the heat is changed by
 * handing its material a new picture. Two canvases are drawn into in turn, because a material reloads
 * its picture when it is handed a different object, and repainting one canvas in place would leave
 * the old heat on screen. A new rectangle is shown only once it has finished building, as the shape
 * layers' batches are, so moving the camera never flashes the heat away.
 */
import {
  DEFAULT_HEAT_RAMP,
  followTime,
  type HeatBounds,
  heatIntensity,
  type HeatmapOptions,
  heatOpacity,
  heatPoints,
  heatRadius,
  paintHeat,
} from '@we/globe-core';
import {
  Cartesian2,
  Cartographic,
  Color,
  EllipsoidSurfaceAppearance,
  GeometryInstance,
  GroundPrimitive,
  Material,
  Math as CesiumMath,
  Rectangle,
  RectangleGeometry,
} from 'cesium';

import { HEATMAP } from '../../meta';
import type { CesiumRendererContext, LayerKind, LayerRenderer } from '../../types';
import { cesiumColors } from '../cesium';

export type { HeatmapOptions };

export const heatmapLayer: LayerKind<HeatmapOptions> = { ...HEATMAP, renderers: { cesium: renderHeatmap } };

/** The longest side of the heat canvas, in pixels: sharp enough on any screen, cheap to repaint. */
const CANVAS_SIZE = 1024;
/** How far past the view the heat is drawn, as a share of the view, so a small pan needs no redraw. */
const MARGIN = 0.35;
const WHOLE_EARTH: HeatBounds = { west: -180, south: -85, east: 180, north: 85 };

/** The ground drawn on, and the ground in view, whose width says how big a screen pixel is there. */
interface Coverage {
  bounds: HeatBounds;
  /** The ground on screen, without the margin. */
  view: HeatBounds;
  /** Degrees of longitude across the screen. */
  viewWidth: number;
}

function coverageNow(context: CesiumRendererContext): Coverage {
  const { viewer } = context;
  const view = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!view) return { bounds: WHOLE_EARTH, view: WHOLE_EARTH, viewWidth: 360 };
  const west = CesiumMath.toDegrees(view.west);
  let east = CesiumMath.toDegrees(view.east);
  if (east <= west) east += 360;
  const south = CesiumMath.toDegrees(view.south);
  const north = CesiumMath.toDegrees(view.north);
  const padX = (east - west) * MARGIN;
  const padY = (north - south) * MARGIN;
  const viewWidth = east - west;
  const inView = { west, south, east, north };
  const latitudes = { south: Math.max(-85, south - padY), north: Math.min(85, north + padY) };
  if (viewWidth + padX * 2 >= 360) return { bounds: { ...WHOLE_EARTH, ...latitudes }, view: inView, viewWidth };
  return { bounds: { west: west - padX, east: east + padX, ...latitudes }, view: inView, viewWidth };
}

/**
 * Screen pixels per degree of arc at the middle of the view, measured by finding the ground under
 * two points either side of it. The view as a whole is no guide: a globe seen whole is magnified at
 * its centre and foreshortened at its rim, so dividing the screen by the degrees in view makes every
 * row's spread half as wide again as asked. Undefined when the middle of the view is not the earth.
 */
function pixelsPerDegree(context: CesiumRendererContext): number | undefined {
  const { viewer } = context;
  const canvas = viewer.scene.canvas;
  const x = canvas.clientWidth / 2;
  const y = canvas.clientHeight / 2;
  const step = 40;
  const ellipsoid = viewer.scene.globe.ellipsoid;
  const a = viewer.camera.pickEllipsoid(new Cartesian2(x - step, y), ellipsoid);
  const b = viewer.camera.pickEllipsoid(new Cartesian2(x + step, y), ellipsoid);
  if (!a || !b) return undefined;
  const one = Cartographic.fromCartesian(a, ellipsoid);
  const two = Cartographic.fromCartesian(b, ellipsoid);
  // The angle between them, as degrees of arc.
  const cos =
    Math.sin(one.latitude) * Math.sin(two.latitude) +
    Math.cos(one.latitude) * Math.cos(two.latitude) * Math.cos(two.longitude - one.longitude);
  const degrees = CesiumMath.toDegrees(Math.acos(Math.min(1, Math.max(-1, cos))));
  return degrees > 0 ? (step * 2) / degrees : undefined;
}

function covers(drawn: HeatBounds, view: HeatBounds): boolean {
  if (drawn.east - drawn.west >= 360) return view.south >= drawn.south && view.north <= drawn.north;
  // The view may be numbered a turn round from the drawing: compare it both ways.
  return [0, 360, -360].some(
    (turn) =>
      view.west + turn >= drawn.west &&
      view.east + turn <= drawn.east &&
      view.south >= drawn.south &&
      view.north <= drawn.north,
  );
}

export function renderHeatmap(context: CesiumRendererContext, initial: HeatmapOptions): LayerRenderer<HeatmapOptions> {
  const { viewer } = context;
  const primitives = viewer.scene.primitives;
  const colors = cesiumColors(context, () => paint());
  const canvases = [document.createElement('canvas'), document.createElement('canvas')];
  let current = 0;
  let options = initial;
  let coverage = coverageNow(context);

  /** What is on screen, and a rectangle for a new view still building. Each has its own material. */
  let shown: { primitive: GroundPrimitive; material: Material } | null = null;
  let pending: { primitive: GroundPrimitive; material: Material } | null = null;

  const build = () => {
    const { west, south, east, north } = coverage.bounds;
    // Across the antimeridian a rectangle's east is less than its west, which Cesium understands.
    const rectangle = Rectangle.fromDegrees(west, south, east > 180 ? east - 360 : east, north);
    const material = Material.fromType('Image', {
      image: canvases[current],
      color: new Color(1, 1, 1, heatOpacity(options)),
    });
    const primitive = primitives.add(
      new GroundPrimitive({
        geometryInstances: new GeometryInstance({
          geometry: new RectangleGeometry({ rectangle, vertexFormat: EllipsoidSurfaceAppearance.VERTEX_FORMAT }),
        }),
        appearance: new EllipsoidSurfaceAppearance({ material, aboveGround: false }),
      }),
    ) as GroundPrimitive;
    if (pending) primitives.remove(pending.primitive);
    pending = { primitive, material };
  };

  /** Swaps a finished rectangle in for the one on screen. */
  const removeSwap = viewer.scene.preRender.addEventListener(() => {
    if (!pending?.primitive.ready) return;
    if (shown) primitives.remove(shown.primitive);
    shown = pending;
    pending = null;
  });

  const time = followTime(context, () => paint(), { minInterval: 100 });

  /** The heat drawn again into the other canvas, for the rows and the ground as they are now. */
  function paint() {
    const canvas = canvases[(current = 1 - current)];
    const { bounds, viewWidth } = coverage;
    const spanX = bounds.east - bounds.west;
    const spanY = bounds.north - bounds.south;
    // As many pixels per degree across as up, at the middle latitude, so a row's disc is round there.
    const stretch = Math.cos(CesiumMath.toRadians((bounds.north + bounds.south) / 2));
    const aspect = (spanX * stretch) / spanY;
    canvas.width = Math.max(1, Math.round(aspect >= 1 ? CANVAS_SIZE : CANVAS_SIZE * aspect));
    canvas.height = Math.max(1, Math.round(aspect >= 1 ? CANVAS_SIZE / aspect : CANVAS_SIZE));
    // A radius in screen pixels, as canvas pixels: how many of each a degree takes up. The canvas is
    // as many pixels to a degree of latitude as to a degree of arc along the ground at its middle.
    const screenPerDegree =
      pixelsPerDegree(context) ?? (viewer.scene.canvas.clientWidth || 1) / Math.max(1e-6, viewWidth);
    const canvasPerDegree = canvas.height / spanY;
    const radius = Math.max(1, (heatRadius(options) * canvasPerDegree) / screenPerDegree);
    const ramp = (options.colors?.length ? options.colors : DEFAULT_HEAT_RAMP).map((color) => {
      const { red, green, blue, alpha } = colors.color(color);
      return [red, green, blue, alpha] as const;
    });
    const points = heatPoints(options, time.slice(options.data, options));
    paintHeat(canvas, points, bounds, radius, heatIntensity(options), ramp);
    const tint = new Color(1, 1, 1, heatOpacity(options));
    for (const entry of [shown, pending]) {
      if (!entry) continue;
      entry.material.uniforms.image = canvas;
      entry.material.uniforms.color = tint;
    }
    viewer.scene.requestRender();
  }

  // Drawn again where the camera settles, if it has gone somewhere the drawn heat does not cover
  // well: outside it, or so much closer that a row's spread would be far too wide there.
  const removeMoveEnd = viewer.camera.moveEnd.addEventListener(() => {
    const next = coverageNow(context);
    if (covers(coverage.bounds, next.view) && next.viewWidth > coverage.viewWidth * 0.5) return;
    coverage = next;
    paint();
    build();
  });

  context.onCleanup(() => {
    removeSwap();
    removeMoveEnd();
    for (const entry of [shown, pending]) if (entry) primitives.remove(entry.primitive);
    viewer.scene.requestRender();
  });

  const update = (next: HeatmapOptions) => {
    options = next;
    paint();
  };

  paint();
  build();
  return { update };
}
