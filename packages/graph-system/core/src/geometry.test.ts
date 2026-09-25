/**
 * Edge geometry tests.
 *
 * Both behaviours here are the difference between a graph that looks drawn and one that looks
 * emitted: an arrowhead buried under the node it points at, and two mutual edges rendered exactly on
 * top of each other so the graph understates its own connectivity.
 */
import { describe, expect, it } from 'vitest';

import {
  anchorsOf,
  bendPoints,
  bowOffsets,
  distanceToEdge,
  endOf,
  fractionAlong,
  groupByEndpoints,
  normaliseCurve,
  pointAlong,
  routeEdge,
  routesAlike,
  trimToRadius,
  waypointFromWorld,
  waypointsOf,
  waypointToWorld,
} from './geometry';

describe('trimToRadius', () => {
  it('stops the segment at the node edge, not its centre', () => {
    expect(trimToRadius({ x: 0, y: 0 }, { x: 100, y: 0 }, 20)).toEqual({ x: 80, y: 0 });
  });

  it('leaves the endpoint alone when the nodes already overlap', () => {
    // Trimming past the start would flip the arrow around.
    expect(trimToRadius({ x: 0, y: 0 }, { x: 10, y: 0 }, 20)).toEqual({ x: 10, y: 0 });
  });

  it('does not divide by zero on a self-loop', () => {
    expect(trimToRadius({ x: 5, y: 5 }, { x: 5, y: 5 }, 20)).toEqual({ x: 5, y: 5 });
  });
});

describe('bowOffsets', () => {
  it('draws a lone edge straight', () => {
    expect(bowOffsets(1)).toEqual([0]);
  });

  it('splits a mutual pair symmetrically', () => {
    // Both bending the same way would still overlap; opposite signs separate them.
    const [first, second] = bowOffsets(2, 20);
    expect(first).toBe(20);
    expect(second).toBe(-20);
  });

  it('fans a bundle of parallel edges outward', () => {
    expect(bowOffsets(4, 10)).toEqual([10, -10, 20, -20]);
  });
});

describe('routeEdge', () => {
  it('draws a straight line when asked and unbowed', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 10, y: 10 }, 'straight');
    expect(route.control).toBeUndefined();
    expect(route.mid).toEqual({ x: 5, y: 5 });
  });

  it('bows a curve to the requested side', () => {
    const left = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'arc', 20);
    const right = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'arc', -20);
    expect(left.control).not.toEqual(right.control);
  });

  it('puts the label on the curve, not on the chord', () => {
    // A quadratic's midpoint is the average of its endpoints and *twice* its control. Using the chord
    // midpoint leaves the label floating off the line it belongs to.
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'arc', 40);
    expect(route.mid.y).not.toBe(0);
    expect(Math.abs(route.mid.y)).toBeLessThan(40);
  });

  it('steps through two corners, turning along the axis it mostly runs on', () => {
    const across = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 50 }, 'step');
    expect(across.elbows).toEqual([
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ]);

    // Mostly vertical, so it departs vertically instead — a top-to-bottom hierarchy should not leave
    // sideways before it starts descending.
    const down = routeEdge('e', { x: 0, y: 0 }, { x: 50, y: 100 }, 'step');
    expect(down.elbows).toEqual([
      { x: 0, y: 50 },
      { x: 50, y: 50 },
    ]);
  });

  it('accepts the previous curve names, so templates written against them keep working', () => {
    expect(normaliseCurve('bezier')).toBe('arc');
    expect(normaliseCurve('orthogonal')).toBe('step');
    expect(normaliseCurve(undefined)).toBe('smooth');
    expect(normaliseCurve('nonsense')).toBe('smooth');
  });

  it('leaves and arrives along the dominant axis on a smooth curve', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 40 }, 'smooth');
    // Departure tangent is horizontal, so the first control shares the source's y.
    expect(route.control).toEqual({ x: 50, y: 0 });
    // Arrival tangent likewise shares the target's.
    expect(route.control2).toEqual({ x: 50, y: 40 });
  });

  it('departs towards the target when a smooth edge runs right to left', () => {
    // Taking the magnitude of the span put both controls behind the source and looped the curve back
    // on itself — invisible on any left-to-right edge, which is most of them in a tidy layout.
    const route = routeEdge('e', { x: 100, y: 0 }, { x: 0, y: 40 }, 'smooth');
    expect(route.control).toEqual({ x: 50, y: 0 });
    expect(route.control2).toEqual({ x: 50, y: 40 });
  });

  it('shifts parallel straight edges sideways rather than bending them', () => {
    // Picking `straight` and getting a curve back for the mutual pair is the wrong trade: the shape
    // was chosen, and separating two relationships does not require abandoning it.
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'straight', 20);
    expect(route.control).toBeUndefined();
    expect(route.from.y).toBe(10);
    expect(route.to.y).toBe(10);
    // Still parallel to the original, so it reads as the same relationship moved over.
    expect(route.from.x).toBe(0);
    expect(route.to.x).toBe(100);
  });

  it('crosses parallel steps at different places', () => {
    const one = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 50 }, 'step', 20);
    const other = routeEdge('f', { x: 0, y: 0 }, { x: 100, y: 50 }, 'step', -20);
    expect(one.elbows![0].x).not.toBe(other.elbows![0].x);
  });

  it('gives a self-loop a visible shape rather than a zero-length route', () => {
    const route = routeEdge('e', { x: 10, y: 10 }, { x: 10, y: 10 }, 'arc');
    expect(route.control).toBeDefined();
    expect(route.mid).not.toEqual({ x: 10, y: 10 });
  });
});

