/**
 * Rows turned into features: what a renderer draws, already placed and styled.
 *
 * This is the whole of a data kind except the drawing. A renderer receives features and their diff,
 * and its only job is to turn each into its engine's primitive — a Cesium point, a deck.gl row — and
 * a colour string into its engine's colour (see {@link ColorResolver}). So both engines draw the same
 * rows the same way, and a second engine is four thin renderers rather than four reimplementations.
 */
import type { FieldRef, GraphNode, GraphValue, StyleRules, StyleValue } from '@we/graph-protocol';

import type { Group } from './aggregate';
import { cellShape, groupByCell, groupByKey, hexResolution, reduce } from './aggregate';
import type { AreaIndex, Polygon } from './areas';
import { findArea, polygonsOf } from './areas';
import type { LonLat } from './geo';
import { distance, isLonLat } from './geo';
import type {
  AreasOptions,
  AreaStyle,
  HexbinOptions,
  HexbinStyle,
  PathsOptions,
  PathStyle,
  PointsOptions,
  PointStyle,
} from './options';
import type { Row } from './rows';
import { readNumber, readPath, readText, rowId, subjectOf } from './rows';
import { StyleResolver } from './style';
import type { TimeSlice } from './time';

/** What every feature carries: its identity, what it was made from, and the subject its style read. */
export interface FeatureBase {
  id: string;
  subject: GraphNode;
}

export interface PointFeature extends FeatureBase {
  row: Row;
  position: LonLat;
  label?: string;
  image?: string;
  /** CSS, as the style rules resolved it. */
  color: string;
  size: number;
  opacity: number;
  borderColor: string;
  borderWidth: number;
  labelColor?: string;
}

export interface PathFeature extends FeatureBase {
  row: Row;
  /** The line as drawn on the ground; an arc is raised from it by `arcHeight`. */
  positions: LonLat[];
  color: string;
  width: number;
  opacity: number;
  arcHeight: number;
  dashed: boolean;
}

export interface AreaFeature extends FeatureBase {
  polygons: Polygon[];
  /** The row for a drawn area, or the group for a named one. */
  selected: unknown;
  color: string;
  opacity: number;
  borderColor?: string;
  borderWidth: number;
  height: number;
}

export interface HexFeature extends FeatureBase {
  cell: string;
  boundary: LonLat[];
  center: LonLat;
  group: Group;
  color: string;
  opacity: number;
  height: number;
}

/**
 * The first rule of a grouping kind, under whatever rules the template gives: each place shaded by
 * its value, green for the least to red for the most, blended through yellow. First rather than in
 * place of them, so a template that only sets an opacity or a height keeps the shading — it was
 * replaced outright, which left such a layer with no colour at all.
 *
 * Not the graph's named `heat` scale. That steps along the primary ramp, which a dark theme turns
 * around, so the most came out near-white there and the least deep purple — right on a page, where
 * brightest is what stands out, and wrong over satellite imagery, which keeps its colours whatever the
 * theme. The middle of the success and danger ramps holds its place when the ramp turns, so this
 * reads the same way round in both, and still takes the theme's own green and red.
 */
export const GLOBE_HEAT = { from: 'success-500', to: 'danger-500' } as const;

const DEFAULT_HEAT: StyleRules<{ color?: StyleValue<string> }> = [
  { style: { color: { metric: 'field', options: { from: 'value' }, scale: GLOBE_HEAT } } },
];

function isFieldRef(value: unknown): value is FieldRef<string> {
  return typeof value === 'object' && value !== null && 'from' in value;
}

/** A string read off a rule — a literal, or a field of the subject. */
function resolveString(value: StyleValue<string> | undefined, subject: GraphNode): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (!isFieldRef(value)) return undefined;
  const key = value.from.startsWith('data.') ? value.from.slice(5) : value.from;
  const read = value.from.startsWith('data.')
    ? subject.data?.[key]
    : (subject as unknown as Record<string, unknown>)[key];
  return typeof read === 'string' && read ? read : value.fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Rows with an id each, the first of any two sharing one kept and the other reported. */
function identified(
  rows: readonly Row[] | undefined,
  idPath: string | undefined,
  kind: string,
): { id: string; row: Row }[] {
  const seen = new Set<string>();
  const out: { id: string; row: Row }[] = [];
  let duplicates = 0;
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const id = rowId(row, index, idPath);
    if (seen.has(id)) {
      duplicates++;
      return;
    }
    seen.add(id);
    out.push({ id, row });
  });
  if (duplicates) console.warn(`[globe] ${kind}: ${duplicates} rows share an id with another and were left out.`);
  return out;
}

