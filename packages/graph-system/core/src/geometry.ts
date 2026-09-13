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
import {
  type CardShape,
  cardSilhouette,
  type EdgeAnchors,
  type EdgeCurve,
  type EdgeGeometry,
  type EdgeSide,
  type Point,
} from '@we/graph-protocol';

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
  /**
   * What the box is cut to, where it is cut to anything — see `CARD_SILHOUETTES`.
   *
   * Without it an edge meets the box, which is the shape a card is cut *out of* rather than the
   * shape anybody sees. That is invisible on a square and on every outline that happens to touch
   * the box where the line arrives — a diamond's vertex, an ellipse's widest point — and 45px of
   * daylight on a triangle's side, which is a quarter of a 180px card.
   */
  shape?: CardShape;
  /**
   * How far *beyond* the outline to stop, in world units.
   *
   * The end an arrowhead points at wants a few pixels so the head lands against the card rather
   * than on it; the end a line leaves wants none. It is held apart from the half-extents rather
   * than added to them because a shape cannot be inflated by adding to its box: a triangle grown
   * that way moves its sides by a different amount than its corners, and the standoff is supposed
   * to be the same distance whichever way the line leaves.
   */
  gap?: number;
}

/**
 * Half-extents on each axis, standoff included. A circle's are equal, which is all the axis-aligned
 * cases need — this answers "how much room does this node take", not "where does a line meet it".
 */
function clearanceOf(clearance: number | EdgeClearance): { halfWidth: number; halfHeight: number } {
  if (typeof clearance === 'number') return { halfWidth: clearance, halfHeight: clearance };
  const gap = clearance.gap ?? 0;
  return { halfWidth: clearance.halfWidth + gap, halfHeight: clearance.halfHeight + gap };
}

/**
 * How far the node reaches along one direction — the distance from its centre to its outline.
 *
 * The one question every attachment asks, whatever decided the direction: an anchor naming a side, a
 * smooth curve's axis, or the chord a straight edge travels. Answering it in one place is what lets
 * all three meet the *shape* rather than two of them meeting a box.
 */
function reachAlong(ux: number, uy: number, clearance: number | EdgeClearance): number {
  if (typeof clearance === 'number') return clearance;
  const { halfWidth, halfHeight, shape } = clearance;
  if (halfWidth <= 0 && halfHeight <= 0) return 0;

  // A round card is the ellipse inscribed in its box — exact by formula, where a polygon of it would
  // be an approximation of something already known.
  if (shape === 'round') {
    const rx = halfWidth > 0 ? ux / halfWidth : Infinity;
    const ry = halfHeight > 0 ? uy / halfHeight : Infinity;
    const d = Math.hypot(rx, ry);
    return d > 0 ? 1 / d : 0;
  }

  const outline = cardSilhouette(shape);
  if (outline) {
    const reach = polygonReach(ux, uy, outline, halfWidth, halfHeight);
    // A ray from the centre of a closed outline always leaves it; the fallback is for a table that
    // somehow did not contain its own centre, where a box is a better answer than none.
    if (Number.isFinite(reach)) return reach;
  }
  return boxReach(ux, uy, halfWidth, halfHeight);
}

/** Where a ray from the centre crosses the box: whichever side it reaches first. */
function boxReach(ux: number, uy: number, halfWidth: number, halfHeight: number): number {
  return Math.min(
    Math.abs(ux) > 1e-6 ? Math.abs(halfWidth / ux) : Infinity,
    Math.abs(uy) > 1e-6 ? Math.abs(halfHeight / uy) : Infinity,
  );
}

/**
 * Where a ray from the centre crosses an outline given in fractions of the box.
 *
 * The points are clockwise from the top in the same 0..1 space the clip path uses, so the table is
 * read identically by the thing that draws the shape and the thing that attaches to it.
 */