describe('distanceToEdge', () => {
  it('measures zero on the line and grows away from it', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'straight');
    expect(distanceToEdge({ x: 50, y: 0 }, route)).toBeCloseTo(0, 5);
    expect(distanceToEdge({ x: 50, y: 20 }, route)).toBeCloseTo(20, 5);
  });

  it('measures against the curve rather than the chord', () => {
    // The whole point of geometric picking: a bowed edge is not where the straight line between its
    // endpoints is, and clicking the chord should not select it.
    const bowed = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'arc', 60);
    expect(distanceToEdge({ x: 50, y: 0 }, bowed)).toBeGreaterThan(20);
    expect(distanceToEdge({ x: 50, y: 30 }, bowed)).toBeLessThan(5);
  });

  it('clamps to the ends rather than extending the line', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'straight');
    expect(distanceToEdge({ x: -30, y: 0 }, route)).toBeCloseTo(30, 5);
  });
});

describe('groupByEndpoints', () => {
  it('groups mutual edges together regardless of direction', () => {
    const groups = groupByEndpoints([
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
      { source: 'a', target: 'c' },
    ]);
    expect(groups.size).toBe(2);
    expect([...groups.values()].find((group) => group.length === 2)).toBeDefined();
  });

  /*
    Fanning has to survive the return leg.

    `routeEdge` used to take its perpendicular from the edge's own direction, which reverses on the
    way back, cancelling the already-opposite offset and stacking a mutual pair exactly on top of
    each other. It had therefore never worked in any shape, including the one whose whole
    justification for being the default was that it separated them.
  */
  it.each(['straight', 'arc', 'smooth', 'step'] as const)('fans a mutual %s pair to opposite sides', (curve) => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const [first, second] = bowOffsets(2);
    const there = routeEdge('there', a, b, curve, first);
    const back = routeEdge('back', b, a, curve, second);

    expect(there.mid).not.toEqual(back.mid);
    // Opposite sides, not merely different points along the same line.
    const axis = curve === 'step' ? 'x' : 'y';
    const centre = axis === 'y' ? 0 : 50;
    expect(Math.sign(there.mid[axis] - centre)).toBe(-Math.sign(back.mid[axis] - centre));
  });

  /*
    Where an edge meets its target depends on the shape it is drawn with.

    Trimming along the line between two centres is right for a shape that travels along it and wrong
    for one that does not: a smooth curve arrives horizontally and a step arrives at a right angle, so
    a chord trim put the arrowhead somewhere the line was never pointing — reading on screen as an
    arrow aimed at a corner, sliding around the rim as the node moved.
  */
  it('meets the target on the chord for shapes that travel along it', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 100 }, 'straight', 0, 10);
    // On the line between the centres, 10 short of the far one.
    expect(Math.hypot(route.to.x - 100, route.to.y - 100)).toBeCloseTo(10);
    expect(route.to.y / route.to.x).toBeCloseTo(1);
  });

  it('meets the target on the side it approaches from for axis-aligned shapes', () => {
    // Mostly horizontal, so a smooth curve arrives horizontally and should land on the near side at
    // the target's own height — not on the diagonal between the centres.
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 40 }, 'smooth', 0, 10);
    expect(route.to).toEqual({ x: 90, y: 40 });

    // Mostly vertical, so it arrives from above instead.
    const down = routeEdge('e', { x: 0, y: 0 }, { x: 40, y: 100 }, 'smooth', 0, 10);
    expect(down.to).toEqual({ x: 40, y: 90 });
  });

  it('lands a step on the node face its last segment runs into', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 40 }, 'step', 0, 10);
    expect(route.to).toEqual({ x: 90, y: 40 });
    // The last corner shares the arrival row, so the final segment really is horizontal.
    expect(route.elbows![1].y).toBe(40);
  });

  /*
    Separation has to hold where the edges are easiest to look at: at the nodes.

    A step used to separate only by crossing at different places, which left the segments running into
    each node sitting on the same centre line — the two edges were one line exactly at both ends. It
    also made the gap look smaller than `straight`, which moves its whole line for the same offset.
  */
  it.each(['straight', 'smooth', 'step'] as const)('separates a mutual %s pair at the nodes too', (curve) => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const [first, second] = bowOffsets(2);
    const there = routeEdge('there', a, b, curve, first);
    const back = routeEdge('back', b, a, curve, second);

    // Where each one meets the shared node, not merely where it passes the middle.
    expect(there.to.y).not.toBe(back.from.y);
    expect(Math.sign(there.to.y)).toBe(-Math.sign(back.from.y));
  });

  it('keeps a lane on the face of the node it lands on', () => {
    // A small node with a wide offset would otherwise attach beside itself rather than to itself.
    const tight = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'step', 60, 10);
    expect(Math.abs(tight.to.y)).toBeLessThanOrEqual(5);

    // Given room, the full half-offset applies.
    const roomy = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'step', 60, 100);
    expect(Math.abs(roomy.to.y)).toBe(30);
  });
});

