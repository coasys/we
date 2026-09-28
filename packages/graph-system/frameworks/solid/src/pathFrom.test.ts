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

type P = { x: number; y: number };
const bezier = (a: P, b: P, c: P, d: P, t: number): P => {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
};

/** The points a path string draws through, finely enough to compare two strokes. */
const traced = (path: string): P[] => {
  const tokens = path.split(' ');
  const out: P[] = [];
  let at: P = { x: 0, y: 0 };
  const next = (): P => ({ x: Number(tokens[i++]), y: Number(tokens[i++]) });
  let i = 0;
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'M' || command === 'L') {
      at = next();
      out.push(at);
    } else if (command === 'C') {
      const [c1, c2, end] = [next(), next(), next()];
      for (let k = 1; k <= 1024; k += 1) out.push(bezier(at, c1, c2, end, k / 1024));
      at = end;
    }
  }
  return out;
};

/** How far apart two strokes are at their furthest — the furthest any point of either lies from the other. */
const apart = (a: P[], b: P[]) => {
  const toLine = (point: P, line: P[]) => {
    let nearest = Infinity;
    for (let k = 1; k < line.length; k += 1) {
      const p = line[k - 1];
      const q = line[k];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const span = dx * dx + dy * dy;
      const t = span ? Math.max(0, Math.min(1, ((point.x - p.x) * dx + (point.y - p.y) * dy) / span)) : 0;
      nearest = Math.min(nearest, Math.hypot(point.x - (p.x + dx * t), point.y - (p.y + dy * t)));
    }
    return nearest;
  };
  return Math.max(...a.map((p) => toLine(p, b)), ...b.map((p) => toLine(p, a)));
};

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

  it('cuts a curve short along the curve itself, not along its chord', () => {
    // The line arrives travelling almost straight down, though the edge as a whole runs right, so the gap
    // comes off close to vertically — and the stroke still ends ON the curve, a gap's length back along it.
    const [a, b, c, d] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
    ];
    const route = { ...base, to: d, curve: 'smooth', control: b, control2: c } as EdgeGeometry;
    const stroked = traced(pathFrom(route, 10));
    const end = stroked[stroked.length - 1];

    expect(end.y).toBeCloseTo(90, 0);
    expect(Math.abs(end.x - 100)).toBeLessThan(1);
    // Every point of the stroke lies on the whole curve.
    const whole = Array.from({ length: 4097 }, (_, k) => bezier(a, b, c, d, k / 4096));
    expect(
      apart(
        stroked,
        whole.slice(
          0,
          whole.findIndex((p) => p.y > end.y + 1e-9),
        ),
      ),
    ).toBeLessThan(0.05);
  });

  it('strokes one line the same whether it is drawn as one piece or several', () => {
    /*
      Why a curve is cut rather than having its end dragged back. Moving the end without its controls
      reshapes the last piece by an amount that depends on how long that piece is — so the same line drawn
      in one piece and in two was stroked into two different shapes. A switch that ends by redrawing a line
      from two pieces into one showed that as a bend on its very last frame.
    */
    const [a, b, c, d] = [
      { x: 0, y: 0 },
      { x: 150, y: 0 },
      { x: 0, y: 300 },
      { x: 200, y: 300 },
    ];
    const whole = { ...base, to: d, curve: 'smooth', control: b, control2: c } as EdgeGeometry;
    // The same curve, cut in two at its middle (de Casteljau).
    const mix = (p: P, q: P, t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    const [ab, bc, cd] = [mix(a, b, 0.5), mix(b, c, 0.5), mix(c, d, 0.5)];
    const [abc, bcd] = [mix(ab, bc, 0.5), mix(bc, cd, 0.5)];
    const middle = mix(abc, bcd, 0.5);
    const halves = {
      ...base,
      to: d,
      curve: 'smooth',
      segments: [
        { control: ab, control2: abc, to: middle },
        { control: bcd, control2: cd, to: d },
      ],
    } as EdgeGeometry;

    expect(apart(traced(pathFrom(whole, 12)), traced(pathFrom(halves, 12)))).toBeLessThan(0.01);
  });

  it('leaves a route alone when the gap would consume it', () => {
    // A node dropped almost on top of its neighbour still gets a line rather than one running
    // backwards through itself.
    const route = { ...base, to: { x: 4, y: 0 }, curve: 'straight' } as EdgeGeometry;
    expect(pathFrom(route, 10)).toBe('M 0 0 L 4 0');
  });

  it('walks back through short straight legs until it has covered the gap', () => {
    /*
      A chain of straight legs shorter than the arrowhead. Reading the one point before the end answers
      "no room" and hands back the end untouched, which is the line running under the whole arrowhead —
      the case this back-off exists to stop, reappearing on the shape least likely to be checked.

      Reachable on a canvas by bending a line twice near its target, and reached on every frame of a
      route that is part way through a change of bend, which is drawn through several dozen short legs.
    */
    const route = {
      ...base,
      to: { x: 100, y: 12 },
      curve: 'smooth',
      segments: [{ to: { x: 100, y: 0 } }, { to: { x: 100, y: 6 } }, { to: { x: 100, y: 12 } }],
    } as EdgeGeometry;
    // The line arrives travelling straight DOWN through two 6-unit legs, so the gap comes off y alone.
    // Falling back to the route's start instead gives the chord, which is almost horizontal here.
    expect(pathFrom(route, 10)).toBe('M 0 0 L 100 0 L 100 6 L 100 2');
  });

  it("cuts a bent route's curved last leg along that leg", () => {
    // A splined route's last leg carries controls, so it is cut like any curve — and the walk back through
    // straight legs above must not claim it.
    const route = {
      ...base,
      to: { x: 100, y: 100 },
      curve: 'smooth',
      segments: [
        { control: { x: 0, y: 40 }, control2: { x: 20, y: 50 }, to: { x: 50, y: 50 } },
        { control: { x: 80, y: 50 }, control2: { x: 100, y: 60 }, to: { x: 100, y: 100 } },
      ],
    } as EdgeGeometry;
    const stroked = traced(pathFrom(route, 10));
    const end = stroked[stroked.length - 1];
    // The leg arrives travelling almost straight down, so ten units back along it is close to (100, 90).
    expect(Math.hypot(end.x - 100, end.y - 90)).toBeLessThan(1);
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

    // Twenty units back ALONG the leg, so a chord a little shorter than twenty.
    expect(Math.hypot(200 - x, 0 - y)).toBeCloseTo(20, 0);
    expect(y).toBeLessThan(0);
  });
});
