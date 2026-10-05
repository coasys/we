/**
 * The options of the data-shaped kinds, which a template writes and every engine reads.
 *
 * Each kind takes **rows** (`data`: plain objects, usually an expression over a query), **accessors**
 * saying where in a row its geometry is (field paths, dotted for nested fields), and **style rules**
 * in the graph's dialect. Nothing here names an engine: these types are what an author or a model
 * learns, and a second engine reads the same ones.
 */
import type { StyleRules, StyleValue } from '@we/graph-protocol';

import type { Row } from './rows';

/** A latitude and a longitude, as field paths into a row. */
export interface PositionPaths {
  latitude?: string;
  longitude?: string;
}

/** Options every data kind takes. */
export interface DataLayerOptions<TStyle> {
  /** The rows to draw. */
  data?: Row[];
  /** The field naming each row, so an update moves and restyles rather than redraws. Default "id". */
  id?: string;
  /** Style rules, `{ when?, style }`, applied in order, later matches winning per property. */
  style?: StyleRules<TStyle>;
}

/** How rows grouped into one place are reduced to a number, read by a style as `data.value`. */
export type Aggregate = 'count' | 'sum' | 'mean' | 'min' | 'max';

export interface AggregateOptions {
  /** Default "count". */
  aggregate?: Aggregate;
  /** The field summed, averaged or compared. Not needed for "count". */
  value?: string;
}

// ── points ──────────────────────────────────────────────────────────────────

export interface PointStyle {
  /** Diameter in pixels. Default 12. */
  size?: StyleValue<number>;
  color?: StyleValue<string>;
  opacity?: StyleValue<number>;
  /** The ring around a dot or a picture. Default "white". */
  borderColor?: StyleValue<string>;
  /** Default 2. 0 draws none. */
  borderWidth?: StyleValue<number>;
  /** A picture to draw instead of a dot — usually `{ from: "data.avatar" }`. */
  image?: StyleValue<string>;
  labelColor?: StyleValue<string>;
}

export interface PointsOptions extends DataLayerOptions<PointStyle>, PositionPaths {
  /** The field shown beside each marker. Empty for none. */
  label?: string;
  /** Labels show only while the camera is below this altitude, in metres. Absent: always. */
  labelMaxAltitude?: number;
  /** Markers close together on screen draw as one, with a count. `true` for a 60-pixel radius. */
  cluster?: boolean | { radius?: number; color?: string };
  /** Runs when a marker is pressed, with its row. */
  onSelect?: (row: Row) => void;
}

// ── paths ───────────────────────────────────────────────────────────────────

export interface PathStyle {
  /** Line width in pixels. Default 2. */
  width?: StyleValue<number>;
  color?: StyleValue<string>;
  opacity?: StyleValue<number>;
  /**
   * How high the line arcs at its middle, as a share of its own length: 0 lies on the ground, 0.2 is a
   * gentle arc, 0.5 a tall one. A share rather than metres, so a longer line arcs higher and the
   * whole set reads in proportion. Default 0.
   */
  arcHeight?: StyleValue<number>;
  dashed?: boolean;
}

export interface PathsOptions extends DataLayerOptions<PathStyle> {
  /** Where each line starts. Default "from.latitude" / "from.longitude". */
  from?: PositionPaths;
  /** Where each line ends. Default "to.latitude" / "to.longitude". */
  to?: PositionPaths;
  /** Instead of from/to: a field holding the whole line as [longitude, latitude] pairs. */
  coordinates?: string;
  onSelect?: (row: Row) => void;
}

// ── areas ───────────────────────────────────────────────────────────────────

export interface AreaStyle {
  /** The fill. */
  color?: StyleValue<string>;
  /** Default 0.6. */
  opacity?: StyleValue<number>;
  borderColor?: StyleValue<string>;
  /** Default 1. 0 draws none. */
  borderWidth?: StyleValue<number>;
  /** Raised off the ground by this many metres, as a solid. Default 0, flat. */
  height?: StyleValue<number>;
}

/** The shapes an area can be named from rather than drawn: the countries the app serves. */
export type AreaSet = 'countries';

export interface AreasOptions extends DataLayerOptions<AreaStyle>, AggregateOptions {
  /** A field holding each row's shape as GeoJSON (a Polygon or MultiPolygon). */
  geometry?: string;
  /** Instead of `geometry`: a set of shapes the rows name. Rows naming one area are grouped into it. */
  area?: AreaSet;
  /** The field naming a row's area. Default "country". */
  key?: string;
  /** What `key` holds: "iso_a2" (FR), "iso_a3" (FRA) or "name" (France). Default "iso_a2". */
  match?: 'iso_a2' | 'iso_a3' | 'name';
  /** Runs when an area is pressed: the row for `geometry`, `{ key, name, rows, count, value }` for `area`. */
  onSelect?: (selected: unknown) => void;
}

// ── hexbins ─────────────────────────────────────────────────────────────────

export interface HexbinStyle {
  color?: StyleValue<string>;
  /** Default 0.7. */
  opacity?: StyleValue<number>;
  /** Raised off the ground by this many metres, as a column. Default 0, flat. */
  height?: StyleValue<number>;
}

export interface HexbinOptions extends DataLayerOptions<HexbinStyle>, PositionPaths, AggregateOptions {
  /** The H3 resolution, 0 (continents) to 10 (a few city blocks). Default 4, about 22 km across. */
  resolution?: number;
  /** Runs when a cell is pressed, with `{ cell, rows, count, value }`. */
  onSelect?: (selected: { cell: string; rows: Row[]; count: number; value: number }) => void;
}
