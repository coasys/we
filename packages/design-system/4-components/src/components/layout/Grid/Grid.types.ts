import type { Tiling } from '@we/design-utils';
import type { LayoutProps } from '@we/design-utils/solid';

export type GridProps = LayoutProps & {
  /**
   * Raw `grid-template-columns` value (e.g. `'28px 1fr 28px'`, `'1fr 1.2fr'`).
   * When set, takes precedence over `columns` and `minChildWidth`.
   */
  template?: string;
  /**
   * Fixed number of equal columns (e.g. `3` → `repeat(3, 1fr)`).
   * Ignored when `template` or `minChildWidth` is set.
   */
  columns?: number;
  /**
   * Minimum child width for responsive auto-fill columns
   * (e.g. `'280px'` → `repeat(auto-fill, minmax(280px, 1fr))`).
   * Takes precedence over `columns`.
   */
  minChildWidth?: string;
  /**
   * Raw `grid-template-rows` value (e.g. `'20px 1fr 20px'`, `'0fr'`).
   *
   * The row axis had no prop at all, so every use of it reached for the `styles` escape hatch —
   * three call sites had done so before this existed, none of them doing anything exotic. A grid
   * with a fixed header and footer band is ordinary layout, and ordinary layout is what DS props
   * are for.
   */
  rows?: string;
  /**
   * The aspect ratio of each child, for a grid that fills its **box** rather than its width.
   *
   * `minChildWidth` answers "how many fit across", which needs only the width. This answers "what
   * arrangement makes them largest", which needs both axes — so the grid measures itself and solves
   * for the column count that maximises tile size, then divides its height evenly into rows.
   *
   * Use it whenever a set of same-shaped things should fill a box somebody can reshape: a video
   * call, a photo wall, a board of cards. Drag the box wide and they go side by side; drag it tall
   * and they stack. Neither `columns` (fixed) nor `minChildWidth` (width-only) can express that —
   * the first letterboxes and the second gives four columns of postage stamps in a tall box.
   *
   * Takes the CSS spellings: `'16 / 9'`, `'16/9'`, `'1.5'`. Takes precedence over `columns` and
   * `minChildWidth`, and is ignored when `template` is set.
   *
   * Children are counted from the DOM, so a `$each` over live data needs nothing extra. Content
   * that is not a grid item — an absolutely positioned overlay — should be marked `data-we-untiled`
   * or it will be counted as one.
   */
  childAspect?: string | number;
  /**
   * Called when the solved arrangement changes.
   *
   * Only a grid knows what arrangement it settled on, and sometimes something outside needs the
   * same answer: the call module reports the shape its panel wants at fit-to-content, which is
   * `columns × 16 / (rows × 9)` and unknowable from the outside. Fires on mount and on every change,
   * never on a resize that changed nothing.
   */
  onArrange?: (tiling: Tiling) => void;
};
