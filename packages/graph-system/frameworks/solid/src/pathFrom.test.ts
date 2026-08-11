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
