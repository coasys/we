/**
 * How every component draws focus and a disabled state — one spelling each, read from the theme.
 *
 * ## Focus
 *
 * A ring of `--we-focus-ring-width` in `--we-ring-color`, which a theme sets with `focusRingWidth`
 * and the `focus` role. Three shapes of the one ring, by what the focusable thing already has:
 *
 * - `FOCUS_RING`: around a box with no border of its own — a filled button.
 * - `FOCUS_RING_BEYOND_BORDER`: around a box whose border is recoloured to the ring — a field, an
 *   outline button — so border and ring together are one perimeter of the ring's width, not a
 *   border plus a ring.
 * - `FOCUS_RING_INSET`: inside a row that fills a scrolling list edge to edge — a menu item, a
 *   listbox option — where an outer ring would be clipped by the list.
 *
 * `FOCUS_OUTLINE` is the same ring as an outline, for an element that already draws a shadow the
 * ring must not replace, or whose focus belongs on a sibling (a switch's track, a checkbox's box).
 *
 * ## Disabled
 *
 * `--we-theme-disabled-opacity`, which a theme sets with `disabledOpacity`, on the element's host —
 * so a component never states its own number, and nothing compounds two of them.
 */
export const FOCUS_RING = '0 0 0 var(--we-focus-ring-width) var(--we-ring-color)';
export const FOCUS_RING_INSET = 'inset 0 0 0 var(--we-focus-ring-width) var(--we-ring-color)';
export const FOCUS_RING_BEYOND_BORDER =
  '0 0 0 max(0px, calc(var(--we-focus-ring-width) - var(--we-border-width))) var(--we-ring-color)';
export const FOCUS_OUTLINE_WIDTH = 'var(--we-focus-ring-width)';
export const FOCUS_OUTLINE = `outline: ${FOCUS_OUTLINE_WIDTH} solid var(--we-ring-color); outline-offset: 2px;`;
export const DISABLED_OPACITY = 'var(--we-theme-disabled-opacity, 0.5)';