/**
 * Where an edge stops when its target is a box rather than a dot.
 *
 * A node's `size` is half its *largest* dimension, so using it as a radius draws a circle around a
 * card: right on the long side, well outside the shape on the short one. Narrowing a wide card left
 * every arrow pointing at where the old width used to be, with a gap no re-read could close — the
 * geometry was doing exactly what it had been told.
 */
describe('clearance against a box', () => {
  const from = { x: 0, y: 0 };

  it('meets a wide card on its side, not on a circle around it', () => {
    // 300 wide, 40 tall, approached horizontally: the side is 150 out, the circle would be 150 too —
    // the case that always looked right.
    const route = routeEdge('e', from, { x: 400, y: 0 }, 'straight', 0, { halfWidth: 150, halfHeight: 20 });

    expect(route.to.x).toBeCloseTo(250, 5);
  });

  it('meets a narrow card on its side rather than half its height away', () => {
    // The reported bug: the same card narrowed to 40 wide. A radius would still be 150 — the height
    // now being the largest dimension — and stop the arrow 130 short of the card.
    const route = routeEdge('e', from, { x: 400, y: 0 }, 'straight', 0, { halfWidth: 20, halfHeight: 150 });

    expect(route.to.x).toBeCloseTo(380, 5);
  });

  it('crosses the box on the side the direction reaches first', () => {
    // Diagonal into a wide, short box: it meets the top, not the side, because the top is nearer
    // along that ray.
    const route = routeEdge('e', from, { x: 200, y: 200 }, 'straight', 0, { halfWidth: 100, halfHeight: 20 });

    expect(route.to.y).toBeCloseTo(180, 5);
    expect(route.to.x).toBeCloseTo(180, 5);
  });

  it('keeps a plain radius circular', () => {
    // The distinction that has to survive: a round node approached at 45° is r away, where a square
    // of half-extent r would be r√2 — passing one as the other pushes every diagonal 40% too far.
    const route = routeEdge('e', from, { x: 100, y: 100 }, 'straight', 0, 10);

    expect(Math.hypot(route.to.x - 100, route.to.y - 100)).toBeCloseTo(10, 5);
  });

  it('attaches a smooth curve on the axis it arrives along', () => {
    // Arriving horizontally means meeting a vertical side, and how tall the card is says nothing
    // about where that side is.
    const route = routeEdge('e', from, { x: 400, y: 0 }, 'smooth', 0, { halfWidth: 20, halfHeight: 150 });

    expect(route.to.x).toBeCloseTo(380, 5);
    expect(route.to.y).toBeCloseTo(0, 5);
  });

  it('attaches a smooth curve arriving vertically on the top edge', () => {
    const route = routeEdge('e', from, { x: 0, y: 400 }, 'smooth', 0, { halfWidth: 150, halfHeight: 20 });

    expect(route.to.y).toBeCloseTo(380, 5);
  });

  it('does not overshoot a target closer than its own edge', () => {
    // Two overlapping cards: the trim would otherwise put the arrowhead behind the source.
    const route = routeEdge('e', from, { x: 10, y: 0 }, 'straight', 0, { halfWidth: 150, halfHeight: 150 });

    expect(route.to).toEqual({ x: 10, y: 0 });
  });
});

/**
 * An edge is the segment between two shapes, not between two centres.
 *
 * The far end has always been trimmed, so an arrowhead lands on the target rather than inside it.
 * The near end was not: the line started at the source's centre and was covered by whatever was
 * painted over it. Invisible under an opaque card, and wrong under everything else — a translucent
 * one has a line running through its text, a round node has one crossing it, and the connect
 * gesture's preview, drawn while the pointer is elsewhere, had a visible stub leaving the middle of
 * the card it was dragged out of.
 */
