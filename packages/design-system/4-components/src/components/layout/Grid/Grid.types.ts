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
};
