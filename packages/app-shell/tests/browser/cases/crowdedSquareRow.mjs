/**
 * A square button stays square in a row that has run out of room.
 *
 * `square` sets an explicit width and height on the host, which reads as a promise and is not one:
 * in a flex row an explicit width is a BASIS, and every item that may shrink gives some of it up in
 * proportion. A square button's min-content is a single glyph, so there is a long way for it to
 * fall — the call pill's controls arrived at roughly 24px inside a 40px declaration and read as
 * rectangles, while the title beside them, which could have truncated, had barely started to.
 *
 * Invisible to jsdom twice over: it does no layout at all, and the markup is well-formed either
 * way. The element measures exactly what it was told to be at every level a schema test can reach —
 * the attribute is set, the custom property is set, the declaration is in the sheet — and the box on
 * screen is still the wrong shape. That is the whole reason this harness exists.
 *
 * Addressed by id rather than by the words on screen, unlike most cases here, because the subject is
 * three anonymous boxes: an icon-only button has no text to find it by.
 */
export const name = 'a square button stays square in a crowded row';
export const scenario = 'ds:crowded-square-row';
export const widths = [900];

export async function check({ measure }) {
  const problems = [];

  const lead = await measure('#lead');
  const title = await measure('#title');
  const trail = await measure('#trail');
  if (!lead || !title || !trail) return ['expected two square buttons and a title'];

  /*
    Square, to the pixel.

    Stated as a ratio against each button's own height rather than against 40px, so the component
    height scale and a theme's `controlHeightOffset` can both move without failing this. A pixel of
    tolerance because boxes are measured rounded; the failure this exists for was 16px wide.
  */
  for (const [label, btn] of [
    ['leading', lead],
    ['trailing', trail],
  ]) {
    if (Math.abs(btn.w - btn.h) > 1) {
      problems.push(`the ${label} button is ${btn.w}×${btn.h} — squeezed out of square by ${btn.h - btn.w}px`);
    }
  }

  /*
    And the row is still a row: the title is the thing that gave way, so it must have been asked to.

    Without this a pair of buttons that refused to shrink could pass by pushing the title off the
    end instead — the panel row's failure rather than the pill's, and the same declaration fixes
    both, so both belong in one case.
  */
  if (title.w < 24) problems.push(`the title is ${title.w}px wide — collapsed rather than truncated`);
  if (title.h > 32) problems.push(`the title is ${title.h}px tall — it wrapped instead of truncating`);

  const row = [lead, title, trail];
  for (let i = 1; i < row.length; i++) {
    const prev = row[i - 1];
    const here = row[i];
    if (here.x < prev.x + prev.w) {
      problems.push(`items overlap: one starts at ${here.x}, the one before it ends at ${prev.x + prev.w}`);
    }
  }

  return problems;
}
