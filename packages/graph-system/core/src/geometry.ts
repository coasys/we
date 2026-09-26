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
   * The outline itself, in the same fractions of the box, where a node is mid-morph between two
   * shapes — see `MORPH_OUTLINES`.
   *
   * It beats `shape`, which names one of the two and is therefore the *destination* while a card is
   * still being drawn as the blend. Without this an edge meets the note a triangle is becoming for
   * the whole of the change: a small error, and the same one `shape` exists to fix one level up.
   */
  outline?: readonly (readonly [number, number])[];
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

  /*
    A blend in progress beats the name of either shape, including the exact ellipse below: mid-morph a
    round card is not an ellipse, and meeting the one it is *becoming* is what put the line 40px inside
    a card that was still being drawn as a circle.
  */
  if (clearance.outline) {
    const reach = polygonReach(ux, uy, clearance.outline, halfWidth, halfHeight);
    if (Number.isFinite(reach)) return reach;
  }

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
    // Tolerant at both ends, because a ray aimed exactly at a vertex meets two edges at their shared
    // endpoint and floating point can put both a hair outside the range, which answers with nothing.
    if (along > 0 && across >= -1e-9 && across <= 1 + 1e-9) nearest = Math.min(nearest, along);
  }
  return nearest;
}

/**
 * Which way one end of an edge faces, out of its node — a unit vector.
 *
 * The router's own currency for "where does this end attach", and the reason a side letter reaches no
 * further than {@link facingOf}. Everything downstream — the reach along the outline, the standoff, the
 * tangent the curve arrives on — is already a function of a direction, so the four sides are simply
 * four of the directions there are, and a direction *between* two of them is as routable as either.
 */
export type Facing = readonly [number, number];

