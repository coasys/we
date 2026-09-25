/**
 * The renderer's only remaining piece of geometry.
 *
 * Everything about *where* an edge runs lives in the core, so what is left here is a translation:
 * world-space control points into one drawing syntax, plus the gap an arrowhead needs. Worth a test
 * because it is the seam — a canvas renderer would write the same four cases into `quadraticCurveTo`
 * and `bezierCurveTo` and must agree with this one, or two renderers would draw the same graph
 * differently.
 */
import type { EdgeGeometry } from '@we/graph-protocol';
import { describe, expect, it } from 'vitest';

import { pathFrom } from './GraphView.solid';

const base = { id: 'e', from: { x: 0, y: 0 }, to: { x: 100, y: 50 }, mid: { x: 50, y: 25 } };

describe('pathFrom', () => {
  it('draws a line for a route with no control point', () => {
    expect(pathFrom({ ...base, curve: 'straight' } as EdgeGeometry)).toBe('M 0 0 L 100 50');
  });

  it('draws a quadratic through the control point', () => {
    const route = { ...base, curve: 'arc', control: { x: 50, y: -30 } } as EdgeGeometry;
    expect(pathFrom(route)).toBe('M 0 0 Q 50 -30 100 50');
  });

  it('draws a cubic when a second control point makes the route smooth', () => {
    const route = {
      ...base,
      curve: 'smooth',
      control: { x: 50, y: 0 },
      control2: { x: 50, y: 50 },
    } as EdgeGeometry;
    expect(pathFrom(route)).toBe('M 0 0 C 50 0 50 50 100 50');
  });

  it('draws a step through both of its corners', () => {
    const route = {
      ...base,
      curve: 'step',
      elbows: [
        { x: 50, y: 0 },
        { x: 50, y: 50 },
      ],
    } as EdgeGeometry;
    expect(pathFrom(route)).toBe('M 0 0 L 50 0 L 50 50 L 100 50');
  });

  it('prefers the corners when a route somehow carries both', () => {
    // Defensive rather than expected: the step branch is the more constrained shape, so it wins.
    const route = {
      ...base,
      curve: 'step',
      elbows: [{ x: 50, y: 0 }],
      control: { x: 10, y: 10 },
    } as EdgeGeometry;
    expect(pathFrom(route)).toContain('L 50 0');
  });

  /*
    The arrow gap.

    The stroke stops an arrowhead's length short so the head sits at the end of the line rather than
    on top of it — the marker's base is at the path end, and without this the line would run out from
    under the triangle and show its edges either side of the tip.
  */
  it('ends the stroke short by the gap, along the closing direction', () => {
    const route = { ...base, to: { x: 100, y: 0 }, curve: 'straight' } as EdgeGeometry;
    expect(pathFrom(route, 10)).toBe('M 0 0 L 90 0');
  });

  it('backs off along the final tangent, not along the chord', () => {
    // Closing tangent runs straight down from the second control, so the gap comes off y alone even
    // though the edge as a whole travels right.
    const route = {
      ...base,
      to: { x: 100, y: 100 },
      curve: 'smooth',
      control: { x: 50, y: 0 },
      control2: { x: 100, y: 50 },
    } as EdgeGeometry;
    expect(pathFrom(route, 10)).toBe('M 0 0 C 50 0 100 50 100 90');
  });

  it('leaves a route alone when the gap would consume it', () => {
    // A node dropped almost on top of its neighbour still gets a line rather than one running
    // backwards through itself.
    const route = { ...base, to: { x: 4, y: 0 }, curve: 'straight' } as EdgeGeometry;
    expect(pathFrom(route, 10)).toBe('M 0 0 L 4 0');
  });
});

/**
 * A route somebody shaped by hand — several segments rather than one span.
 *
 * `segments` replaces `control`/`control2`/`elbows` rather than joining them, so this is the case
 * that has to be checked first. Written second, it would be unreachable for every bent route: a
 * cubic route carries a `control`, and the old branch would draw one span and drop everything after
 * the first waypoint — a line that ends in mid-air, drawn by code that ran without complaint.
 */
describe('pathFrom over a shaped route', () => {
  const bent: EdgeGeometry = {
    id: 'e',
    from: { x: 0, y: 0 },
    to: { x: 200, y: 0 },
    segments: [
      { control: { x: 30, y: -40 }, control2: { x: 70, y: -40 }, to: { x: 100, y: -40 } },
      { control: { x: 130, y: -40 }, control2: { x: 190, y: -30 }, to: { x: 200, y: 0 } },
    ],
    curve: 'smooth',
    mid: { x: 100, y: -40 },
  };

  it('draws one command per segment, from the start', () => {
    const path = pathFrom(bent);

    expect(path.startsWith('M 0 0 ')).toBe(true);
    expect(path.match(/C /g)).toHaveLength(2);
  });

  it('draws a straight leg as a line rather than inventing controls for it', () => {
    const polyline: EdgeGeometry = {
      ...bent,
      segments: [{ to: { x: 100, y: -40 } }, { to: { x: 200, y: 0 } }],
    };

    expect(pathFrom(polyline)).toBe('M 0 0 L 100 -40 L 200 0');
  });

  it('shortens only the last segment, so the arrowhead sits at the end of the whole route', () => {
    const gapped = pathFrom(bent, 20);

    // The first segment is untouched — it does not end at the target.
    expect(gapped).toContain('100 -40');
    // And the route no longer reaches the target's centre.
    expect(gapped.endsWith('200 0')).toBe(false);
  });

  it('backs off along the closing tangent of the last segment, not of the whole span', () => {
    // The last leg arrives steeply from above, so the gap is taken along *that* direction. Measured
    // from the chord — which runs flat from the source — it would come off horizontally and leave the
    // arrowhead beside the line rather than on the end of it.
    const shortened = pathFrom(bent, 20);
    const [x, y] = shortened.split(' ').slice(-2).map(Number);

    expect(Math.hypot(200 - x, 0 - y)).toBeCloseTo(20, 5);
    expect(y).toBeLessThan(0);
  });
});
