/**
 * A reaction reads as a mark with a footnote beside it, not a number with a decoration.
 *
 * At `xs` — what a comment thread draws — the glyph should be the larger of the two and the count a
 * step behind it. Both sizes are set through indirections that a reader cannot check by eye: the
 * icon's comes from the button's `--we-context-icon-size`, the count's from a `fontSize` handed to
 * `we-number`. Either can silently fail to arrive, and the only place that shows is a laid-out box.
 */
export const name = 'reaction at xs';
export const scenario = 'signals:reaction';
export const widths = [320];

export async function check({ measure }) {
  const problems = [];

  const glyph = await measure('we-icon');
  const count = await measure('we-number');
  if (!glyph || !count) return ['no reaction control rendered'];

  if (glyph.h < 14) problems.push(`the glyph is ${glyph.w}x${glyph.h} — too small to read as the control`);
  // The digits are a caption. Equal heights read as a number with a decoration beside it.
  if (count.h >= glyph.h) problems.push(`the count (${count.h}px) is not a step behind the glyph (${glyph.h}px)`);
  // And it is still a number somebody can read: a size that failed to arrive at all shows up as
  // *too big*, so the floor is what catches the day this is overcorrected instead.
  if (count.h < 8 || count.w < 4) problems.push(`the count is ${count.w}x${count.h} — too small to read`);

  return problems;
}
