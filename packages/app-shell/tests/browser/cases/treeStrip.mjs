/**
 * The canvas's reading strip: can a reader see it, and reach it?
 *
 * The assertion that matters is the one that could not be written before this harness existed, and its
 * absence is exactly what shipped. The strip renders, has the right size, holds the right controls and
 * is in the tree — and it sat *underneath* the pinned bar of pills the workshop puts over the whole
 * route, so nothing was visible and nothing could be pressed. The jsdom suite asserted the node existed
 * and passed; it took somebody deleting the pills in devtools to find it.
 *
 * Overlap is therefore the subject, not position. "Is its `y` less than some number" would be a second
 * copy of an expression over the control-height token and a theme's offset to it — the exact drift the
 * template's own band comment records happening once already. Measuring both boxes and asking whether
 * they intersect needs no number at all.
 *
 * Swept across widths because the strip is the only chrome on a surface that has none, it wraps, and a
 * strip that grows downward on a narrow canvas covers the cards it exists to help read.
 */
export const name = 'canvas reading strip';
export const scenario = 'canvas:tree-strip';
export const widths = [360, 520, 900];

/** The container's own height, as the scenario sets it. */
const BOX_HEIGHT = 420;
/** The mode button's words while the canvas is freeform — the strip's one always-present control. */
const TOGGLE = 'Tree';
/** The stand-in for the pinned pill bar, at the band's own top and height. */
const PILL = 'Call pill';

export async function check({ measureText, measureAll }, width) {
  const problems = [];

  const toggle = await measureText(TOGGLE);
  if (!toggle) return [`the mode button "${TOGGLE}" is nowhere in the tree`];
  const pill = await measureText(PILL);
  if (!pill) return [`the stand-in "${PILL}" is nowhere in the tree — the scenario is not reproducing the chrome`];

  /*
    The whole bug, as one comparison. The pill bar is drawn over the route, so a strip whose box
    intersects it is a strip nobody can see or press — and every other thing about it is correct.
  */
  const overlaps = toggle.y < pill.y + pill.h && pill.y < toggle.y + toggle.h;
  if (overlaps) {
    problems.push(
      `the strip (y ${toggle.y}–${toggle.y + toggle.h}) is behind the pinned pills (y ${pill.y}–${pill.y + pill.h})`,
    );
  }

  /*
    Below them rather than merely clear of them. A strip that cleared the bar by going *above* it would
    satisfy the overlap test and be off the top of the canvas.
  */
  if (toggle.y < pill.y) problems.push(`the strip is above the pinned pills, at y=${toggle.y}`);

  // Inside the box, which is what `overflow: hidden` on the route makes load-bearing.
  if (toggle.y + toggle.h > BOX_HEIGHT) {
    problems.push(`the strip runs to y=${toggle.y + toggle.h} in a ${BOX_HEIGHT}px box — clipped`);
  }
  // And near the top of it: this is chrome in a corner, not a panel floating in the middle of the canvas.
  if (toggle.y > BOX_HEIGHT / 3) problems.push(`the strip is ${toggle.y}px down — not in the canvas's corner`);

  // Inset from the left edge rather than flush against it, which is the other half of "in the corner".
  if (toggle.x <= 0 || toggle.x > width / 2) problems.push(`the strip starts at x=${toggle.x} in a ${width}px box`);

  // It has a size. A control collapsed to nothing is present, hittable in theory and unusable.
  if (toggle.w < 24 || toggle.h < 16) problems.push(`the mode button is ${toggle.w}×${toggle.h} — collapsed`);

  /*
    Nothing in the strip reaches past the container.

    It wraps, so the failure is less an overflow than a strip taller than the corner it should occupy —
    which on a narrow canvas covers the first row of cards. The width bound catches the other direction.
  */
  const parts = (await measureAll('we-button, we-select, we-divider')).filter((b) => b.w && b.h);
  for (const part of parts) {
    if (part.x + part.w > width + 1) {
      problems.push(`a control runs to x=${part.x + part.w} past the ${width}px box`);
      break;
    }
  }

  return problems;
}