describe('clearance at the source end', () => {
  it('starts on the source rather than at its centre', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 400, y: 0 }, 'straight', 0, 10, 30);

    expect(route.from.x).toBeCloseTo(30, 5);
    expect(route.to.x).toBeCloseTo(390, 5);
  });

  it('leaves the source on the side it departs from, for a shape that travels along an axis', () => {
    // The mirror of `attachPoint`'s rule at the far end: a smooth curve leaves horizontally, so it
    // leaves by a vertical side, and how tall the card is says nothing about where that side is.
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 400, y: 40 }, 'smooth', 0, 0, {
      halfWidth: 20,
      halfHeight: 150,
    });

    expect(route.from).toEqual({ x: 20, y: 0 });
  });

  it('is the same measurement at both ends, so a route and its reverse are mirrors', () => {
    /*
      The property worth having rather than four separate assertions: `attachPoint` is asked about
      the source with the roles swapped, so getting that swap wrong in any branch shows up here as an
      asymmetry, whatever the shape.
    */
    const near = { halfWidth: 40, halfHeight: 20 };
    const far = { halfWidth: 90, halfHeight: 30 };

    for (const curve of ['straight', 'smooth', 'step', 'arc'] as const) {
      const there = routeEdge('there', { x: 0, y: 0 }, { x: 400, y: 0 }, curve, 0, far, near);
      const back = routeEdge('back', { x: 400, y: 0 }, { x: 0, y: 0 }, curve, 0, near, far);

      expect(back.to.x).toBeCloseTo(there.from.x, 5);
      expect(back.from.x).toBeCloseTo(there.to.x, 5);
    }
  });

  it('still decides its axis from the centres, now that both ends move', () => {
    /*
      Already true of the target's trim and doubly load-bearing with two: between two boxes wide
      enough to nearly touch, the trimmed endpoints can end up closer on the other axis than the
      centres are, and re-deriving `horizontal` from them would flip the whole route — a curve
      leaving a card's side one frame and its top the next, with neither node having moved.
    */
    const wide = { halfWidth: 140, halfHeight: 20 };
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 300, y: 60 }, 'smooth', 0, wide, wide);

    // Mostly horizontal by the centres, so both ends attach on a vertical side and keep their own y.
    expect(route.from).toEqual({ x: 140, y: 0 });
    expect(route.to).toEqual({ x: 160, y: 60 });
  });

  it('does not overshoot a source closer to the target than its own edge', () => {
    // The counterpart of the target-end guard: two overlapping cards must not put the start beyond
    // the end and draw the line backwards.
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 10, y: 0 }, 'straight', 0, 0, {
      halfWidth: 150,
      halfHeight: 150,
    });

    expect(route.from).toEqual({ x: 0, y: 0 });
  });

  it('leaves a route with no source clearance exactly where it was', () => {
    // The default, and what every caller that has not been told about a source gets.
    const trimmed = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'smooth', 0, 10);
    const explicit = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'smooth', 0, 10, 0);

    expect(trimmed.from).toEqual({ x: 0, y: 0 });
    expect(explicit.from).toEqual(trimmed.from);
  });
});

/**
 * An anchor pins which side of a node one end of an edge attaches to.
 *
 * Where a connection leaves and arrives is normally derived from where the two nodes are, which is
 * right until somebody wants it otherwise — a line that would run straight through a third card, or
 * a flow whose steps should leave rightwards whatever the layout did with them. An anchor is that
 * decision, and it has to beat every rule the geometry would otherwise apply.
 */
describe('anchors', () => {
  const box = { halfWidth: 100, halfHeight: 40 };

  it('leaves the side it is told to, not the side it is facing', () => {
    // Mostly horizontal, so an unanchored smooth curve would leave the source's east side. Pinned
    // north, it leaves the top — which is the whole of what an anchor is for.
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 400, y: 0 }, 'smooth', 0, 0, box, { source: 'n' });

    expect(route.from).toEqual({ x: 0, y: -40 });
  });

  it('arrives on the side it is told to', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 400, y: 0 }, 'smooth', 0, box, 0, { target: 's' });

    expect(route.to).toEqual({ x: 400, y: 40 });
  });

  it('sets off the way that side faces, not along the edge', () => {
    /*
      The half that makes an anchor look like one. Moving only the attachment leaves the tangent on
      the dominant axis, so a curve pinned to a card's top leaves the top and immediately sets off
      sideways — which on screen reads as the anchor having been ignored, since the line still runs
      the way it always did and merely starts a few pixels elsewhere.
    */
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 400, y: 0 }, 'smooth', 0, 0, box, { source: 'n' });

    // Departing north: the first control point is directly above the start, never beside it.
    expect(route.control!.x).toBeCloseTo(route.from.x, 5);
    expect(route.control!.y).toBeLessThan(route.from.y);
  });

  it('beats a chord trim, which would otherwise decide the side for itself', () => {
    // `straight` and `arc` meet a node wherever the ray crosses it. An anchor is not a hint about
    // which crossing to prefer — it names the side, and a straight edge told to leave the north one
    // leaves the middle of the top.
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 400, y: 0 }, 'straight', 0, 0, box, { source: 'n' });

    expect(route.from).toEqual({ x: 0, y: -40 });
  });

  it('pins one end without touching the other', () => {
    // The ordinary case: somebody fixes the end that was wrong and leaves the rest alone.
    const anchored = routeEdge('e', { x: 0, y: 0 }, { x: 400, y: 0 }, 'smooth', 0, box, box, { source: 'n' });
    const derived = routeEdge('e', { x: 0, y: 0 }, { x: 400, y: 0 }, 'smooth', 0, box, box);

    expect(anchored.to).toEqual(derived.to);
    expect(anchored.from).not.toEqual(derived.from);
  });

  it('routes an unanchored edge exactly as it always did', () => {
    // The property that makes this safe to add: every edge on every existing graph is unanchored, so
    // passing no anchors has to be indistinguishable from the code that had no idea they existed.
    for (const curve of ['straight', 'smooth', 'step', 'arc'] as const) {
      const before = routeEdge('e', { x: 0, y: 0 }, { x: 300, y: 90 }, curve, 20, box, box);
      const after = routeEdge('e', { x: 0, y: 0 }, { x: 300, y: 90 }, curve, 20, box, box, {});

      expect(after).toEqual(before);
    }
  });
});

