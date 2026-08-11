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
  return 'smooth';
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

/**
 * A unit perpendicular that does not depend on which way the edge is traversed.
 *
 * This is what makes fanning work at all. Taking the perpendicular of the edge's own direction gives
 * opposite normals for the two legs of a mutual pair, and the offsets handed to them are already
 * opposite — so the two sign flips cancel and the pair stacks exactly on top of each other. Bowing
 * mutual edges apart had therefore never actually worked in any shape, despite being the stated
 * reason `arc` was the default: what looked like two curves was one curve drawn twice.
 *
 * Pinning the normal to a half-plane fixes it geometrically rather than by asking callers to
 * compensate, so `routeEdge(a, b, +n)` and `routeEdge(b, a, -n)` separate on their own.
 */
function canonicalNormal(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const flip = ny < 0 || (ny === 0 && nx < 0);
  return flip ? { x: -nx, y: -ny } : { x: nx, y: ny };
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
/**
 * Where an edge meets its target.
 *
 * The route decides this, because the route is what knows how it arrives. Trimming along the straight
 * line between two centres is right for a shape that *travels* along it, and wrong for one that does
 * not: a smooth curve arrives horizontally and a step arrives at a right angle, so meeting the node
 * on the chord put the arrowhead somewhere the line was never pointing. On screen that reads as an
 * arrow aimed at a corner, sliding around the node's rim as it moves, and it gets worse the further
 * the curve is from straight.
 *
 * Axis-aligned shapes therefore attach on the side they approach from, which is also why the
 * attachment jumps from a side to an underside as a node crosses the diagonal: that is the same
 * moment the curve itself changes which axis it travels along. One visible change rather than two
 * disagreeing ones.
 */
function attachPoint(from: Point, to: Point, curve: EdgeCurve, clearance: number, horizontal: boolean): Point {
  if (clearance <= 0) return to;
  if (curve === 'smooth' || curve === 'step') {
    return horizontal
      ? { x: to.x - Math.sign(to.x - from.x || 1) * clearance, y: to.y }
      : { x: to.x, y: to.y - Math.sign(to.y - from.y || 1) * clearance };
  }
  return trimToRadius(from, to, clearance);
}

/**
 * Route one edge.
 *
 * `clearance` is how far short of the target's centre to stop, so an arrowhead lands on the node
 * rather than inside it. It is applied here rather than by the caller because where an edge lands
 * depends on the shape it is drawn with — see `attachPoint`.
 */
export function routeEdge(
  id: string,
  from: Point,
  to: Point,
  curve: EdgeCurve,
  offset = 0,
  clearance = 0,
): EdgeGeometry {
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
  // Computed from the centres, then held: deriving it again from the attachment point would let a
  // short edge flip axis purely because the clearance shortened it.
  const end = attachPoint(from, to, curve, clearance, horizontal);

  if (curve === 'step') {
    // Parallel steps cross at different places rather than tracing each other exactly. Half the
    // offset, so the separation matches what a bow of the same offset achieves — a quadratic's
    // midpoint deviates half its control distance, not all of it.
    const crossing = horizontal ? (from.x + end.x) / 2 + offset / 2 : (from.y + end.y) / 2 + offset / 2;
    const elbows: Point[] = horizontal
      ? [
          { x: crossing, y: from.y },
          { x: crossing, y: end.y },
        ]
      : [
          { x: from.x, y: crossing },
          { x: end.x, y: crossing },
        ];
    // The middle of the crossing segment, which is the one long enough to carry a label.
    return {
      id,
      from,
      to: end,
      elbows,
      curve,
      mid: { x: (elbows[0].x + elbows[1].x) / 2, y: (elbows[0].y + elbows[1].y) / 2 },
    };
  }

  if (curve === 'smooth') {
    // Tangents held along the dominant axis for half the span: enough to read as a direction of
    // travel, not so much that the curve loops back on itself when the two nodes are close.
    // Signed, so an edge running right-to-left departs leftwards. Taking the magnitude put both
    // control points behind the source and looped the curve back on itself, which only ever showed on
    // edges pointing the other way.
    const reach = (horizontal ? end.x - from.x : end.y - from.y) / 2;
    const perpendicular = horizontal ? { x: 0, y: offset } : { x: offset, y: 0 };
    const control = horizontal
      ? { x: from.x + reach, y: from.y + perpendicular.y }
      : { x: from.x + perpendicular.x, y: from.y + reach };
    const control2 = horizontal
      ? { x: end.x - reach, y: end.y + perpendicular.y }
      : { x: end.x + perpendicular.x, y: end.y - reach };
    return {
      id,
      from,
      to: end,
      control,
      control2,
      curve,
      // A cubic's midpoint is the average of its endpoints and three times each control, not the
      // average of its endpoints — the same trap the quadratic case documents below.
      mid: {
        x: (from.x + 3 * control.x + 3 * control2.x + end.x) / 8,
        y: (from.y + 3 * control.y + 3 * control2.y + end.y) / 8,
      },
    };
  }

  if (curve === 'straight') {
    if (!offset) return { id, from, to: end, curve, mid: { x: (from.x + end.x) / 2, y: (from.y + end.y) / 2 } };
    /*
      Parallel, not bowed.

      Asking for straight edges and getting curved ones for the mutual pairs is the wrong trade: the
      author picked a shape, and separating relationships does not require abandoning it. Shifting the
      whole line sideways keeps both — two straight lines, visibly two. Half the offset for the same
      reason as the step above.
    */
    const normal = canonicalNormal(from, end);
    const shift = offset / 2;
    const nx = normal.x * shift;
    const ny = normal.y * shift;
    const a = { x: from.x + nx, y: from.y + ny };
    const b = { x: end.x + nx, y: end.y + ny };
    return { id, from: a, to: b, curve, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  const length = Math.hypot(end.x - from.x, end.y - from.y) || 1;
  // Perpendicular to the segment, and canonically oriented so the bow is symmetrical whichever way
  // the edge runs — see `canonicalNormal`.
  const normal = canonicalNormal(from, end);
  const bow = offset || Math.min(length * 0.12, 40);
  const control = {
    x: (from.x + end.x) / 2 + normal.x * bow,
    y: (from.y + end.y) / 2 + normal.y * bow,
  };
  return {
    id,
    from,
    to: end,
    control,
    curve: 'arc',
    // A quadratic's midpoint is the average of its endpoints and twice its control, not the average
    // of its endpoints — putting a label at the latter leaves it off the line it belongs to.
    mid: { x: (from.x + 2 * control.x + end.x) / 4, y: (from.y + 2 * control.y + end.y) / 4 },
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
