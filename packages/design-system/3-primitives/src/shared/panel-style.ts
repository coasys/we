import { familyVar } from '@we/design-utils';
import { unsafeCSS } from 'lit';

/**
 * How everything that floats over the page is drawn — a menu, a listbox, a picker's panel, a tooltip,
 * a toast. Where it goes is `floating-panel.ts`; this is what it looks like when it gets there.
 *
 * Each had its own: three radii, four shadows, two of them read the surface family and three a
 * literal step, and none took the theme's surface opacity or blur, so a glass theme frosted every
 * card and left every menu opaque. Floating is one kind of thing, so it is said once:
 *
 * - the raised surface, through the theme's surface opacity;
 * - a border in the border role at the theme's border width;
 * - the surface family's corner;
 * - the large shadow, which the theme's elevation settings move;
 * - the theme's surface blur behind it.
 *
 * `FLOATING_PANEL_BG` is the fill alone, for a component that draws its fill through its DS props.
 */
export const FLOATING_PANEL_BG =
  'color-mix(in srgb, var(--we-role-surface-raised) calc(var(--we-theme-surface-opacity, 1) * 100%), transparent)';
export const FLOATING_PANEL_RADIUS = familyVar('surface', 'radius');
export const FLOATING_PANEL_SHADOW = 'var(--we-shadow-lg)';
export const FLOATING_PANEL_BLUR = 'blur(var(--we-theme-surface-blur, 0px))';

/** The panel's declarations, for a rule that also says where the panel goes and what it holds. */
export const floatingPanel = (fill = FLOATING_PANEL_BG) =>
  unsafeCSS(
    `background: ${fill}; ` +
      `border: var(--we-border-width) solid var(--we-role-border); ` +
      `border-radius: ${FLOATING_PANEL_RADIUS}; ` +
      `box-shadow: ${FLOATING_PANEL_SHADOW}; ` +
      `backdrop-filter: ${FLOATING_PANEL_BLUR};`,
  );
