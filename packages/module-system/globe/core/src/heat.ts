/**
 * `heatmapLayer`: density as a continuous glow rather than as cells.
 *
 * A hexbin answers "how many, here" — cells to count and press and raise. A heatmap answers "where
 * does it gather" at a glance: bright where rows crowd together, fading out around them, with no
 * edges to read as boundaries the data does not have. It gives up exact counts and pressable cells
 * for that, so a template that needs either wants the hexbin.
 *
 * MapLibre draws one natively. Cesium has nothing equivalent, so its renderer draws the glow into a
 * canvas with {@link paintHeat} and drapes it over the ground — which is also why the drawing is here
 * rather than in that renderer: it is plain 2D canvas work, the same on any engine that needs it.
 */
import type { Rgba } from './color';
import type { LonLat } from './geo';
import { isLonLat } from './geo';
import type { PositionPaths } from './options';
import type { Row } from './rows';
import { readNumber } from './rows';
import type { TimeOptions, TimeSlice } from './time';

export interface HeatmapOptions extends PositionPaths, TimeOptions {
  /** The rows. Rows without a place are left out. */
  data?: Row[];
  /** A field whose number is how much each row adds. Absent: each row adds one. */
  weight?: string;
  /** How far one row's heat spreads, in pixels on screen. Default 30. */
  radius?: number;
  /** Multiplies every row's heat: raise it for sparse data, lower it for dense. Default 1. */
  intensity?: number;
  /** 0 to 1. Default 0.8. */
  opacity?: number;
  /**
   * The ramp, coolest to hottest, as roles, tokens or CSS. Default green to amber to red, the theme's
   * own — the same reading as a hexbin's heat, and the same way round in a light and a dark theme.
   */
  colors?: string[];
}

export const DEFAULT_HEAT_RAMP = ['success-500', 'warning-500', 'danger-500'] as const;

/** One row as heat: where it is, and how much it adds. */
export interface HeatPoint {
  position: LonLat;
  weight: number;
}

/** The rows as heat. A negative or unreadable weight adds nothing, and a fading row adds less. */
export function heatPoints(options: HeatmapOptions, slice?: TimeSlice | null): HeatPoint[] {
  const rows = slice ? slice.rows : Array.isArray(options.data) ? options.data : [];
  const out: HeatPoint[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const latitude = readNumber(row, options.latitude ?? 'latitude');
    const longitude = readNumber(row, options.longitude ?? 'longitude');
    if (!isLonLat(longitude, latitude)) continue;
    const weight = options.weight ? (readNumber(row, options.weight) ?? 0) : 1;
    const strength = Math.max(0, weight) * (slice?.fade(row) ?? 1);
    if (strength > 0) out.push({ position: [longitude!, latitude!], weight: strength });
  }
  return out;
}

export function heatRadius(options: HeatmapOptions): number {
  const radius = Number(options.radius ?? 30);
  return Number.isFinite(radius) ? Math.min(200, Math.max(2, radius)) : 30;
}

export function heatIntensity(options: HeatmapOptions): number {
  const intensity = Number(options.intensity ?? 1);
  return Number.isFinite(intensity) && intensity > 0 ? intensity : 1;
}

export function heatOpacity(options: HeatmapOptions): number {
  const opacity = Number(options.opacity ?? 0.8);
  return Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.8;
}

/** Where on the ground a heat canvas lies, in degrees. `east` may pass 180 for one across the antimeridian. */
export interface HeatBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Draws the heat over `bounds` into `canvas`, coloured along `ramp` (coolest first), transparent
 * where there is none. `radius` is in the canvas's own pixels.
 *
 * Two passes, as heatmaps are usually drawn. Each row is a soft black disc whose darkness is its
 * weight, laid over the others, so overlapping rows darken a spot towards full and a lone one stays
 * faint. Then each pixel's darkness picks a colour off the ramp. The ramp starts transparent, so the
 * edge of the glow fades into the imagery rather than stopping at a line.
 */
