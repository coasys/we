/**
 * The variables `:root` works out from a theme's settings — and so the ones every theme has to
 * re-declare wherever it is applied.
 *
 * ## Why a list rather than each generator writing its own
 *
 * A custom property is worked out where it is *declared* and inherited as a finished value.
 * `--we-border-width: var(--we-theme-border-width, 1px)` sits on `:root`, so a space's theme or a
 * node's theme setting `--we-theme-border-width` on its own wrapper changed nothing below it: the
 * width had already been settled a level up. The same was true of the focus ring, every spacing step
 * and, through `rem`, every font size. Themes applied anywhere but the document silently lost four
 * settings, and the only fix anybody had found was restating one alias at a time.
 *
 * So the dependents are listed once, here. The token CSS declares them on `:root` from this list,
 * and `@we/themes` re-declares the same entries on every element a theme is applied to. A variable
 * that depends on a theme setting and is not in this list is the bug this exists to prevent; the
 * themes package's scoping test fails when a setting changes nothing inside a scoped wrapper.
 */
import { borderWidth } from './border.js';
import { CHROMATIC_FAMILIES, familySaturationDefault, familySaturationVar } from './families.js';
import { fontSize } from './font.js';
import { space } from './space.js';

/**
 * How much a theme applied below the document scales its text, set only there.
 *
 * At the document a theme's `fontScale` sets the root font size, which every `rem` follows, so this
 * stays unset (1). Below it, `rem` cannot move — it is the root's — so the theme sets this instead
 * and the font-size and spacing steps multiply by it. Never both: the two would compound.
 */
export const SCOPED_FONT_SCALE_VAR = '--we-theme-scoped-font-scale';

const scoped = `var(${SCOPED_FONT_SCALE_VAR}, 1)`;

/** A step that is zero stays a plain zero: scaling nothing is still nothing. */
const isZero = (value: string): boolean => parseFloat(value) === 0;

export const THEME_DERIVED_VARIABLES: Readonly<Record<string, string>> = {
  '--we-border-width': `var(--we-theme-border-width, ${borderWidth})`,
  '--we-focus-ring-width': 'var(--we-theme-focus-ring-width, 2px)',
  // Each family's saturation, which falls back to the theme's (or the palette's) until a theme sets
  // the family's own.
  ...Object.fromEntries(
    CHROMATIC_FAMILIES.map((family) => [familySaturationVar(family), familySaturationDefault(family)]),
  ),
  // The ends of the lightness ramp, which a theme's polarity and range move.
  '--we-color-white': 'oklch(var(--we-color-lightness-0) 0 var(--we-color-neutral-hue))',
  '--we-color-black': 'oklch(var(--we-color-lightness-1000) 0 var(--we-color-neutral-hue))',
  // Spacing carries its own scale, so a denser layout does not have to mean smaller text, and the
  // scoped font scale, so a space theme's larger text gets the room it gets at the document.
  ...Object.fromEntries(
    Object.entries(space).map(([step, value]) => [
      `--we-space-${step}`,
      isZero(value) ? value : `calc(${value} * var(--we-theme-spacing-scale, 1) * ${scoped})`,
    ]),
  ),
  // `base` is a reference value, not a step anything paints with.
  ...Object.fromEntries(
    Object.entries(fontSize)
      .filter(([step]) => step !== 'base')
      .map(([step, value]) => [`--we-font-size-${step}`, `calc(${value} * ${scoped})`]),
  ),
};