/**
 * What the router reads an anchor out of, and what it refuses.
 *
 * The data bag is shared, writable and peer-to-peer: what is in it was put there by whoever last
 * wrote the record, and a value the router took at face value would land an endpoint at `NaN` — a
 * line that draws nothing and reports nothing.
 */
/*
  Where an end routes to while something has hold of it.

  One rule, in the core, because two things read it: the router draws the line and the renderer
  places the grips along it. They used to answer separately, and the grips froze at the settled
  endpoints while the line they belong to followed the pointer.
*/
/*
  Offering a new bend, in the gap somebody is pointing at.

  The reported fault: pressing a faint dot between two bends sometimes pinched the line somewhere
  else, occasionally past the next bend entirely. The offers were placed by cutting the route into
  equal lengths, one per gap — but a bend sits wherever it was put, so the k-th equal division is
  not the k-th gap. The dot was drawn in one place and its press spliced a point into the list at
  another, and the line kinked at neither.
*/
describe('bendPoints', () => {
  /** A straight run left to right, sampled the way `polyline` returns one. */
  const line = Array.from({ length: 101 }, (_, index) => ({ x: index, y: 0 }));

  it('offers one gap on a route with no bends, at its middle', () => {
    expect(bendPoints(line, [])).toEqual([{ x: 50, y: 0 }]);
  });

  it('puts each offer between the bends it actually sits between', () => {
    // The bend is at 90 — far down the line. The second offer belongs BETWEEN it and the end.
    const [before, after] = bendPoints(line, [{ x: 90, y: 0 }]);

    expect(before.x).toBeCloseTo(45, 5);
    expect(after.x).toBeCloseTo(95, 5);
  });

  it('is the failure it was: equal division would put the second offer before the bend', () => {
    // The old placement was (index + 0.5) / (n + 1) of the whole length — 0.75 here, or x=75,
    // which is BEFORE the bend at 90 while splicing after it. That is the pinch.
    const [, after] = bendPoints(line, [{ x: 90, y: 0 }]);

    expect(after.x).toBeGreaterThan(90);
  });

  it('offers one more than there are bends', () => {
    expect(
      bendPoints(line, [
        { x: 20, y: 0 },
        { x: 60, y: 0 },
      ]),
    ).toHaveLength(3);
  });

  it('keeps the offers in order when a route doubles back', () => {
    // A bend can project onto an earlier leg than its neighbour, which would invert two gaps and
    // offer them inside out. The fractions are clamped non-decreasing instead.
    const offers = bendPoints(line, [
      { x: 70, y: 0 },
      { x: 30, y: 0 },
    ]);

    expect(offers[0].x).toBeLessThanOrEqual(offers[1].x);
    expect(offers[1].x).toBeLessThanOrEqual(offers[2].x);
  });

  it('answers for a route of no length rather than dividing by it', () => {
    expect(
      bendPoints(
        [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
        [],
      ),
    ).toEqual([{ x: 5, y: 5 }]);
  });
});

describe('pointAlong and fractionAlong', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 30 },
  ];

  it('walks by length rather than by sample index', () => {
    // Half of 40 is 20, which is ten down the second leg — not the midpoint of the two legs.
    expect(pointAlong(line, 0.5)).toEqual({ x: 10, y: 10 });
  });

  it('clamps a fraction outside the line', () => {
    expect(pointAlong(line, -1)).toEqual({ x: 0, y: 0 });
    expect(pointAlong(line, 2)).toEqual({ x: 10, y: 30 });
  });

  it('measures a point back to the fraction it sits at', () => {
    expect(fractionAlong(line, { x: 10, y: 10 })).toBeCloseTo(0.5, 5);
  });

  it('projects a point that is not on the line onto the nearest leg', () => {
    expect(fractionAlong(line, { x: 5, y: 40 })).toBeCloseTo(fractionAlong(line, { x: 10, y: 30 }), 1);
  });
});

describe('endOf', () => {
  it('falls back to the edge\u2019s own end when nothing is overlaid', () => {
    expect(endOf(undefined, 'source', 'a')).toEqual({ node: 'a', loose: null });
    expect(endOf({ targetAnchor: 'n' }, 'target', 'b')).toEqual({ node: 'b', loose: null });
  });

  it('takes the node an overlay names \u2014 a re-attachment being previewed', () => {
    expect(endOf({ target: 'c' }, 'target', 'b')).toEqual({ node: 'c', loose: null });
  });

  it('treats an empty name as no name, which is how a landing is withdrawn', () => {
    expect(endOf({ target: '' }, 'target', 'b')).toEqual({ node: 'b', loose: null });
  });

  it('takes a bare point, which is what a dragged end follows', () => {
    expect(endOf({ targetX: 12, targetY: 34 }, 'target', 'b')).toEqual({ node: 'b', loose: { x: 12, y: 34 } });
  });

  it('needs both halves, since half a point is not one', () => {
    expect(endOf({ targetX: 12 }, 'target', 'b').loose).toBeNull();
    expect(endOf({ targetY: 34 }, 'target', 'b').loose).toBeNull();
  });

  it('reads each end separately', () => {
    const patch = { source: 'c', targetX: 12, targetY: 34 };
    expect(endOf(patch, 'source', 'a')).toEqual({ node: 'c', loose: null });
    expect(endOf(patch, 'target', 'b')).toEqual({ node: 'b', loose: { x: 12, y: 34 } });
  });
});

