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
 * How far a target's edge is from its centre, per axis — for a target that is a **box**.
 *
 * A single radius was the old answer and it is only right for a round node. A card is a rectangle,
 * and half its largest dimension — which is what a node's `size` is — describes a circle drawn
 * around it: fine on the long side, well outside the shape on the short one. Narrow a wide card and
 * every arrow pointing at it stopped where the old width used to be, leaving a gap the length of the
 * change that no amount of re-reading closed, because the geometry was doing exactly what it was
 * told.
 *
 * A plain number still means a circle, and that distinction is load-bearing rather than a
 * convenience: on a 45° approach a circle of radius r is r away and a square of half-extent r is
 * r√2. Passing a round node's radius as a box would push every diagonal arrow 40% too far out.
 */
export interface EdgeClearance {
  halfWidth: number;
  halfHeight: number;
}

/** Half-extents on each axis. A circle's are equal, which is all the axis-aligned cases need. */
function clearanceOf(clearance: number | EdgeClearance): EdgeClearance {
  return typeof clearance === 'number' ? { halfWidth: clearance, halfHeight: clearance } : clearance;
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
 * How far to slide an axis-aligned route sideways, and where that puts an endpoint.
 *
 * A step separates its two legs by crossing at different places, which does nothing for the segments
 * running into the nodes: those sit at the centre line at both ends, so the two edges are the same
 * line exactly where they are easiest to look at. Straight edges do not have the problem because the
 * whole line moves, which is also why their gap looks bigger for the same offset.
 *
 * So the attachment moves along the node's face instead — a lane, in the flow-chart sense. Because
 * the shift is along a fixed axis rather than a perpendicular derived from the edge's direction, it
 * is immune to the reversal that made fanning fail before, without needing any canonicalising.
 *
 * Clamped to the node it lands on, so a lane never slides off the face of a small node. With no
 * clearance given there is no node to fall off, and the full half-offset applies.
 */
function laneWidth(offset: number, clearance: number | EdgeClearance, horizontal: boolean): number {
  const half = offset / 2;
  // The lane slides *along* the face, so the face it slides along is the one to clamp to: an edge
  // arriving horizontally lands on a vertical side, whose length is the node's height.
  const { halfWidth, halfHeight } = clearanceOf(clearance);
  const face = horizontal ? halfHeight : halfWidth;
  if (face <= 0) return half;
  return Math.sign(half) * Math.min(Math.abs(half), face * 0.5);
}

function shiftLane(point: Point, lane: number, horizontal: boolean): Point {
  return horizontal ? { x: point.x, y: point.y + lane } : { x: point.x + lane, y: point.y };
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
function attachPoint(
  from: Point,
  to: Point,
  curve: EdgeCurve,
  clearance: number | EdgeClearance,
  horizontal: boolean,
): Point {
  const { halfWidth, halfHeight } = clearanceOf(clearance);
  if (halfWidth <= 0 && halfHeight <= 0) return to;
  if (curve === 'smooth' || curve === 'step') {
    // The axis it arrives on is the axis to measure: a curve arriving horizontally meets the left or
    // right side, and how tall the node happens to be says nothing about where that side is.
    return horizontal
      ? { x: to.x - Math.sign(to.x - from.x || 1) * halfWidth, y: to.y }
      : { x: to.x, y: to.y - Math.sign(to.y - from.y || 1) * halfHeight };
  }
  // A number is a round node, so the chord meets it at a constant distance; a box is met wherever
  // the ray crosses it, which depends on the direction.
  return typeof clearance === 'number' ? trimToRadius(from, to, clearance) : trimToBox(from, to, halfWidth, halfHeight);
}

/**
 * Trim a straight chord to where it crosses the target's box.
 *
 * The ray-box intersection, which for equal half-extents is exactly a circle — so this replaces
 * {@link trimToRadius} for routing without changing anything about a round node. The chord is what a
 * straight or arced edge travels along, so it is the direction that decides which side it meets.
 */
function trimToBox(from: Point, to: Point, halfWidth: number, halfHeight: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return to;
  // Distance from the centre to the box along this direction: whichever side the ray reaches first.
  const reach = Math.min(
    Math.abs(dx) > 1e-6 ? (halfWidth * length) / Math.abs(dx) : Infinity,
    Math.abs(dy) > 1e-6 ? (halfHeight * length) / Math.abs(dy) : Infinity,
  );
  if (!Number.isFinite(reach) || length <= reach) return to;
  const ratio = (length - reach) / length;
  return { x: from.x + dx * ratio, y: from.y + dy * ratio };
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
  clearance: number | EdgeClearance = 0,
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
    // Two separations, at right angles to each other so they compose rather than compete: the lane
    // holds the approach segments apart, and the crossing holds the segment between them apart.
    const lane = laneWidth(offset, clearance, horizontal);
    const start = shiftLane(from, lane, horizontal);
    const finish = shiftLane(end, lane, horizontal);
    const crossing = horizontal ? (start.x + finish.x) / 2 + offset / 2 : (start.y + finish.y) / 2 + offset / 2;
    const elbows: Point[] = horizontal
      ? [
          { x: crossing, y: start.y },
          { x: crossing, y: finish.y },
        ]
      : [
          { x: start.x, y: crossing },
          { x: finish.x, y: crossing },
        ];
    // The middle of the crossing segment, which is the one long enough to carry a label.
    return {
      id,
      from: start,
      to: finish,
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
    /*
      Separated by lane, not by bowing the controls apart.

      Displacing only the control points left both ends meeting at the same place, so a mutual pair
      bulged apart in the middle and converged where it mattered. Moving the whole curve gives two
      parallel S-curves — the same thing `straight` does, and legible for the same reason.
    */
    const lane = laneWidth(offset, clearance, horizontal);
    const start = shiftLane(from, lane, horizontal);
    const finish = shiftLane(end, lane, horizontal);
    const reach = (horizontal ? finish.x - start.x : finish.y - start.y) / 2;
    const control = horizontal ? { x: start.x + reach, y: start.y } : { x: start.x, y: start.y + reach };
    const control2 = horizontal ? { x: finish.x - reach, y: finish.y } : { x: finish.x, y: finish.y - reach };
    return {
      id,
      from: start,
      to: finish,
      control,
      control2,
      curve,
      // A cubic's midpoint is the average of its endpoints and three times each control, not the
      // average of its endpoints — the same trap the quadratic case documents below.
      mid: {
        x: (start.x + 3 * control.x + 3 * control2.x + finish.x) / 8,
        y: (start.y + 3 * control.y + 3 * control2.y + finish.y) / 8,
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