/**
 * The rows to draw: the slice's when a clock has narrowed them, the layer's own otherwise. See
 * `./time` — a slice is null whenever every row shows.
 */
function rowsOf(data: readonly Row[] | undefined, slice: TimeSlice | null | undefined): readonly Row[] {
  if (slice) return slice.rows;
  return Array.isArray(data) ? data : [];
}

/** What time adds to a row's subject: its age in days, for a rule to read as `data.age`. */
function timeExtra(row: Row, slice: TimeSlice | null | undefined): Record<string, GraphValue> {
  const age = slice?.age(row);
  return age === undefined ? {} : { age: Math.round(age * 1000) / 1000 };
}

// ── points ──────────────────────────────────────────────────────────────────

export function pointFeatures(options: PointsOptions, slice?: TimeSlice | null): PointFeature[] {
  const placed = identified(rowsOf(options.data, slice), options.id, 'pointsLayer').flatMap(({ id, row }) => {
    const latitude = readNumber(row, options.latitude ?? 'latitude');
    const longitude = readNumber(row, options.longitude ?? 'longitude');
    if (!isLonLat(longitude, latitude)) return [];
    const label = options.label === '' ? undefined : readText(row, options.label ?? 'name');
    return [
      {
        id,
        row,
        position: [longitude!, latitude!] as LonLat,
        label,
        subject: subjectOf(id, 'point', row, timeExtra(row, slice), label),
      },
    ];
  });
  const styles = new StyleResolver<PointStyle>(
    placed.map((p) => p.subject),
    options.style,
  );
  return placed.map(({ id, row, position, label, subject }) => {
    const style = styles.style(subject);
    const borderColor = styles.color(style.borderColor, subject, 'white');
    return {
      id,
      row,
      subject,
      position,
      label,
      image: resolveString(style.image, subject),
      color: styles.color(style.color, subject, 'primary-500'),
      size: Math.max(1, styles.number(style.size, subject, 12)),
      opacity: clamp01(styles.number(style.opacity, subject, 1)) * (slice?.fade(row) ?? 1),
      borderColor,
      borderWidth: Math.max(0, styles.number(style.borderWidth, subject, 2)),
      labelColor: style.labelColor !== undefined ? styles.color(style.labelColor, subject, 'white') : undefined,
    };
  });
}

// ── paths ───────────────────────────────────────────────────────────────────

function readLine(row: Row, options: PathsOptions): LonLat[] | undefined {
  if (options.coordinates) {
    const value = readPath(row, options.coordinates);
    if (!Array.isArray(value)) return undefined;
    const line = value
      .filter((p): p is [number, number] => Array.isArray(p) && isLonLat(p[0], p[1]))
      .map((p) => [p[0], p[1]] as const);
    return line.length >= 2 ? line : undefined;
  }
  const from = options.from ?? {};
  const to = options.to ?? {};
  const a = [readNumber(row, from.longitude ?? 'from.longitude'), readNumber(row, from.latitude ?? 'from.latitude')];
  const b = [readNumber(row, to.longitude ?? 'to.longitude'), readNumber(row, to.latitude ?? 'to.latitude')];
  if (!isLonLat(a[0], a[1]) || !isLonLat(b[0], b[1])) return undefined;
  return [a as unknown as LonLat, b as unknown as LonLat];
}

/** Length of a line in kilometres, which a rule can read as `data.length`. */
function lengthOf(line: LonLat[]): number {
  let metres = 0;
  for (let i = 1; i < line.length; i++) metres += distance(line[i - 1], line[i]);
  return Math.round(metres / 100) / 10;
}

export function pathFeatures(options: PathsOptions, slice?: TimeSlice | null): PathFeature[] {
  const placed = identified(rowsOf(options.data, slice), options.id, 'pathsLayer').flatMap(({ id, row }) => {
    const positions = readLine(row, options);
    if (!positions) return [];
    const extra = { length: lengthOf(positions), ...timeExtra(row, slice) };
    return [{ id, row, positions, subject: subjectOf(id, 'path', row, extra) }];
  });
  const styles = new StyleResolver<PathStyle>(
    placed.map((p) => p.subject),
    options.style,
  );
  return placed.map(({ id, row, positions, subject }) => {
    const style = styles.style(subject);
    return {
      id,
      row,
      subject,
      positions,
      color: styles.color(style.color, subject, 'primary-500'),
      width: Math.max(0.5, styles.number(style.width, subject, 2)),
      opacity: clamp01(styles.number(style.opacity, subject, 1)) * (slice?.fade(row) ?? 1),
      arcHeight: Math.min(2, Math.max(0, styles.number(style.arcHeight, subject, 0))),
      dashed: style.dashed === true,
    };
  });
}

