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
  const { measure, measurePart } = api;
  const problems = [];

  /*
    Not the ones inside a hover bubble.
  
    A compact mark is wrapped in a `we-tooltip` whose content — the type's name, its glyph, and who
    reacted — is in the DOM the whole time, laid out at zero size until it opens. `querySelectorAll`
    cannot tell those apart, so the day the bubble gained a glyph of its own, this measured it and
    reported a 0x0 mark. The bubble's contents are exactly what `[slot='content']` holds.
  */
  const glyph = await measure('we-icon:not([slot="content"] *)');
  const count = await measure('we-number:not([slot="content"] *)');
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

  /*
    The digits are the same colour as the mark.

    They sit outside the button, so a colour set on the control left them at the inherited text
    colour — near-black beside a faint grey glyph — and the hover lit one of the two. The pair is
    one thing to look at, so it is coloured in one place.
  */
  const mark = await measurePart('we-button');
  const digits = await measurePart('we-number');
  if (mark && digits && mark.color !== digits.color) {
    problems.push(`the count is ${digits.color} beside a ${mark.color} mark`);
  }

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
  /*
    Relative luminance of a computed colour, in whichever form Chrome reports it.

    A colour made with `oklch(from …)` is reported as `oklch(L C h)`, and one that resolved to a
    plain sRGB value as `rgb(r, g, b)`. Which of the two the page background is depends on whether
    the role chain stayed an `oklch()` through `min()` — so both are read as what they say, rather
    than reading the three numbers of an oklch colour as if they were 0..255 channels.
  */
  const lum = (c) => {
    const nums = c.match(/-?[\d.]+(?:e-?\d+)?/g).map(Number);
    let linear;
    if (c.trim().startsWith('oklch')) {
      const [L, C, H] = nums;
      const a = C * Math.cos((H * Math.PI) / 180);
      const b = C * Math.sin((H * Math.PI) / 180);
      const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
      linear = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      ].map((v) => Math.min(1, Math.max(0, v)));
    } else {
      linear = nums.slice(0, 3).map((n) => {
        const v = n / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
    }
    const [r, g, b] = linear;
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
