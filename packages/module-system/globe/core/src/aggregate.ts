/**
 * Rows grouped into places — an H3 cell, a country — and reduced to one number per place.
 *
 * The number is what a style reads as `data.value`, so the default heat rule over it works the same
 * for a hexbin of posts as for countries coloured by members.
 */
import { cellToBoundary, cellToLatLng, latLngToCell } from 'h3-js';

import type { LonLat } from './geo';
import { isLonLat } from './geo';
import type { Aggregate, AggregateOptions, PositionPaths } from './options';
import type { Row } from './rows';
import { readNumber, readText } from './rows';

export interface Group {
  key: string;
  rows: Row[];
  count: number;
  /** The aggregate: the count, or the sum, mean, least or greatest of the `value` field. */
  value: number;
}

/** Reduce each group's rows to its number. A row without a numeric `value` is counted but not summed. */
export function reduce(groups: Map<string, Row[]>, options: AggregateOptions): Group[] {
  const aggregate: Aggregate = options.aggregate ?? 'count';
  const out: Group[] = [];
  for (const [key, rows] of groups) {
    const numbers =
      aggregate === 'count'
        ? []
        : rows.map((row) => readNumber(row, options.value)).filter((n): n is number => n !== undefined);
    let value = rows.length;
    if (aggregate === 'sum') value = numbers.reduce((total, n) => total + n, 0);
    else if (aggregate === 'mean')
      value = numbers.length ? numbers.reduce((total, n) => total + n, 0) / numbers.length : 0;
    else if (aggregate === 'min') value = numbers.length ? Math.min(...numbers) : 0;
    else if (aggregate === 'max') value = numbers.length ? Math.max(...numbers) : 0;
    out.push({ key, rows, count: rows.length, value });
  }
  return out;
}

/** Rows grouped by the field that names their place, ignoring case. Rows naming none are left out. */
export function groupByKey(rows: readonly Row[], keyPath: string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = readText(row, keyPath)?.trim().toLowerCase();
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/** The highest resolution offered: a cell a few city blocks across. Finer only multiplies cells. */
export const MAX_HEX_RESOLUTION = 10;

export function hexResolution(resolution: number | undefined): number {
  const value = Math.round(Number(resolution ?? 4));
  return Number.isFinite(value) ? Math.min(MAX_HEX_RESOLUTION, Math.max(0, value)) : 4;
}

/** Rows grouped by the H3 cell they fall in. Rows with no place are left out. */
export function groupByCell(rows: readonly Row[], paths: PositionPaths, resolution: number): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const latitude = readNumber(row, paths.latitude ?? 'latitude');
    const longitude = readNumber(row, paths.longitude ?? 'longitude');
    if (!isLonLat(longitude, latitude)) continue;
    const cell = latLngToCell(latitude!, longitude!, resolution);
    const group = groups.get(cell);
    if (group) group.push(row);
    else groups.set(cell, [row]);
  }
  return groups;
}

/** A cell's outline as [longitude, latitude] pairs, and its centre. */
export function cellShape(cell: string): { boundary: LonLat[]; center: LonLat } {
  const boundary = cellToBoundary(cell, true) as [number, number][];
  const [lat, lon] = cellToLatLng(cell);
  return { boundary, center: [lon, lat] };
}
