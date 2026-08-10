/**
 * Edge geometry — paths, and where an edge should actually stop.
 *
 * Small, and worth its own file because both facts here are the difference between a graph that looks
 * drawn and one that looks emitted: an arrowhead buried under the node it points at, and a pair of
 * mutual edges drawn exactly on top of each other, are the two things every first-attempt graph
 * renderer gets wrong.
 */
import type { Point } from '@we/graph-protocol';

/**
 * Trim a segment so it ends at the node's edge rather than its centre.
 *
 * Without this the arrowhead sits under the target node and every edge looks unterminated.
 */
export function trimToRadius(from: Point, to: Point, radius: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= radius || length === 0) return to;
  const ratio = (length - radius) / length;
  return { x: from.x + dx * ratio, y: from.y + dy * ratio };
}

/**
 * The path for one edge.
 *
 * `offset` bows the curve to one side. Two nodes related in both directions produce two edges with
 * the same endpoints; drawn straight they are one line and the graph silently understates itself.
 */
export function edgePath(from: Point, to: Point, curve: 'straight' | 'bezier' | 'orthogonal', offset = 0): string {
  if (from.x === to.x && from.y === to.y) {
    // A self-loop has no direction to bow along, so it gets a fixed teardrop above the node.
    const r = 26;
    return `M ${from.x} ${from.y} C ${from.x - r} ${from.y - r * 1.6}, ${from.x + r} ${from.y - r * 1.6}, ${to.x} ${to.y}`;
  }

  if (curve === 'straight' && !offset) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;

  if (curve === 'orthogonal') {
    const midX = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  // Perpendicular to the segment, so the bow is symmetrical whichever way the edge runs.
  const bow = offset || Math.min(length * 0.12, 40);
  const cx = (from.x + to.x) / 2 + (-dy / length) * bow;
  const cy = (from.y + to.y) / 2 + (dx / length) * bow;
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}

/**
 * How far to bow each edge in a group sharing endpoints.
 *
 * Zero for a lone edge — a single relationship should be a straight-ish line — then alternating out
 * in both directions so a pair splits symmetrically rather than both bending the same way.
 */
export function bowOffsets(count: number, spacing = 26): number[] {
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, index) => {
    const step = Math.ceil((index + 1) / 2);
    return (index % 2 === 0 ? 1 : -1) * step * spacing;
  });
}

/** Group edges by unordered endpoint pair, so mutual and parallel edges can be fanned apart. */
export function groupByEndpoints<T extends { source: string; target: string }>(edges: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const edge of edges) {
    const key = edge.source < edge.target ? `${edge.source}|${edge.target}` : `${edge.target}|${edge.source}`;
    const group = groups.get(key);
    if (group) group.push(edge);
    else groups.set(key, [edge]);
  }
  return groups;
}