function polygonReach(
  ux: number,
  uy: number,
  outline: readonly (readonly [number, number])[],
  halfWidth: number,
  halfHeight: number,
): number {
  let nearest = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const [ax, ay] = outline[i];
    const [bx, by] = outline[(i + 1) % outline.length];
    // Fractions of the box, centred: (0.5, 0.5) is the middle, which is where the ray starts.
    const px = (ax - 0.5) * halfWidth * 2;
    const py = (ay - 0.5) * halfHeight * 2;
    const ex = (bx - ax) * halfWidth * 2;
    const ey = (by - ay) * halfHeight * 2;
    const denominator = ux * ey - uy * ex;
    if (Math.abs(denominator) < 1e-9) continue; // Parallel to this side.
    const along = (px * ey - py * ex) / denominator;
    const across = (px * uy - py * ux) / denominator;
    if (along > 0 && across >= 0 && across <= 1) nearest = Math.min(nearest, along);
  }
  return nearest;
}

/** Which way a side faces, as a unit vector out of the node. See {@link EdgeSide}. */
const OUTWARD: Record<EdgeSide, readonly [number, number]> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};

/**
 * The anchors an edge is carrying in its data bag, if any.
 *
 * Read by those names rather than under a `canvas`-ish prefix, for the reason the `manual` layout
 * reads `x`/`y` by theirs: an anchor is a fact about a graph edge and not about canvases, so anything
 * that knows which side a connection should leave from can say so and the engine will honour it.
 * The canvas seed is simply the first thing that does.
 *
 * Anything that is not one of the four sides is dropped rather than passed on. A stored value can be
 * whatever a peer wrote — this is a shared, writable data layer — and a bad one reaching the router
 * would land the edge at `NaN`, which draws nothing and reports nothing.
 */
export function anchorsOf(data: Record<string, unknown> | undefined): EdgeAnchors {
  const side = (value: unknown): EdgeSide | undefined =>
    value === 'n' || value === 'e' || value === 's' || value === 'w' ? value : undefined;
  return { source: side(data?.sourceAnchor), target: side(data?.targetAnchor) };
}

/**
 * Where one end of an edge routes to, honouring an overlay that has taken hold of it.
 *
 * Two reserved shapes in an edge overlay, and this is the only place that knows them: `source` and
 * `target` name a different node — a re-attachment being previewed — and `sourceX`/`sourceY`,
 * `targetX`/`targetY` hold a bare point, which is what a dragged end follows so it moves with the
 * pointer rather than jumping between a card's four sides.
 *
 * Here rather than inline in the router because two things need the answer and they must not be able
 * to disagree: the router draws the line, and the renderer places the grips along it. A copy of the
 * rule in the renderer is exactly what left the waypoint handles frozen at the old endpoints while
 * the line they belong to moved.
 */
export function endOf(
  patch: Record<string, unknown> | undefined,
  end: 'source' | 'target',
  stored: string,
): { node: string; loose: Point | null } {
  const name = patch?.[end];
  const x = patch?.[`${end}X`];
  const y = patch?.[`${end}Y`];
  return {
    node: typeof name === 'string' && name ? name : stored,
    // Both halves, since half a point is not one.
    loose: typeof x === 'number' && typeof y === 'number' ? { x, y } : null,
  };
}

/**
 * The waypoints an edge is carrying, in its own frame — see {@link EdgeWaypoint}.
 *
 * Stored as JSON on the record and passed through the data bag as the same string: a bag holds
 * scalars, and parsing at the seed only to re-serialise for the router would be the same work twice.
 *
 * Every kind of malformed input answers with no waypoints rather than throwing. This is a shared,
 * writable, peer-to-peer data layer: the blob is whatever the last writer wrote, possibly by an
 * older version of this code or by something that is not this code at all, and a route that threw on
 * one bad record would take the whole canvas's rendering down with it.
 */
