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

export async function check(api) {
  const { measure } = api;
  const problems = [];

  const glyph = await measure('we-icon');
  const count = await measure('we-number');
  if (!glyph || !count) return ['no reaction control rendered'];

  if (glyph.h < 14) problems.push(`the glyph is ${glyph.w}x${glyph.h} — too small to read as the control`);
  // The digits are a caption. Equal heights read as a number with a decoration beside it.
  if (count.h >= glyph.h) problems.push(`the count (${count.h}px) is not a step behind the glyph (${glyph.h}px)`);
  // And it is still a number somebody can read: a size that failed to arrive at all shows up as
  // *too big*, so the floor is what catches the day this is overcorrected instead.
  if (count.h < 10 || count.w < 5) problems.push(`the count is ${count.w}x${count.h} — too small to read`);

  /*
    They sit on the same centre line.

    `ay: 'center'` centres the BOXES, and the two boxes are different heights — so this drifts
    whenever either size changes, which is exactly what happened the first time the count's size
    reached the screen at all. A pixel of tolerance, since a line box and a glyph box round
    differently.
  */
  const drift = Math.abs(count.y + count.h / 2 - (glyph.y + glyph.h / 2));
  if (drift > 1) problems.push(`the count's centre is ${drift.toFixed(1)}px off the glyph's`);

  // Close enough to read as one thing. A mark and how many, not a glyph and then a number.
  const gap = count.x - (glyph.x + glyph.w);
  if (gap > 6) problems.push(`the glyph and its count are ${gap}px apart — they read as two things`);

  problems.push(...(await checkHover(api)));
  return problems;
}

/**
 * How far a box stands out from what it is painted on, 0..1.
 *
 * Distance rather than lightness, because "brighter" is not the rule — the rule is "more present",
 * and in a dark theme that means lighter while in a light theme it means darker.
 *
 * Opacity counts, and has to: holding a colour back is one of the two ways this control gets
 * quieter, and a comparison reading only the colour would call a pure-opacity hover "no response".
 */
const presence = ({ color, opacity }, bg) => {
  const lum = (c) => {
    const [r, g, b] = c
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map((n) => {
        const v = Number(n) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  return Math.abs(lum(color) - lum(bg)) * Number(opacity);
};

/**
 * The glyph acknowledges the pointer by becoming MORE present, not less.
 *
 * It used to do the opposite: `neutral-400` at rest and `neutral-300` on hover, which recedes
 * towards the background. That is wrong in both polarities and was reported from the one it was
 * noticed in — "too bright at rest, then it goes dark when I hover" is the dark-theme rendering of
 * a pair written the wrong way round.
 */
async function checkHover({ measurePart, hover, pageColor }) {
  const bg = await pageColor();
  // The button's own painted box: `color` and `opacity` are declared on `[part='base']`, so the
  // host reports the defaults for both and the icon inside inherits a composite of neither.
  const rest = await measurePart('we-button');
  await hover('we-button');
  const hovered = await measurePart('we-button');
  if (!rest || !hovered) return ['no glyph to hover'];

  const before = presence(rest, bg);
  const after = presence(hovered, bg);
  if (after === before) return ['the glyph does not respond to the pointer at all'];
  if (after < before) {
    return [
      `hovering makes the glyph recede: ${rest.color} at ${rest.opacity} resting, ` +
        `${hovered.color} at ${hovered.opacity} under the pointer`,
    ];
  }
  return [];
}