describe('anchorsOf', () => {
  it('reads the four sides', () => {
    expect(anchorsOf({ sourceAnchor: 'n', targetAnchor: 'w' })).toEqual({ source: 'n', target: 'w' });
  });

  it('treats an empty string as no anchor, which is how one is cleared', () => {
    expect(anchorsOf({ sourceAnchor: '', targetAnchor: 'e' })).toEqual({ source: undefined, target: 'e' });
  });

  it('drops anything that is not a side', () => {
    expect(anchorsOf({ sourceAnchor: 'north', targetAnchor: 7 })).toEqual({ source: undefined, target: undefined });
  });

  it('answers for an edge carrying no data at all', () => {
    expect(anchorsOf(undefined)).toEqual({ source: undefined, target: undefined });
  });
});

/**
 * Waypoints — points somebody put a connection through, so it can be taken round what is in the way.
 *
 * Two things decide whether they are any good, and neither is the curve maths. They have to survive
 * either card being moved, which is what the stored frame is for; and the shape drawn has to be the
 * shape the handles are on, which is what interpolating rather than approximating is for.
 */
describe('the frame a waypoint is stored in', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 0 };

  it('round-trips a point through the frame and back', () => {
    const world = { x: 40, y: 30 };

    expect(waypointToWorld(waypointFromWorld(world, from, to), from, to)).toEqual(world);
  });

  it('follows the cards when they move, which is the whole reason for it', () => {
    /*
      The decision this file is really about. In world coordinates a bend is a pair of numbers that
      stops meaning anything the moment either end moves — so the first time somebody tidies a canvas,
      every hand-drawn route doglegs through empty space. Stored along and across the span, the shape
      travels with the cards: a point a quarter along and a tenth to the side stays there.
    */
    const point = waypointFromWorld({ x: 25, y: 10 }, from, to);
    const moved = waypointToWorld(point, { x: 200, y: 200 }, { x: 400, y: 200 });

    // Twice the span, so a quarter along is 50 from the new source and the sideways reach doubles.
    expect(moved).toEqual({ x: 250, y: 220 });
  });

  it('turns with the pair, not with the screen', () => {
    // The same point, with the target moved to sit *below* the source: the bend rotates with the
    // frame rather than staying to the right of it, which is what keeps a route recognisable.
    const point = waypointFromWorld({ x: 50, y: 20 }, from, to);
    const turned = waypointToWorld(point, from, { x: 0, y: 100 });

    expect(turned.x).toBeCloseTo(-20, 5);
    expect(turned.y).toBeCloseTo(50, 5);
  });

  it('does not divide by zero when the two ends are in the same place', () => {
    expect(() => waypointFromWorld({ x: 5, y: 5 }, from, from)).not.toThrow();
    expect(Number.isFinite(waypointToWorld({ along: 0.5, across: 0 }, from, from).x)).toBe(true);
  });
});