export function waypointsOf(data: Record<string, unknown> | undefined): EdgeWaypoint[] {
  const raw = data?.waypoints;
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const point = entry as { along?: unknown; across?: unknown };
      return Number.isFinite(point?.along) && Number.isFinite(point?.across)
        ? [{ along: Number(point.along), across: Number(point.across) }]
        : [];
    });
  } catch {
    return [];
  }
}

/**
 * Whether two data bags describe the same route — both anchors and every waypoint.
 *
 * What an optimistic edit is *finished* by. A host draws a change before the write comes back, and
 * letting go too early puts the old shape back for a round trip while too late shows something that
 * was never stored — so the question has to be "does the stored data already route the same", not
 * "are the fields spelled the same". They differ: clearing an anchor writes `''` and the seed answers
 * by omitting the field, so a literal compare could never settle a clear.
 *
 * Both halves, and that is the point rather than tidiness. The first version asked only about
 * anchors, so a waypoint patch compared equal to the data it was standing in front of, the draft was
 * dropped on the frame after it was set, and dragging a point did visibly nothing at all. A draft
 * that says something the data does not is unsettled, whichever field it says it in.
 */
export function routesAlike(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  const anchorsA = anchorsOf(a);
  const anchorsB = anchorsOf(b);
  if (anchorsA.source !== anchorsB.source || anchorsA.target !== anchorsB.target) return false;
  // Serialised rather than walked: the list is ordered and short, and a hand-written deep compare is
  // one more thing to keep in step with the shape of a point.
  return JSON.stringify(waypointsOf(a)) === JSON.stringify(waypointsOf(b));
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
 * Which way one end of a smooth curve sets off, as a unit vector.
 *
 * Anchored, it is the way that side faces — the curve leaves the north side upwards. Unanchored, it
 * is the dominant axis signed by which way the edge runs, which is what the tangents were computed
 * from before anchors existed and is why an edge with neither end pinned is routed identically.
 *
 * `arriving` flips it, because the second control point is measured *back* from the target: an edge
 * arriving at a west side approaches from the west, so its tangent points that way out of the node.
 */
function departure(
  from: Point,
  to: Point,
  horizontal: boolean,
  side: EdgeSide | undefined,
  arriving: boolean,
): readonly [number, number] {
  if (side) return OUTWARD[side];
  const sign = Math.sign((horizontal ? to.x - from.x : to.y - from.y) || 1) * (arriving ? -1 : 1);
  return horizontal ? [sign, 0] : [0, sign];
}

/**
 * A waypoint, stored in the edge's **own** frame rather than in the world.
 *
 * `along` runs from the source (0) to the target (1); `across` is perpendicular, in the same units,
 * so a bend keeps its proportions. This is the whole difference between a route that survives
 * somebody tidying a canvas and one that becomes litter: in world coordinates, moving either card
 * leaves the line doglegging through empty space, and the first rearrangement turns every hand-drawn
 * route into a mess nobody chose. Both ends move here and the shape follows them.
 *
 * The length of the source→target span scales *both* axes, on purpose. Scaling only `along` would
 * keep a bend's sideways reach fixed, so pulling two cards apart would flatten the curve out of it.
 */
export interface EdgeWaypoint {
  along: number;
  across: number;
}

/** Where a waypoint sits on screen, given where its two nodes are now. */
export function waypointToWorld(point: EdgeWaypoint, from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  return {
    x: from.x + ux * point.along * length - uy * point.across * length,
    y: from.y + uy * point.along * length + ux * point.across * length,
  };
}

/** The inverse — what to store for a point somebody dropped at a place on screen. */
export function waypointFromWorld(at: Point, from: Point, to: Point): EdgeWaypoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const px = at.x - from.x;
  const py = at.y - from.y;
  return { along: (px * ux + py * uy) / length, across: (-px * uy + py * ux) / length };
}