/** Which way a side faces, as a unit vector out of the node. See {@link EdgeSide}. */
const OUTWARD: Record<EdgeSide, Facing> = {
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
export function anchorsOf(data: Record<string, unknown> | undefined, fallback?: EdgeAnchors): EdgeAnchors {
  const side = (value: unknown): EdgeSide | undefined =>
    value === 'n' || value === 'e' || value === 's' || value === 'w' ? value : undefined;
  /*
    `fallback` is a style rule's answer, behind whatever the edge itself carries.

    That order rather than the other way round because the two are facts at different scales: a rule says
    how a whole arrangement hangs its lines, and a stored anchor is one canvas's tidying of one
    connection. The narrower fact wins, exactly as a card's own colour sits in front of its type's.

    Resolved through one function so the precedence has one implementation. The router draws the line and
    the renderer places the grips along it, and a second copy of this rule is how the handles came to sit
    at the old endpoints while the line moved.
  */
  // Both sides go through `side`, not only the stored one. A template is JSON and untyped at runtime,
  // so a rule saying `'up'` is exactly as possible as a peer writing it — and the consequence is the
  // same: an edge routed to `NaN`, which draws nothing and reports nothing.
  return {
    source: side(data?.sourceAnchor) ?? side(fallback?.source),
    target: side(data?.targetAnchor) ?? side(fallback?.target),
  };
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
/**
 * Which way the `to` end of this span faces, out of its own node.
 *
 * The one answer to two questions — which way to measure the outline along, and which way the curve leaves
 * or arrives — because they must agree or a line meets its node somewhere it is not pointing.
 *
 * Roles as `attachPoint` takes them: `to` is the node being attached to and `from` is the other end, so
 * the source's facing is this asked with the two swapped. `horizontal` is NOT swapped with them — the
 * axis is a property of the span, decided once from the centres.
 */
export function facingOf(
  from: Point,
  to: Point,
  curve: EdgeCurve,
  horizontal: boolean,
  side: EdgeSide | undefined,
): Facing {
  // Somebody overruling all of it for this end of this edge.
  if (side) return OUTWARD[side];
  if (curve === 'smooth' || curve === 'step') {
    // The axis it arrives on is the axis to measure: a curve arriving horizontally meets the left or
    // right side, and how tall the node happens to be says nothing about where that side is.
    return horizontal ? [-Math.sign(to.x - from.x || 1), 0] : [0, -Math.sign(to.y - from.y || 1)];
  }
  // A straight or arced edge travels the chord, so the chord's direction is the one to measure.
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const distance = Math.hypot(dx, dy);
  return distance === 0 ? [0, -1] : [dx / distance, dy / distance];
}

/** A facing as an angle, and back — what an interpolation between two of them needs. */
export function angleOf(facing: Facing): number {
  return Math.atan2(facing[1], facing[0]);
}

export function facingAt(angle: number): Facing {
  return [Math.cos(angle), Math.sin(angle)];
}

/**
 * The signed turn from one facing to another, the short way round.
 *
 * `toward` breaks the tie at exactly half a turn, where the two ways are the same length and the
 * choice is still visible: it picks the way that passes the direction given, which callers hand the
 * *near* side — the way the rest of the line already lies — so a swing never travels round the back of
 * the node it is attached to.
 */
export function turnBetween(a: number, b: number, toward?: number): number {
  const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
  const delta = wrap(b - a);
  if (toward === undefined || Math.abs(Math.abs(delta) - Math.PI) > 1e-6) return delta;
  const near = wrap(toward - a);
  return Math.sign(near || 1) * Math.PI;
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
 * The direction is decided by {@link facingOf}, or handed in by a caller interpolating between two of
 * them. This function's whole job is the *distance*: how far along that direction the outline is, plus
 * the standoff. Which is why a facing between two sides needs nothing added here — walking a rotating
 * ray out of the centre traces the real outline, corners and all, and can never land inside the node.
 *
 * `chord` says the direction IS the line between the two centres, which only a `straight` or an `arc`
 * with nothing overruling it can be. It is the one case that needs the guard below, because it is the
 * one case where overshooting the outline means landing past the other node rather than beside it.
 */
function attachPoint(from: Point, to: Point, clearance: number | EdgeClearance, facing: Facing, chord = false): Point {
  const { halfWidth, halfHeight } = clearanceOf(clearance);
  if (halfWidth <= 0 && halfHeight <= 0) return to;
  const gap = typeof clearance === 'number' ? 0 : (clearance.gap ?? 0);
  const reach = reachAlong(facing[0], facing[1], clearance) + gap;
  const point = { x: to.x + facing[0] * reach, y: to.y + facing[1] * reach };
  if (!chord) return point;
  /*
    Its own centre rather than past the other end: two overlapping cards would otherwise put this end
    behind the node it came from.

    Deliberately NOT asked of a facing that is being swept. The guard is a snap — beyond the other
    centre, fall back to this node's own — and a snap inside a movement is a jump waiting for two cards
    to pass close to one another, which on a rearrangement they do. Along the chord there is nothing
    moving the direction, so the only way to reach it is to drag two cards together, where it has always
    been the behaviour.
  */
  const distance = Math.hypot(from.x - to.x, from.y - to.y);
  if (distance === 0) return to;
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
 *
 * `facing` overrules the direction at either end with a vector, which is how an anchor *changing* is
 * animated rather than jumped: a side is four directions and a rearrangement that repins one has to
 * cross the ones in between. An override rather than a widening of `anchors`, because a side is a
 * stored, authored fact that the canvas writes and reads back, and a direction mid-sweep is neither.
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
  facing: { source?: Facing; target?: Facing } = {},
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
  const facingTo = facing.target ?? facingOf(from, to, curve, horizontal, anchors.target);
  // The same question at the other end — see `sourceClearance`. Roles swapped, axis not.
  const facingFrom = facing.source ?? facingOf(to, from, curve, horizontal, anchors.source);
  // Along the chord only where the chord is what decided the direction — see `attachPoint`.
  const travelsChord = curve === 'straight' || curve === 'arc';
  const chordTo = travelsChord && !facing.target && !anchors.target;
  const chordFrom = travelsChord && !facing.source && !anchors.source;
  const end = attachPoint(from, to, clearance, facingTo, chordTo);
  const begin = attachPoint(to, from, sourceClearance, facingFrom, chordFrom);

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
    const meeting = (
      node: Point,
      neighbour: Point,
      side: EdgeSide | undefined,
      own: number | EdgeClearance,
      override: Facing | undefined,
    ) => {
      const axis = Math.abs(neighbour.x - node.x) >= Math.abs(neighbour.y - node.y);
      return attachPoint(neighbour, node, own, override ?? facingOf(neighbour, node, curve, axis, side));
    };
    const head = meeting(from, first, anchors.source, sourceClearance, facing.source);
    const tail = meeting(to, last, anchors.target, clearance, facing.target);
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
    /*
      Half the span, on whichever axis it is longer on — measured between the points the curve actually
      runs between rather than chosen by the axis the *centres* mostly run along.

      The two agree except near the diagonal, where choosing by axis is a discontinuity: `horizontal`
      flips as a card crosses it mid-travel, and the whole curve would change shape in one frame. A maximum
      is continuous, and equals the axis choice wherever the difference is worth seeing.
    */
    const reach = Math.max(Math.abs(finish.x - start.x), Math.abs(finish.y - start.y)) / 2;
    /*
      The tangent at each end IS that end's facing — see `facingOf`, which is the one place the two used
      to be derived separately. Arriving along the inward direction is also what keeps the arrowhead
      aimed at the node's centre while the facing sweeps, rather than at wherever the line came from.
    */
    const control = { x: start.x + facingFrom[0] * reach, y: start.y + facingFrom[1] * reach };
    const control2 = { x: finish.x + facingTo[0] * reach, y: finish.y + facingTo[1] * reach };
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

/** A cubic Bézier as its four points: the start, the two controls, and the end. */
export type Cubic = readonly [Point, Point, Point, Point];

const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * Any route, as a chain of cubics drawing exactly the same line.
 *
 * Every shape a route can take already is one, or converts without loss: a `smooth` curve is a cubic, an
 * `arc` is a quadratic (which a cubic represents exactly), and a straight leg is a cubic whose controls sit
 * on the line. A route bent through waypoints is a chain of those. So this is a change of representation
 * and not an approximation — which is what lets {@link blendRoutes} morph any route into any other.
 */
export function cubicsOf(geometry: EdgeGeometry): Cubic[] {
  const line = (a: Point, b: Point): Cubic => [a, mix(a, b, 1 / 3), mix(a, b, 2 / 3), b];
  if (geometry.segments) {
    const chain: Cubic[] = [];
    let at = geometry.from;
    for (const segment of geometry.segments) {
      // The same test `pathFrom` draws by: both controls or a straight leg.
      chain.push(
        segment.control && segment.control2
          ? [at, segment.control, segment.control2, segment.to]
          : line(at, segment.to),
      );
      at = segment.to;
    }
    return chain;
  }
  if (geometry.elbows) {
    const corners = [geometry.from, ...geometry.elbows, geometry.to];
    return corners.slice(1).map((corner, index) => line(corners[index], corner));
  }
  const { from, to, control, control2 } = geometry;
  if (control && control2) return [[from, control, control2, to]];
  // A quadratic raised to a cubic: each control two thirds of the way from its end to the quadratic's one.
  if (control) return [[from, mix(from, control, 2 / 3), mix(to, control, 2 / 3), to]];
  return [line(from, to)];
}

/** De Casteljau: the two pieces of a cubic either side of parameter `t`, each exactly on the original. */
export function splitCubic(cubic: Cubic, t: number): [Cubic, Cubic] {
  const [p0, p1, p2, p3] = cubic;
  const a = mix(p0, p1, t);
  const b = mix(p1, p2, t);
  const c = mix(p2, p3, t);
  const d = mix(a, b, t);
  const e = mix(b, c, t);
  const f = mix(d, e, t);
  return [
    [p0, a, d, f],
    [f, e, c, p3],
  ];
}

/** How finely a cubic's length is measured, which bounds how exactly a chain is cut by length. */
const LENGTH_STEPS = 32;

/** Distance travelled along a cubic at each of `LENGTH_STEPS` even steps of its parameter. */
function lengthTable(cubic: Cubic): number[] {
  const table = [0];
  let previous = cubic[0];
  for (let step = 1; step <= LENGTH_STEPS; step += 1) {
    const point = cubicAt(cubic[0], cubic[1], cubic[2], cubic[3], step / LENGTH_STEPS);
    table.push(table[step - 1] + Math.hypot(point.x - previous.x, point.y - previous.y));
    previous = point;
  }
  return table;
}

/** The parameter at which a cubic has travelled `distance`, read off its table. */
function parameterAt(table: readonly number[], distance: number): number {
  let step = 1;
  while (step < table.length - 1 && table[step] < distance) step += 1;
  const span = table[step] - table[step - 1];
  const into = span > 0 ? (distance - table[step - 1]) / span : 0;
  return (step - 1 + Math.min(1, Math.max(0, into))) / LENGTH_STEPS;
}

/** Two cut positions closer than this, as fractions of a route's length, are one cut. */
const CUT_TOLERANCE = 1e-6;

/** A chain measured: each piece's table, where each piece ends as a fraction of the whole, and the whole. */
function measure(chain: readonly Cubic[]): { tables: number[][]; ends: number[]; total: number } {
  const tables = chain.map(lengthTable);
  const total = tables.reduce((sum, table) => sum + table[table.length - 1], 0);
  let travelled = 0;
  const ends = tables.map((table) => {
    travelled += table[table.length - 1];
    return total > 0 ? travelled / total : 1;
  });
  return { tables, ends, total };
}

/** A chain cut at each of `cuts` — fractions of its length, ascending — that is not already a joint. */
function cutAt(chain: readonly Cubic[], measured: ReturnType<typeof measure>, cuts: readonly number[]): Cubic[] {
  const out: Cubic[] = [];
  let next = 0;
  chain.forEach((cubic, index) => {
    const start = index === 0 ? 0 : measured.ends[index - 1];
    const end = measured.ends[index];
    const table = measured.tables[index];
    // The parameters, on this piece as it stands, of every cut falling strictly inside it.
    const inside: number[] = [];
    while (next < cuts.length && cuts[next] < end - CUT_TOLERANCE) {
      if (cuts[next] > start + CUT_TOLERANCE) inside.push(parameterAt(table, (cuts[next] - start) * measured.total));
      next += 1;
    }
    // Each cut splits what is left, so its parameter is rescaled onto the remainder.
    let rest = cubic;
    let used = 0;
    for (const t of inside) {
      const [head, tail] = splitCubic(rest, (t - used) / (1 - used));
      out.push(head);
      rest = tail;
      used = t;
    }
    out.push(rest);
  });
  return out;
}

/**
 * Two routes as one, `weight` of the way from `a` to `b`, control point by control point.
 *
 * The standard path morph. Both chains are cut into the same number of pieces at the same fractions of
 * their lengths — each at the other's joints — so piece `i` of both covers the same stretch of line, and
 * then all four points of each piece are interpolated. Interpolating control points rather than points on
 * the line is what carries the TANGENTS through, so the direction a line leaves and arrives in — and the
 * arrowhead drawn along it — is itself interpolated.
 *
 * Exact at both ends of the weight: 0 is `a` and 1 is `b`, drawn as themselves, so a morph hands over to
 * the ordinary route with nothing to jump. Two routes of zero length have no fractions to match, and
 * answer with whichever the weight is nearer.
 */
export function blendRoutes(a: EdgeGeometry, b: EdgeGeometry, weight: number): EdgeGeometry {
  if (weight <= 0) return a;
  if (weight >= 1) return b;
  const chainA = cubicsOf(a);
  const chainB = cubicsOf(b);
  const measuredA = measure(chainA);
  const measuredB = measure(chainB);
  if (measuredA.total <= 0 || measuredB.total <= 0) return weight < 0.5 ? a : b;
  // Every joint of either, once: each chain is then cut wherever the other has a joint it lacks.
  const cuts = [...measuredA.ends.slice(0, -1), ...measuredB.ends.slice(0, -1)]
    .sort((x, y) => x - y)
    .filter((cut, index, all) => index === 0 || cut - all[index - 1] > CUT_TOLERANCE);
  const piecesA = cutAt(chainA, measuredA, cuts);
  const piecesB = cutAt(chainB, measuredB, cuts);
  if (piecesA.length !== piecesB.length) return weight < 0.5 ? a : b;
  const chain = piecesA.map(
    (piece, index) => piece.map((point, which) => mix(point, piecesB[index][which], weight)) as unknown as Cubic,
  );
  return {
    id: b.id,
    from: chain[0][0],
    to: chain[chain.length - 1][3],
    segments: chain.map((piece) => ({ control: piece[1], control2: piece[2], to: piece[3] })),
    curve: b.curve,
    mid: mix(a.mid, b.mid, weight),
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

/** A silhouette in the box's own 0..1 space, clockwise. */
export type Outline = readonly (readonly [number, number])[];

/**
 * Directions a blend describes itself in beyond the two shapes' own corners.
 *
 * Small on purpose. The corners come from the shapes themselves — see {@link directionsFor} — so this only
 * has to keep the angular gaps from getting wide, and eight at forty-five degrees already coincides with
 * every axis and diagonal. It is a floor, not the sampling.
 */
const MORPH_FILL = 8;

/** Clockwise from straight up, the convention the whole shape table is written in. */
const MORPH_START = -Math.PI / 2;
const TURN = Math.PI * 2;

/**
 * One outline part-way between two, sampled by direction rather than matched point for point.
 *
 * **Which point becomes which is the whole problem, and this makes it not a question.** Both outlines are
 * measured along the same set of directions out of the box's centre and the two distances are lerped, so a
 * diamond's top vertex becomes whatever the note has straight above its centre — by construction, with no
 * correspondence to find.
 *
 * Matching points instead fails as soon as the counts differ much: a rounded note's points cluster at its
 * corners while a diamond padded to match spreads them along its edges, so vertices map to edge midpoints
 * and the card passes through a lumpy many-sided shape.
 *
 * **It assumes the shapes are convex**, which every one in the table is: a ray out of the centre leaves a
 * convex outline exactly once, so one distance per direction describes it completely. A star would come out
 * as its inner hull, and would want a matched-point blend back with a correspondence somebody chose.
 */
export function blendOutlines(from: Outline, to: Outline, t: number): Outline {
  return sampledBlend(from, to, t).outline;
}

/**
 * How far a blend reaches along one of its own directions — what it has to carry to be blended AGAIN.
 *
 * A reversal mid-morph starts from the outline on screen, and a *blended* polygon cannot safely be asked
 * how far it reaches: two of its directions can lie close enough to leave an edge pointing almost at the
 * centre, which a ray between them misses, and the card grows a spike. So a blend carries its own radii
 * forward, and only the hand-written shape table is ever ray-cast.
 */
export interface OutlineSample {
  ux: number;
  uy: number;
  r: number;
}

/** A blend of two shapes from the table, with the radii it was built from. */
export function sampledBlend(from: Outline, to: Outline, t: number): { outline: Outline; samples: OutlineSample[] } {
  const at = Math.min(1, Math.max(0, t));
  // Per frame this is a lerp and two multiplies per direction. Everything that needed a ray cast against
  // the two outlines was answered once, for the pair — see `directionsFor`.
  const samples = directionsFor(from, to).map(({ ux, uy, a, b }) => ({ ux, uy, r: a + (b - a) * at }));
  return { outline: samples.map(({ ux, uy, r }) => [0.5 + ux * r, 0.5 + uy * r] as const), samples };
}

/** The same, continuing from a blend already in flight — its own directions, its own radii. */
export function resampleBlend(
  from: readonly OutlineSample[],
  to: Outline,
  t: number,
): { outline: Outline; samples: OutlineSample[] } {
  const at = Math.min(1, Math.max(0, t));
  const samples = from.map(({ ux, uy, r }) => ({ ux, uy, r: r + (radiusAt(to, ux, uy) - r) * at }));
  return { outline: samples.map(({ ux, uy, r }) => [0.5 + ux * r, 0.5 + uy * r] as const), samples };
}

/**
 * The directions a pair of shapes is blended along: both of their corners, plus a coarse fill.
 *
 * Taking the corners from the shapes makes the ends of a blend **exact**: no vertex of either outline lies
 * between two neighbouring directions, so each chord is an edge, and at `t` of 0 or 1 the result is the
 * shape itself. Fixed angles would cut every corner that falls between two of them — 1.6% of a pentagon's
 * size, and still 0.8% at twice the samples. Sized to the pair: eight directions for a diamond becoming a
 * square, forty for a circle becoming a note.
 *
 * **Cached with the two distances along each**, since a pair's answer never changes and a frame then needs
 * only the lerp: casting both outlines per card per frame measured 4 ms for two hundred cards. The tables
 * are module constants with at most forty-nine pairs, so the cache has nothing to evict.
 */
interface Sampled {
  ux: number;
  uy: number;
  /** How far the outline being left reaches this way, and the one being arrived at. */
  a: number;
  b: number;
}

const directionCache = new WeakMap<object, WeakMap<object, Sampled[]>>();

function directionsFor(from: Outline, to: Outline): Sampled[] {
  let byTo = directionCache.get(from);
  if (!byTo) {
    byTo = new WeakMap();
    directionCache.set(from, byTo);
  }
  const cached = byTo.get(to);
  if (cached) return cached;

  // Measured as a turn clockwise from straight up, so sorting them puts the outline in the order every
  // consumer of one expects.
  const turned = (angle: number) => (((angle - MORPH_START) % TURN) + TURN) % TURN;
  const found: number[] = [];
  const add = (angle: number) => {
    const spun = turned(angle);
    // A thousandth of a radian — a twentieth of a degree, which is far below anything anybody can see and
    // wide enough to collapse two directions that would otherwise leave a near-radial edge between them.
    // At 1e-6 they survived, and a ray between them missed both of its neighbours: see `radiusAt`.
    if (!found.some((other) => Math.abs(other - spun) < 1e-3)) found.push(spun);
  };
  for (let i = 0; i < MORPH_FILL; i += 1) add(MORPH_START + (i / MORPH_FILL) * TURN);
  for (const [x, y] of [...from, ...to]) add(Math.atan2(y - 0.5, x - 0.5));
  found.sort((a, b) => a - b);

  const sampled = found.map((spun) => {
    const angle = MORPH_START + spun;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    return { ux, uy, a: radiusAt(from, ux, uy), b: radiusAt(to, ux, uy) };
  });
  byTo.set(to, sampled);
  return sampled;
}

/** How far an outline reaches from the box's centre along one direction, in fractions of the box. */
function radiusAt(outline: Outline, ux: number, uy: number): number {
  const reach = polygonReach(ux, uy, outline, 0.5, 0.5);
  if (Number.isFinite(reach)) return reach;
  /*
    The box's own reach along this direction — the honest answer for an outline that cannot answer. A flat
    half would sit well inside the shape on a diagonal and outside a narrow part of it, and draw a spike.
  */
  return Math.min(
    Math.abs(ux) > 1e-9 ? Math.abs(0.5 / ux) : Infinity,
    Math.abs(uy) > 1e-9 ? Math.abs(0.5 / uy) : Infinity,
  );
}
