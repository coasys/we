/**
 * The provenance line stays on one row while there is room for one.
 *
 * Wrapping is wanted when the box is genuinely too narrow — the sentence should break at a word and
 * carry on underneath. What is not wanted is a break with the panel half empty, which is what a
 * block-level box in a run of text produces whatever the width.
 *
 * So the measurement is the whole row's height against one line: at 420px "Added by you · 3 days
 * ago" fits several times over, and two lines there can only mean something is refusing to be in
 * the sentence.
 */
export const name = 'provenance line';
export const scenario = 'inspector:provenance';
export const widths = [160, 420];

export async function check({ measure }, width) {
  const row = await measure('we-text');
  const time = await measure('we-timestamp');
  if (!row || !time) return ['no provenance line rendered'];

  const problems = [];

  // Wide: one line. "Added by you · 3 days ago" fits several times over, so two lines here can only
  // mean something is refusing to be part of the sentence.
  if (width >= 420 && row.h > 24) {
    problems.push(`the line is ${row.h}px tall with room to spare — it has broken rather than flowed`);
  }

  /*
    Narrow: it still wraps, and that is wanted.

    The fix could have been `nowrap`, which would pass the assertion above and quietly push the time
    out of the panel instead. So the narrow width asserts the opposite: at 160px the sentence is
    genuinely too long and is expected to take more than one line.
  */
  if (width <= 160 && row.h <= 24) {
    problems.push(`the line is ${row.h}px tall at ${width}px — it should wrap here rather than overflow`);
  }

  return problems;
}