/**
 * A smooth curve through every point, as a chain of cubics — Catmull-Rom, converted to Bézier.
 *
 * Interpolating rather than approximating: the curve passes *through* each waypoint, which is the
 * only behaviour that makes sense for a point somebody placed. A B-spline would be smoother and
 * would miss every one of them, so the handle and the line would not be in the same place.
 *
 * The tangent at each point is a sixth of the span between its neighbours, the standard uniform
 * Catmull-Rom conversion. Ends duplicate their neighbour, which makes the first and last segments
 * leave and arrive straight at the nodes rather than overshooting to guess a tangent that is not
 * there.
 *
 * This is also the shape a per-point handle would edit later: a Catmull-Rom point *is* a cubic
 * control pair derived from its neighbours, so overriding one is a stored tangent taking the place
 * of the derived one, with no second code path and nothing to migrate.
 */
export function splineThrough(points: Point[]): { control: Point; control2: Point; to: Point }[] {
  const segments: { control: Point; control2: Point; to: Point }[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const before = points[index - 1] ?? points[index];
    const start = points[index];
    const finish = points[index + 1];
    const after = points[index + 2] ?? finish;
    segments.push({
      control: { x: start.x + (finish.x - before.x) / 6, y: start.y + (finish.y - before.y) / 6 },
      control2: { x: finish.x - (after.x - start.x) / 6, y: finish.y - (after.y - start.y) / 6 },
      to: finish,
    });
  }
  return segments;
}

/**
 * The same points joined at right angles — one corner per leg, on the axis that leg mostly runs.
 *
 * Deterministic rather than clever: a router that chose corners by looking at what else is on the
 * canvas would move lines nobody touched every time a card did. The point of a waypoint is that the
 * shape is somebody's decision, so the legs between them follow one rule and stay put.
 */
export function orthogonalThrough(points: Point[]): { to: Point }[] {
  const segments: { to: Point }[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const finish = points[index + 1];
    const horizontal = Math.abs(finish.x - start.x) >= Math.abs(finish.y - start.y);
    segments.push({ to: horizontal ? { x: finish.x, y: start.y } : { x: start.x, y: finish.y } }, { to: finish });
  }
  return segments;
}