export function paintHeat(
  canvas: HTMLCanvasElement,
  points: readonly HeatPoint[],
  bounds: HeatBounds,
  radius: number,
  intensity: number,
  ramp: readonly Rgba[],
): void {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  if (!points.length || width < 1 || height < 1) return;

  const spanX = bounds.east - bounds.west;
  const spanY = bounds.north - bounds.south;
  if (spanX <= 0 || spanY <= 0) return;
  // The strongest single row sets full strength, so a weighted layer and a counted one both use the
  // whole ramp; intensity then scales from there.
  const heaviest = Math.max(...points.map((point) => point.weight));
  const stamp = discStamp(radius);
  context.globalCompositeOperation = 'source-over';
  for (const { position, weight } of points) {
    let [lon] = position;
    const [, lat] = position;
    if (lon < bounds.west) lon += 360;
    const x = ((lon - bounds.west) / spanX) * width;
    const y = ((bounds.north - lat) / spanY) * height;
    if (x < -radius || x > width + radius || y < -radius || y > height + radius) continue;
    context.globalAlpha = Math.min(1, (weight / heaviest) * intensity * 0.6);
    context.drawImage(stamp, x - radius, y - radius);
  }
  context.globalAlpha = 1;

  const image = context.getImageData(0, 0, width, height);
  const palette = paletteOf(ramp);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const strength = data[i + 3];
    if (!strength) continue;
    const offset = strength * 4;
    data[i] = palette[offset];
    data[i + 1] = palette[offset + 1];
    data[i + 2] = palette[offset + 2];
    data[i + 3] = palette[offset + 3];
  }
  context.putImageData(image, 0, 0);
}

/** A soft disc, black fading to nothing, drawn once per radius and stamped for every row. */
const stamps = new Map<number, HTMLCanvasElement>();
function discStamp(radius: number): HTMLCanvasElement {
  const size = Math.ceil(radius * 2);
  const cached = stamps.get(size);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.max(1, size);
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(radius, radius, 0, radius, radius, radius);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  stamps.set(size, canvas);
  return canvas;
}

/**
 * 256 colours, one per strength: transparent at nothing, the ramp's first colour by a fifth of full
 * strength, and the ramp's stops spread evenly from there to the top. Bytes, RGBA.
 */
export function paletteOf(ramp: readonly Rgba[]): Uint8ClampedArray {
  const palette = new Uint8ClampedArray(256 * 4);
  const [r, g, b] = ramp[0] ?? [0, 0, 0, 1];
  // Nothing is transparent, in the first colour, so the edge of the glow fades without a dark fringe.
  const stops: { at: number; color: Rgba }[] = [{ at: 0, color: [r, g, b, 0] }];
  const first = 0.2;
  ramp.forEach((color, index) => {
    stops.push({ at: ramp.length > 1 ? first + ((1 - first) * index) / (ramp.length - 1) : 1, color });
  });
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let upper = stops.findIndex((stop) => stop.at >= t);
    if (upper <= 0) upper = Math.max(1, upper);
    const a = stops[upper - 1];
    const b = stops[Math.min(upper, stops.length - 1)];
    const local = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1;
    for (let channel = 0; channel < 4; channel++) {
      palette[i * 4 + channel] = Math.round((a.color[channel] + (b.color[channel] - a.color[channel]) * local) * 255);
    }
  }
  return palette;
}

/**
 * A MapLibre `heatmap-color` expression for the same ramp, so both engines shade a density the same
 * way: transparent at none, the first colour by a fifth, the rest spread to the top.
 */
export function heatColorStops(ramp: readonly string[], none = 'rgba(0, 0, 0, 0)'): (number | string)[] {
  const first = 0.2;
  // `none` is best the first colour made transparent, so the glow's edge has no dark fringe.
  const stops: (number | string)[] = [0, none];
  ramp.forEach((color, index) => {
    stops.push(ramp.length > 1 ? first + ((1 - first) * index) / (ramp.length - 1) : 1, color);
  });
  return stops;
}
