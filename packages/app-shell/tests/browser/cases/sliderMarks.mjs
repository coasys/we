/**
 * A mark sits where the thumb goes at its value.
 *
 * `we-slider` draws labelled marks beneath its track, placed from its own geometry: a range input's
 * thumb travels between its two half-widths, so a mark placed as a percentage of the track is half a
 * thumb out at each end — which is where a reader checks they have reached the start or the end.
 *
 * The check does not restate that arithmetic. It presses the real control on each mark's line and
 * reads back what the browser set the value to: if the mark is where the thumb goes at its value, a
 * press on it lands on that value. Three sizes, because the thumb is a different width at each.
 *
 * And the end labels stay over the control rather than hanging past it.
 */
export const name = 'a slider mark sits where the thumb goes at its value';
export const scenario = 'ds:slider-marks';
export const widths = [360, 720];

const EXPECTED = [0, 0.25, 0.5, 0.75, 1];

export async function check({ measureParts, measure, prop, pressAt, count }) {
  const problems = [];
  const sliders = await count('we-slider');
  if (sliders !== 3) return [`expected three sliders, found ${sliders}`];

  for (let nth = 0; nth < sliders; nth++) {
    const size = ['sm', 'md', 'lg'][nth];
    const lines = await measureParts('we-slider', 'mark-line', nth);
    if (lines.length !== EXPECTED.length) {
      problems.push(`${size}: ${lines.length} marks drawn, expected ${EXPECTED.length}`);
      continue;
    }
    const input = (await measureParts('we-slider', 'native', nth))[0];
    for (const [i, line] of lines.entries()) {
      await pressAt(line.cx, input.cy);
      const value = Number(await prop('we-slider', 'value', nth));
      // A pixel of travel is under two thousandths here; a mark half a thumb out is six or more, even at 720px.
      if (Math.abs(value - EXPECTED[i]) > 0.004) {
        problems.push(`${size}: pressing the mark for ${EXPECTED[i]} set ${value.toFixed(3)}`);
      }
    }
    const host = (await measure(`we-slider:nth-of-type(${nth + 1})`)) ?? null;
    const labels = await measureParts('we-slider', 'mark-label', nth);
    if (host && labels.length) {
      const first = labels[0];
      const last = labels[labels.length - 1];
      if (first.x < host.x - 1)
        problems.push(`${size}: the first label hangs ${Math.round(host.x - first.x)}px past the start`);
      if (last.x + last.w > host.x + host.w + 1) {
        problems.push(`${size}: the last label hangs ${Math.round(last.x + last.w - host.x - host.w)}px past the end`);
      }
    }
  }
  return problems;
}