/** The point half-way along a polyline, by arc length — where a label sits on a bent route. */
function midpointOf(points: Point[]): Point {
  const lengths = points
    .slice(1)
    .map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0) return points[0];
  let walked = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    if (walked + lengths[index] >= total / 2) {
      const t = lengths[index] === 0 ? 0 : (total / 2 - walked) / lengths[index];
      const a = points[index];
      const b = points[index + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += lengths[index];
  }
  return points[points.length - 1];
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
 *
 * `side` is somebody overruling all of that for this end of this edge — an anchor. It wins over
 * every shape, including the two that trim along the chord: an anchored `straight` edge leaves the
 * middle of the side it was told to, which is the point of saying so.
 */
function attachPoint(
  from: Point,
  to: Point,
  curve: EdgeCurve,
  clearance: number | EdgeClearance,
  horizontal: boolean,
  side?: EdgeSide,
): Point {
  const { halfWidth, halfHeight } = clearanceOf(clearance);
  if (halfWidth <= 0 && halfHeight <= 0) return to;
  const gap = typeof clearance === 'number' ? 0 : (clearance.gap ?? 0);
  /** The outline's distance along a direction, plus the standoff — the point, given a direction. */
  const along = (ux: number, uy: number): Point => {
    const reach = reachAlong(ux, uy, clearance) + gap;
    return { x: to.x + ux * reach, y: to.y + uy * reach };
  };

  if (side) {
    const [ax, ay] = OUTWARD[side];
    return along(ax, ay);
  }
  if (curve === 'smooth' || curve === 'step') {
    // The axis it arrives on is the axis to measure: a curve arriving horizontally meets the left or
    // right side, and how tall the node happens to be says nothing about where that side is.
    return horizontal ? along(-Math.sign(to.x - from.x || 1), 0) : along(0, -Math.sign(to.y - from.y || 1));
  }
  // A straight or arced edge travels the chord, so the chord's direction is the one to measure —
  // and the point is clamped to the far end, since a target nearer than its own outline would
  // otherwise put the arrowhead behind the node it came from.
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return to;
  const point = along(dx / distance, dy / distance);
  // Its own centre rather than past the other end: two overlapping cards would otherwise put this
  // end behind the node it is attaching to.
  return Math.hypot(point.x - to.x, point.y - to.y) >= distance ? to : point;
}

/*
 * `trimToBox` was here — the ray-box intersection a straight chord was trimmed with. It is
 * `boxReach` now, one of the three answers `reachAlong` picks between: a box, an inscribed ellipse,
 * or the outline a card is actually cut to. Trimming and attaching were the same question asked
 * twice, and only one of the two had heard of a shape.
 */

/**
 * Route one edge.
 *
 * `clearance` is how far short of the target's centre to stop, so an arrowhead lands on the node
 * rather than inside it. It is applied here rather than by the caller because where an edge lands
 * depends on the shape it is drawn with — see `attachPoint`.
 *
 * `sourceClearance` is the same measurement at the other end, and it exists because the line used to
 * *start* at the source's centre and be hidden by whatever was drawn on top of it. That is invisible
 * for an opaque card and wrong for everything else: a translucent one has a line running under its
 * text, a round node has one crossing it, and the connect gesture's preview — which is drawn while
 * the pointer is elsewhere — had a visible stub leaving the middle of the card. Symmetric now, so an
 * edge is the segment *between* two shapes rather than between two centres.
 *
 * `attachPoint` works from either end unchanged: asked about `from` with the roles swapped, it gives
 * the point on the source facing the target. `horizontal` is not swapped with it — the axis is a
 * property of the edge, decided once from the centres.
 *
 * `anchors` pin which **side** of a node each end leaves or arrives on, where somebody has said. It
 * overrules the derived side, and for a shape with a tangent it overrules the direction of travel
 * too: an edge told to leave the north side departs *upwards*, or the curve would leave the top of a
 * card and immediately set off sideways, which reads as the anchor having been ignored.
 *
 * `step` is the exception and knowingly so: an anchor moves where it attaches, and its corners are
 * still derived from the axis the edge mostly runs along. Cross-axis anchors on an orthogonal route
 * want a router that solves the whole path, which is a different piece of work; the shape a canvas
 * uses is `smooth`.
 *
 * `waypoints` are points the route must pass through, in world coordinates — somebody's decision
 * about where this line goes, so they beat every derivation left. Each end attaches facing its
 * *nearest waypoint* rather than the far node, since that is the direction the line actually leaves
 * in, and `offset` is ignored: fanning is a way of separating two edges nobody has shaped, and an
 * explicit route is already separate from whatever it was drawn around.
 */
export function routeEdge(
  id: string,
  from: Point,
  to: Point,
  curve: EdgeCurve,
  offset = 0,
  clearance: number | EdgeClearance = 0,
  sourceClearance: number | EdgeClearance = 0,
  anchors: EdgeAnchors = {},
  waypoints: readonly Point[] = [],
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
  const end = attachPoint(from, to, curve, clearance, horizontal, anchors.target);
  // The same question at the other end — see `sourceClearance`. Roles swapped, axis not.
  const begin = attachPoint(to, from, curve, sourceClearance, horizontal, anchors.source);

  if (waypoints.length) {
    /*
      Each end faces the waypoint next to it, not the far node.

      A line bent up and over a card leaves its source *upwards*; attaching it toward a target it no
      longer heads for would start the route on the wrong side and then double back across the card
      it belongs to. Each end therefore re-asks `attachPoint` against its own neighbour, with its own
      axis — the shared `horizontal` is a property of a straight span and there is no longer one.
    */
    const first = waypoints[0];
    const last = waypoints[waypoints.length - 1];
    const facing = (node: Point, neighbour: Point, side: EdgeSide | undefined, own: number | EdgeClearance) =>
      attachPoint(neighbour, node, curve, own, Math.abs(neighbour.x - node.x) >= Math.abs(neighbour.y - node.y), side);
    const head = facing(from, first, anchors.source, sourceClearance);
    const tail = facing(to, last, anchors.target, clearance);
    const through = [head, ...waypoints, tail];
    const segments =
      curve === 'step'
        ? orthogonalThrough(through)
        : curve === 'straight'
          ? through.slice(1).map((point) => ({ to: point }))
          : splineThrough(through);
    return {
      id,
      from: head,
      to: tail,
      segments,
      curve,
      // Half-way along the points rather than of the curve: a label wants to be on the line, and the
      // difference between the polyline's midpoint and the spline's is far below where one sits.
      mid: midpointOf(through),
    };
  }

  if (curve === 'step') {
    // Two separations, at right angles to each other so they compose rather than compete: the lane
    // holds the approach segments apart, and the crossing holds the segment between them apart.
    const lane = laneWidth(offset, clearance, horizontal);
    const start = shiftLane(begin, lane, horizontal);
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
    const start = shiftLane(begin, lane, horizontal);
    const finish = shiftLane(end, lane, horizontal);
    /*
      Each end departs along the way its own side faces.

      Unanchored that is the dominant axis, signed by which way the edge runs, which is exactly what
      the two expressions here used to say in longhand. Anchored it is the side somebody pinned, and
      the two ends no longer have to agree: an edge leaving a card's top and arriving at another's
      left is a curve that departs upward and arrives from the left, which is the shape an anchor is
      asking for and the reason it cannot be one shared axis any more.
    */
    const reach = Math.abs(horizontal ? finish.x - start.x : finish.y - start.y) / 2;
    const out = departure(from, to, horizontal, anchors.source, false);
    const back = departure(from, to, horizontal, anchors.target, true);
    const control = { x: start.x + out[0] * reach, y: start.y + out[1] * reach };
    const control2 = { x: finish.x + back[0] * reach, y: finish.y + back[1] * reach };
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
    if (!offset)
      return { id, from: begin, to: end, curve, mid: { x: (begin.x + end.x) / 2, y: (begin.y + end.y) / 2 } };
    /*
      Parallel, not bowed.

      Asking for straight edges and getting curved ones for the mutual pairs is the wrong trade: the
      author picked a shape, and separating relationships does not require abandoning it. Shifting the
      whole line sideways keeps both — two straight lines, visibly two. Half the offset for the same
      reason as the step above.
    */
    const normal = canonicalNormal(begin, end);
    const shift = offset / 2;
    const nx = normal.x * shift;
    const ny = normal.y * shift;
    const a = { x: begin.x + nx, y: begin.y + ny };
    const b = { x: end.x + nx, y: end.y + ny };
    return { id, from: a, to: b, curve, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  const length = Math.hypot(end.x - begin.x, end.y - begin.y) || 1;
  // Perpendicular to the segment, and canonically oriented so the bow is symmetrical whichever way
  // the edge runs — see `canonicalNormal`.
  const normal = canonicalNormal(begin, end);
  const bow = offset || Math.min(length * 0.12, 40);
  const control = {
    x: (begin.x + end.x) / 2 + normal.x * bow,
    y: (begin.y + end.y) / 2 + normal.y * bow,
  };
  return {
    id,
    from: begin,
    to: end,
    control,
    curve: 'arc',
    // A quadratic's midpoint is the average of its endpoints and twice its control, not the average
    // of its endpoints — putting a label at the latter leaves it off the line it belongs to.
    mid: { x: (begin.x + 2 * control.x + end.x) / 4, y: (begin.y + 2 * control.y + end.y) / 4 },
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
 * The point a fraction of the way along a polyline, by arc length.
 *
 * By length rather than by index, so a sampled curve is walked at a constant speed: the samples of a
 * tight bend are packed close together, and stepping through them by count would crawl round the
 * corner and sprint down the straight.
 */
export function pointAlong(points: Point[], fraction: number): Point {
  if (!points.length) return { x: 0, y: 0 };
  const lengths = points
    .slice(1)
    .map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0) return points[0];
  let walked = 0;
  const target = total * Math.min(Math.max(fraction, 0), 1);
  for (let index = 0; index < lengths.length; index += 1) {
    if (walked + lengths[index] >= target) {
      const t = lengths[index] === 0 ? 0 : (target - walked) / lengths[index];
      const a = points[index];
      const b = points[index + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += lengths[index];
  }
  return points[points.length - 1];
}

/**
 * How far along a polyline a point sits, as a fraction of its length.
 *
 * The inverse of {@link pointAlong}, by projection onto the nearest leg — a waypoint is stored in the
 * edge's frame and drawn from the routed curve, so where it falls *along the drawn line* is not
 * something either of those says and has to be measured.
 */
export function fractionAlong(points: Point[], at: Point): number {
  if (points.length < 2) return 0;
  const lengths = points
    .slice(1)
    .map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0) return 0;
  let walked = 0;
  let best = { distance: Infinity, at: 0 };
  for (let index = 0; index < lengths.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const square = dx * dx + dy * dy;
    const t = square === 0 ? 0 : Math.min(Math.max(((at.x - a.x) * dx + (at.y - a.y) * dy) / square, 0), 1);
    const distance = Math.hypot(a.x + dx * t - at.x, a.y + dy * t - at.y);
    if (distance < best.distance) best = { distance, at: (walked + lengths[index] * t) / total };
    walked += lengths[index];
  }
  return best.at;
}

/**
 * Where to offer a new bend — one point per gap between the bends a route already has.
 *
 * The gaps have to be found by *measuring*, which is the whole point of this function. Dividing the
 * route into equal lengths is the obvious shortcut and is wrong: waypoints sit wherever somebody put
 * them, so the k-th equal division is not the k-th gap. A route bent once near its target drew its
 * second offer before that bend and inserted it after — so the press landed a point in the list at
 * one place and on the canvas at another, and the line pinched somewhere the pointer had never been.
 *
 * Result index k is the gap before waypoint k, which is also the index a new point splices in at.
 * Fractions are clamped to be non-decreasing so a route that doubles back — where a waypoint can
 * project onto an earlier leg than its neighbour — still offers its gaps in order rather than
 * inside out.
 */
export function bendPoints(drawn: Point[], waypoints: Point[]): Point[] {
  const edges = [0];
  for (const point of waypoints) edges.push(Math.max(fractionAlong(drawn, point), edges[edges.length - 1]));
  edges.push(1);
  return edges.slice(1).map((end, index) => pointAlong(drawn, (edges[index] + end) / 2));
}

/**
 * The route as a polyline.
 *
 * Sampling rather than solving: the exact distance from a point to a quadratic bezier is a quartic
 * root-find, and for picking an edge a few pixels wide it buys nothing over sixteen segments. The
 * same function serves straight and orthogonal routes, which are already polylines.
 */
export function polyline(geometry: EdgeGeometry, samples = 16): Point[] {
  /*
    A hand-shaped route, segment by segment.

    Sampled at the same rate per *segment* rather than over the whole route, so a line bent three
    times is measured as finely as one bent once — picking tolerance is a few pixels and a shared
    budget would thin out exactly where the shape is most interesting.
  */
  if (geometry.segments) {
    const points: Point[] = [geometry.from];
    let at = geometry.from;
    for (const segment of geometry.segments) {
      if (segment.control && segment.control2) {
        for (let step = 1; step <= samples; step += 1) {
          points.push(cubicAt(at, segment.control, segment.control2, segment.to, step / samples));
        }
      } else {
        points.push(segment.to);
      }
      at = segment.to;
    }
    return points;
  }
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
