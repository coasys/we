/**
 * The renderer's only remaining piece of geometry.
 *
 * Everything about *where* an edge runs now lives in the core, so what is left here is a translation:
 * world-space control points into one drawing syntax. Worth a test because it is the seam — a canvas
 * renderer would write the same three cases into `quadraticCurveTo` and must agree with this one, or
 * two renderers would draw the same graph differently.
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
    const route = { ...base, curve: 'bezier', control: { x: 50, y: -30 } } as EdgeGeometry;
    expect(pathFrom(route)).toBe('M 0 0 Q 50 -30 100 50');
  });

  it('draws an orthogonal route through its elbow', () => {
    const route = { ...base, curve: 'orthogonal', elbow: { x: 50, y: 0 } } as EdgeGeometry;
    expect(pathFrom(route)).toBe('M 0 0 L 50 0 L 50 50 L 100 50');
  });

  it('prefers the elbow when a route somehow carries both', () => {
    // Defensive rather than expected: the orthogonal branch is the more constrained shape, so it wins.
    const route = {
      ...base,
      curve: 'orthogonal',
      elbow: { x: 50, y: 0 },
      control: { x: 10, y: 10 },
    } as EdgeGeometry;
    expect(pathFrom(route)).toContain('L 50 0');
  });
});
