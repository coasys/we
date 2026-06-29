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
};