describe('a route through waypoints', () => {
  const box = { halfWidth: 30, halfHeight: 20 };

  it('passes through every point it was given', () => {
    /*
      Interpolating, not approximating. A B-spline would be smoother and would miss every waypoint,
      which puts the handle somewhere the line is not — and a handle that is not on the thing it
      moves is the one kind of control nobody can use.
    */
    const through = [
      { x: 100, y: -80 },
      { x: 200, y: 60 },
    ];
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 300, y: 0 }, 'smooth', 0, box, box, {}, through);

    expect(route.segments).toBeDefined();
    // Three legs: source → first point → second point → target.
    expect(route.segments).toHaveLength(3);
    expect(route.segments![0].to).toEqual(through[0]);
    expect(route.segments![1].to).toEqual(through[1]);
  });

  it('leaves each node facing its nearest point, not the far one', () => {
    /*
      A line bent up and over leaves its source *upwards*. Attaching toward a target it no longer
      heads for would start the route on the wrong side of the card and then double back across it —
      which is the one thing a route drawn to avoid something must not do.
    */
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 300, y: 0 }, 'smooth', 0, box, box, {}, [{ x: 0, y: -200 }]);

    // Straight up from the source, so it leaves the top rather than the right-hand side.
    expect(route.from).toEqual({ x: 0, y: -20 });
  });

  it('joins the points with straight legs when the edge is drawn straight', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 300, y: 0 }, 'straight', 0, box, box, {}, [{ x: 150, y: 90 }]);

    expect(route.segments!.every((segment) => !segment.control)).toBe(true);
  });

  it('turns a corner per leg when the edge is drawn as steps', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 300, y: 0 }, 'step', 0, box, box, {}, [{ x: 150, y: 90 }]);

    // Two legs, two corners each, so four segments — and never a curve among them.
    expect(route.segments).toHaveLength(4);
    expect(route.segments!.every((segment) => !segment.control)).toBe(true);
  });

  it('ignores the lane offset, an explicit route being separate already', () => {
    // Fanning is how two edges nobody has shaped are told apart. A route somebody drew is already
    // distinguishable from whatever it was drawn around, and shifting it would move it off the
    // points it was put through.
    const bowed = routeEdge('e', { x: 0, y: 0 }, { x: 300, y: 0 }, 'smooth', 60, box, box, {}, [{ x: 150, y: 90 }]);
    const plain = routeEdge('e', { x: 0, y: 0 }, { x: 300, y: 0 }, 'smooth', 0, box, box, {}, [{ x: 150, y: 90 }]);

    expect(bowed).toEqual(plain);
  });

  it('carries none of the single-span fields, which describe a shape it no longer is', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 300, y: 0 }, 'smooth', 0, box, box, {}, [{ x: 150, y: 90 }]);

    expect(route.control).toBeUndefined();
    expect(route.control2).toBeUndefined();
    expect(route.elbows).toBeUndefined();
  });

  it('puts the label half-way along the shape rather than between the two nodes', () => {
    // A bent route's midpoint is nowhere near the chord's, and a label at the chord's would sit off
    // the line it belongs to — which is the same trap the quadratic and cubic cases document.
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 300, y: 0 }, 'smooth', 0, box, box, {}, [{ x: 150, y: 200 }]);

    expect(route.mid.y).toBeGreaterThan(100);
  });

  it('is measurable, so a bent line can still be picked', () => {
    // Picking is geometric and shared with the renderer. A shape `polyline` could not walk would be
    // a line you can see and cannot click.
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 300, y: 0 }, 'smooth', 0, box, box, {}, [{ x: 150, y: 200 }]);

    expect(distanceToEdge({ x: 150, y: 200 }, route)).toBeLessThan(1);
    expect(distanceToEdge({ x: 150, y: 0 }, route)).toBeGreaterThan(50);
  });
});

/**
 * What the router reads waypoints out of, and everything it refuses.
 *
 * The blob is whatever the last writer wrote — possibly an older version of this code, possibly
 * something that is not this code at all. A route that threw on one bad record would take the whole
 * canvas's rendering down with it, so every malformed shape answers with no waypoints.
 */
describe('waypointsOf', () => {
  it('reads a stored list', () => {
    expect(waypointsOf({ waypoints: '[{"along":0.5,"across":0.2}]' })).toEqual([{ along: 0.5, across: 0.2 }]);
  });

  it('answers nothing for an edge that carries none', () => {
    expect(waypointsOf(undefined)).toEqual([]);
    expect(waypointsOf({})).toEqual([]);
    expect(waypointsOf({ waypoints: '' })).toEqual([]);
  });

  it('answers nothing rather than throwing on a blob that is not JSON', () => {
    expect(waypointsOf({ waypoints: 'not json' })).toEqual([]);
  });

  it('answers nothing for JSON that is not a list', () => {
    expect(waypointsOf({ waypoints: '{"along":0.5}' })).toEqual([]);
  });

  it('drops the entries that are not points, keeping the ones that are', () => {
    // Half a route is better than none: the points that parse are still where somebody put them.
    expect(
      waypointsOf({ waypoints: '[{"along":0.5,"across":0},null,{"along":"x","across":1},{"along":1,"across":1}]' }),
    ).toEqual([
      { along: 0.5, across: 0 },
      { along: 1, across: 1 },
    ]);
  });

  it('drops a point carrying an infinity, which would route to nowhere', () => {
    expect(waypointsOf({ waypoints: '[{"along":1e999,"across":0}]' })).toEqual([]);
  });
});

/**
 * When an optimistic route edit is finished with.
 *
 * The bug this exists for: the first version compared anchors and nothing else, so a waypoint draft
 * compared equal to the data it was standing in front of. The draft was dropped on the frame after
 * it was set, the overlay went with it, and dragging a point did visibly nothing — a whole gesture
 * that ran, wrote, and never appeared. Nothing failed; the wrong question was asked.
 */
describe('routesAlike', () => {
  it('is unsettled while a waypoint draft says something the data does not', () => {
    const stored = { sourceAnchor: 'n' };
    const drafted = { sourceAnchor: 'n', waypoints: '[{"along":0.5,"across":0.2}]' };

    expect(routesAlike(stored, drafted)).toBe(false);
  });

  it('is unsettled while an anchor draft says something the data does not', () => {
    expect(routesAlike({}, { sourceAnchor: 'e' })).toBe(false);
  });

  it('is settled once the data carries both halves', () => {
    const shape = { sourceAnchor: 'n', waypoints: '[{"along":0.5,"across":0.2}]' };

    expect(routesAlike(shape, { ...shape })).toBe(true);
  });

  it('settles a cleared anchor, which the data answers by omitting the field', () => {
    // The other half of the same question, and why this is not a literal compare: an update writes
    // `''` and the seed drops the field, so `'' === undefined` would never be true and the overlay
    // would outlive the graph.
    expect(routesAlike({}, { sourceAnchor: '' })).toBe(true);
  });

  it('settles a straightened route the same way', () => {
    expect(routesAlike({}, { waypoints: '[]' })).toBe(true);
  });

  it('notices a point that moved, not merely one that appeared', () => {
    const before = { waypoints: '[{"along":0.5,"across":0.2}]' };
    const after = { waypoints: '[{"along":0.5,"across":0.4}]' };

    expect(routesAlike(before, after)).toBe(false);
  });

  it('notices a point that was removed from the middle', () => {
    const before = { waypoints: '[{"along":0.3,"across":0},{"along":0.7,"across":0}]' };
    const after = { waypoints: '[{"along":0.7,"across":0}]' };

    expect(routesAlike(before, after)).toBe(false);
  });
});

