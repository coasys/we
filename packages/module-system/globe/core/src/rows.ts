/**
 * Rows, as the data kinds take them: plain objects from a query or a store, with the geometry and the
 * fields a style reads somewhere inside each one.
 */
import type { GraphNode, GraphValue } from '@we/graph-protocol';

export type Row = Record<string, unknown>;

/** A value inside a row by dotted path: `location.latitude`, `author.name`. Undefined when absent. */
export function readPath(row: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  let value: unknown = row;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** A finite number from a row, accepting a numeric string as a backend without numeric columns gives. */
export function readNumber(row: unknown, path: string | undefined): number | undefined {
  const value = readPath(row, path);
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
}

/** A non-empty string from a row. */
export function readText(row: unknown, path: string | undefined): string | undefined {
  const value = readPath(row, path);
  return typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : undefined;
}

/**
 * A row's scalars as a flat bag, nested objects by dotted key: what a style rule reads as `data.x` and
 * a `field` metric reads by name. Two levels deep is enough for `location.city`; a row is not a tree.
 */
export function flattenRow(
  row: Row,
  depth = 2,
  prefix = '',
  into: Record<string, GraphValue> = {},
): Record<string, GraphValue> {
  for (const [key, value] of Object.entries(row)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      into[name] = value;
    } else if (depth > 1 && value && typeof value === 'object' && !Array.isArray(value)) {
      flattenRow(value as Row, depth - 1, name, into);
    }
  }
  return into;
}

/**
 * A row as the subject the graph's style resolver reads: `data.x` is the row's field, `type` the
 * layer's kind, `label` what the layer labels it with. One resolver for both, so a rule means the same
 * thing on a card as on a pin.
 */
export function subjectOf(
  id: string,
  type: string,
  row: Row,
  extra: Record<string, GraphValue> = {},
  label?: string,
): GraphNode {
  return { id, kind: 'entity', type, ...(label ? { label } : {}), data: { ...flattenRow(row), ...extra } } as GraphNode;
}

/** The id a row is known by: its own field when it has one, its position otherwise. */
export function rowId(row: Row, index: number, idPath = 'id'): string {
  return readText(row, idPath) ?? String(index);
}
