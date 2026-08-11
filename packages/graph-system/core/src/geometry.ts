/**
 * Edge routing and measurement — where an edge runs, and how far a point is from it.
 *
 * This lived in the Solid renderer, which meant the DOM owned edge hit-testing: paths carried
 * `pointer-events: stroke` and the browser decided what you clicked. That broke the invariant the
 * rest of the system holds to — the core owns picking, so behaviours work identically on any surface
 * — and it was the reason a canvas renderer could not have supported clicking an edge at all.
 *
 * What the core produces is *geometry*, not drawing instructions: control points rather than an SVG
 * path string. A renderer turns that into whatever it strokes with, and the core can measure the same
 * curve without knowing anything about either.
 */
import type { EdgeCurve, EdgeGeometry, Point } from '@we/graph-protocol';

/**
 * Canonical curve name for whatever a style asked for.
 *
 * `bezier` and `orthogonal` were the original names, and they described the maths rather than the
 * look — which matters here because these values are hand-written into templates and picked by a model
 * from a description. Normalising in one place means every consumer downstream sees exactly four
 * cases, and the old names keep working without a second code path.
 */
export function normaliseCurve(curve: string | undefined): EdgeCurve {
  if (curve === 'bezier' || curve === 'arc') return 'arc';
  if (curve === 'orthogonal' || curve === 'step') return 'step';
  if (curve === 'straight' || curve === 'smooth') return curve;
  return 'arc';
}

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

/**
 * Route one edge.
 *
 * `offset` bows the curve to one side. Two nodes related in both directions produce two edges with
 * the same endpoints; drawn straight they are one line and the graph silently understates itself.
 */
export function routeEdge(id: string, from: Point, to: Point, curve: EdgeCurve, offset = 0): EdgeGeometry {
  if (from.x === to.x && from.y === to.y) {
    // A self-loop has no direction to bow along, so it gets a fixed teardrop above the node.
    const r = 26;
    return {
      id,
      from,
      to,
      control: { x: from.x, y: from.y - r * 2.2 },
      curve: 'arc',
      mid: { x: from.x, y: from.y - r * 1.1 },
    };
  }

  // Which way a step turns first, and which way a smooth curve leaves, both follow the axis the edge
  // mostly runs along. A hierarchy laid out top-to-bottom wants to depart downwards; the same rule
  // laid out left-to-right wants to depart sideways. Deriving it from the endpoints means neither the
  // layout nor the author has to say so.
  const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);

  if (curve === 'step') {
    const elbows: Point[] = horizontal
      ? [
          { x: (from.x + to.x) / 2, y: from.y },
          { x: (from.x + to.x) / 2, y: to.y },
        ]
      : [
          { x: from.x, y: (from.y + to.y) / 2 },
          { x: to.x, y: (from.y + to.y) / 2 },
        ];
    // The middle of the crossing segment, which is the one long enough to carry a label.
    return {
      id,
      from,
      to,
      elbows,
      curve,
      mid: { x: (elbows[0].x + elbows[1].x) / 2, y: (elbows[0].y + elbows[1].y) / 2 },
    };
  }

  if (curve === 'smooth') {
    // Tangents held along the dominant axis for half the span: enough to read as a direction of
    // travel, not so much that the curve loops back on itself when the two nodes are close.
    const reach = (horizontal ? Math.abs(to.x - from.x) : Math.abs(to.y - from.y)) / 2;
    const perpendicular = horizontal ? { x: 0, y: offset } : { x: offset, y: 0 };
    const control = horizontal
      ? { x: from.x + reach, y: from.y + perpendicular.y }
      : { x: from.x + perpendicular.x, y: from.y + reach };
    const control2 = horizontal
      ? { x: to.x - reach, y: to.y + perpendicular.y }
      : { x: to.x + perpendicular.x, y: to.y - reach };
    return {
      id,
      from,
      to,
      control,
      control2,
      curve,
      // A cubic's midpoint is the average of its endpoints and three times each control, not the
      // average of its endpoints — the same trap the quadratic case documents below.
      mid: {
        x: (from.x + 3 * control.x + 3 * control2.x + to.x) / 8,
        y: (from.y + 3 * control.y + 3 * control2.y + to.y) / 8,
      },
    };
  }

  if (curve === 'straight' && !offset) {
    return { id, from, to, curve, mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } };
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  // Perpendicular to the segment, so the bow is symmetrical whichever way the edge runs.
  const bow = offset || Math.min(length * 0.12, 40);
  const control = {
    x: (from.x + to.x) / 2 + (-dy / length) * bow,
    y: (from.y + to.y) / 2 + (dx / length) * bow,
  };
  return {
    id,
    from,
    to,
    control,
    curve: 'arc',
    // A quadratic's midpoint is the average of its endpoints and twice its control, not the average
    // of its endpoints — putting a label at the latter leaves it off the line it belongs to.
    mid: { x: (from.x + 2 * control.x + to.x) / 4, y: (from.y + 2 * control.y + to.y) / 4 },
  };
}

/** A point on a quadratic bezier at `t`. */
function cubicAt(from: Point, c1: Point, c2: Point, to: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
    y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
  };
}

function quadraticAt(from: Point, control: Point, to: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
    y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
  };
}

/**
 * The route as a polyline.
 *
 * Sampling rather than solving: the exact distance from a point to a quadratic bezier is a quartic
 * root-find, and for picking an edge a few pixels wide it buys nothing over sixteen segments. The
 * same function serves straight and orthogonal routes, which are already polylines.
 */
export function polyline(geometry: EdgeGeometry, samples = 16): Point[] {
  if (geometry.elbows) return [geometry.from, ...geometry.elbows, geometry.to];
  if (!geometry.control) return [geometry.from, geometry.to];
  const { from, to, control, control2 } = geometry;
  if (control2) {
    return Array.from({ length: samples + 1 }, (_, i) => cubicAt(from, control, control2, to, i / samples));
  }
  return Array.from({ length: samples + 1 }, (_, i) => quadraticAt(from, control, to, i / samples));
}

/** Shortest distance from a point to a line segment. */
function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  // Projection of the point onto the segment, clamped to its ends.
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Shortest distance from a point to an edge's route. */
export function distanceToEdge(point: Point, geometry: EdgeGeometry): number {
  const points = polyline(geometry);
  let nearest = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const distance = distanceToSegment(point, points[i - 1], points[i]);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}

/** Axis-aligned bounds of a route, for cheap rejection before measuring. */
export function edgeBounds(geometry: EdgeGeometry): { minX: number; minY: number; maxX: number; maxY: number } {
  const points = polyline(geometry, 8);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}
