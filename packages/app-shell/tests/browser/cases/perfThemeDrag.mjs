/**
 * What a frame of a theme-slider drag costs, against a large page.
 *
 * A report rather than a verdict, like the transcript case: milliseconds on this machine say little
 * about another, so nothing is asserted on them. Read the rows against each other — the document
 * alone, and the three roots the theme panel re-applies to; a change applied in full, and a frame of
 * a held slider, which measures nothing until it is let go — and against a frame's 16 ms.
 */
export const name = 'theme drag cost';
export const scenario = 'perf:theme-drag';
export const widths = [1100];
export const scales = [4];

export async function check({ themeDrag, count, note }) {
  note(`${await count('*')} elements`);
  for (const live of [false, true]) {
    for (const roots of [1, 3]) {
      const { median, max } = await themeDrag(30, roots, live);
      note(
        `${live ? 'held slider' : 'one change'}, ${roots} root${roots > 1 ? 's' : ''}: median ${median} ms, worst ${max} ms`,
      );
    }
  }
  return [];
}