// ── areas ───────────────────────────────────────────────────────────────────

/** What a group of rows contributes to its subject: its numbers, and the row's own fields when it is one. */
function groupData(group: Group, extra: Record<string, GraphValue>): { row: Row; extra: Record<string, GraphValue> } {
  return {
    row: group.rows.length === 1 ? group.rows[0] : {},
    extra: { ...extra, count: group.count, value: group.value },
  };
}

/**
 * Areas from rows. With `geometry`, one area per row, drawn from its own shape. With `area`, the rows
 * are grouped by the area they name and each named area drawn once — so "members per country" is a
 * list of members, not a list of countries somebody had to count first.
 */
export function areaFeatures(options: AreasOptions, areas?: AreaIndex, slice?: TimeSlice | null): AreaFeature[] {
  type Placed = { id: string; polygons: Polygon[]; subject: GraphNode; selected: unknown; fade: number };
  let placed: Placed[];
  if (options.area) {
    if (!areas) return [];
    const match = options.match ?? 'iso_a2';
    const groups = reduce(groupByKey(rowsOf(options.data, slice), options.key ?? 'country'), options);
    placed = groups.flatMap((group) => {
      const area = findArea(areas, match, group.key);
      if (!area) return [];
      const { row, extra } = groupData(group, { key: group.key, name: area.name });
      const id = `${match}:${group.key}`;
      const selected = { key: group.key, name: area.name, rows: group.rows, count: group.count, value: group.value };
      return [
        { id, polygons: area.polygons, subject: subjectOf(id, 'area', row, extra, area.name), selected, fade: 1 },
      ];
    });
  } else {
    const geometryPath = options.geometry ?? 'geometry';
    placed = identified(rowsOf(options.data, slice), options.id, 'areasLayer').flatMap(({ id, row }) => {
      const polygons = polygonsOf(readPath(row, geometryPath));
      if (!polygons.length) return [];
      const subject = subjectOf(id, 'area', row, timeExtra(row, slice));
      return [{ id, polygons, subject, selected: row, fade: slice?.fade(row) ?? 1 }];
    });
  }
  const styles = new StyleResolver<AreaStyle>(
    placed.map((p) => p.subject),
    options.area ? [...DEFAULT_HEAT, ...(options.style ?? [])] : options.style,
  );
  return placed.map(({ id, polygons, subject, selected, fade }) => {
    const style = styles.style(subject);
    return {
      id,
      subject,
      polygons,
      selected,
      color: styles.color(style.color, subject, 'primary-500'),
      opacity: clamp01(styles.number(style.opacity, subject, 0.6)) * fade,
      borderColor: style.borderColor !== undefined ? styles.color(style.borderColor, subject, 'white') : undefined,
      borderWidth: Math.max(0, styles.number(style.borderWidth, subject, style.borderColor !== undefined ? 1 : 0)),
      height: Math.max(0, styles.number(style.height, subject, 0)),
    };
  });
}

// ── hexbins ─────────────────────────────────────────────────────────────────

export function hexFeatures(options: HexbinOptions, slice?: TimeSlice | null): HexFeature[] {
  const resolution = hexResolution(options.resolution);
  const groups = reduce(groupByCell(rowsOf(options.data, slice), options, resolution), options);
  const placed = groups.map((group) => {
    const { row, extra } = groupData(group, { cell: group.key });
    return { group, subject: subjectOf(group.key, 'hexbin', row, extra) };
  });
  const styles = new StyleResolver<HexbinStyle>(
    placed.map((p) => p.subject),
    [...DEFAULT_HEAT, ...(options.style ?? [])],
  );
  return placed.map(({ group, subject }) => {
    const style = styles.style(subject);
    return {
      id: group.key,
      cell: group.key,
      ...cellShape(group.key),
      group,
      subject,
      color: styles.color(style.color, subject, 'primary-500'),
      opacity: clamp01(styles.number(style.opacity, subject, 0.7)),
      height: Math.max(0, styles.number(style.height, subject, 0)),
    };
  });
}