/**
 * A line meets the shape somebody can see, not the box it was cut out of.
 *
 * Routing used the card's box, and a card is *drawn* clipped to an outline inside it. Where the
 * outline happens to touch the box — the middle of a square's side, a diamond's vertex, an
 * ellipse's widest point — nothing looked wrong, which is why this survived: the shapes that gap
 * are the ones whose sides are inset, and on a 180px card a triangle's are inset by 45px, a quarter
 * of its width, so the line stopped in mid-air.
 *
 * Measured against the same table the renderer clips with, so a change to a shape moves both.
 */
describe('attaching to a card’s outline', () => {
  const from = { x: 0, y: 0 };
  /** A 180 × 135 card, centred 400 to the right: the workshop's own default card. */
  const card = (shape?: 'triangle' | 'diamond' | 'pentagon' | 'hexagon' | 'round' | 'square' | 'note') => ({
    halfWidth: 90,
    halfHeight: 67.5,
    ...(shape ? { shape } : {}),
  });
  /** How far short of the card's centre the line stops, approaching from the left. */
  const reachOf = (shape?: Parameters<typeof card>[0], to = { x: 400, y: 0 }) =>
    Math.hypot(
      to.x - routeEdge('e', from, to, 'smooth', 0, card(shape)).to.x,
      to.y - routeEdge('e', from, to, 'smooth', 0, card(shape)).to.y,
    );

  it('meets a square and a note on the box, which is what they are', () => {
    expect(reachOf('square')).toBeCloseTo(90, 5);
    expect(reachOf('note')).toBeCloseTo(90, 5);
    expect(reachOf()).toBeCloseTo(90, 5);
  });

  it('meets a triangle’s side where the side is, not 45px out in space', () => {
    // The loud one: at mid-height the triangle spans the middle half of its box.
    expect(reachOf('triangle')).toBeCloseTo(45, 5);
  });

  it('meets a pentagon just inside its box', () => {
    // 6px on a 180 card — small, and visible once you know it is there.
    expect(reachOf('pentagon')).toBeCloseTo(83.73, 1);
  });

  it('leaves the shapes whose outline touches the box exactly where they were', () => {
    // A diamond's and a hexagon's vertices are on the box's side midpoints, and an ellipse's widest
    // point is too — these never gapped, and the change must not move them.
    expect(reachOf('diamond')).toBeCloseTo(90, 5);
    expect(reachOf('hexagon')).toBeCloseTo(90, 5);
    expect(reachOf('round')).toBeCloseTo(90, 5);
  });

  it('meets a round card on its ellipse from any direction, not on its box', () => {
    // The diagonal is where a box and an ellipse disagree most: 19px apart on this card.
    const to = { x: 300, y: -300 };
    const route = routeEdge('e', from, to, 'straight', 0, card('round'));
    const reach = Math.hypot(to.x - route.to.x, to.y - route.to.y);

    expect(reach).toBeCloseTo(76.37, 1);
  });

  it('meets a diamond on the chord a straight edge travels', () => {
    // 41px of daylight before: the box's corner is a long way outside a diamond.
    const to = { x: 300, y: -300 };
    const route = routeEdge('e', from, to, 'straight', 0, card('diamond'));

    expect(Math.hypot(to.x - route.to.x, to.y - route.to.y)).toBeCloseTo(54.55, 1);
  });

  it('keeps the standoff the same distance whichever way the line leaves', () => {
    /*
      The gap an arrowhead needs is a distance from the outline, so it travels with the shape rather
      than inflating the box — which would move a triangle's sides and its corners by different
      amounts, and leave the head sitting at neither.
    */
    const plain = routeEdge('e', from, { x: 400, y: 0 }, 'smooth', 0, card('triangle'));
    const stood = routeEdge('e', from, { x: 400, y: 0 }, 'smooth', 0, { ...card('triangle'), gap: 6 });

    expect(plain.to.x - stood.to.x).toBeCloseTo(6, 5);
  });

  it('anchors to the side of the shape, not the side of the box', () => {
    // An anchor says which side; what the side *is* is the shape's business.
    const route = routeEdge('e', from, { x: 400, y: 0 }, 'smooth', 0, card('triangle'), 0, { target: 'w' });

    expect(route.to.x).toBeCloseTo(355, 5);
  });
});
