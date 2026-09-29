/**
 * A colour from an id — the same colour, everywhere, for ever.
 *
 * This was `avatar.ts`'s, and it moved because a second surface now draws the same person: a live
 * cursor. Normally two uses of a shape are a coincidence and the extraction waits for a third, but
 * the two here have to *agree* — the whole promise of a generated colour is that one identity reads
 * as one colour, and a second copy of the algorithm is a promise that breaks the first time either
 * side is tuned. A shared definition is the feature, not the tidiness.
 *
 * Read `seededFill` before using it: what makes it safe is that it is the theme's own ramp with the
 * hue swapped, so it follows polarity, saturation and chroma exactly as `accent-muted` does.
 */

/**
 * How many hues a generated colour may take, evenly spaced around the wheel.
 *
 * A *palette* rather than the whole circle, and that is the load-bearing decision. Hashing straight
 * to 0–359 reads as more choice and gives less: twelve random uuids put their closest pair **three
 * degrees** apart — measured — which at these chromas is one colour, and two things looking almost
 * the same reads as a rendering fault rather than as a coincidence. Quantising trades uniqueness for
 * separation. Two identities can now share a colour outright, which is honest and legible, and no two
 * can be nearly the same.
 *
 * Twelve because 30° is comfortably apart at the low chroma these fills carry, and because the
 * letters or the name are the identifier anyway — the colour is a second cue, not the first.
 */
const HUE_STEPS = 12;

/**
 * A hue, from whatever identifies this thing.
 *
 * FNV-1a, because the requirements are "same input, same colour, everywhere, for ever" and "spread
 * evenly across the buckets" — not cryptographic strength. Eight lines, no dependency, and the same
 * answer in every browser and in a test.
 *
 * The point of a *hue* rather than a colour is that everything else stays the theme's. See
 * {@link seededFill}.
 */
export function seededHue(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (Math.abs(h) % HUE_STEPS) * (360 / HUE_STEPS);
}

/** One step of the theme's own ramp at an arbitrary hue — the expression `--we-color-*` is built from. */
function rampStep(lightness: string, hue: number): string {
  return (
    `oklch(var(--we-color-lightness-${lightness}) calc(var(--we-color-saturation) / 100 * 0.18 * 2 * ` +
    `max(0, min(var(--we-color-lightness-${lightness}), 1 - var(--we-color-lightness-${lightness})))) ${hue})`
  );
}

/**
 * The generated fill and its foreground, built the way the theme builds its own colours.
 *
 * This is the `--we-color-*-100` / `-700` pair with the hue swapped out, character for character —
 * same lightness step, same saturation, same chroma taper, same ceiling. So a generated colour
 * follows a theme's polarity, its saturation and its ramp exactly as `accent-muted` and `accent-text`
 * do, and the only thing that varies per identity is the angle.
 *
 * Reusing that *pair* is what makes the contrast safe without measuring anything: 100 as a fill with
 * 700 as its text is the combination the roles already ship, and it stays legible when a dark theme
 * flips the ramp, because both steps flip together. Anything that needs a strong mark rather than a
 * tinted fill should draw it in `fg` — which is the step that stays contrasting under both
 * polarities — rather than inventing a third.
 */
export function seededFill(seed: string): { bg: string; fg: string } {
  const hue = seededHue(seed);
  return { bg: rampStep('100', hue), fg: rampStep('700', hue) };
}
