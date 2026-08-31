/**
 * COMPONENT TOKEN DEFINITIONS
 * This file defines component-specific tokens that serve as the source of truth for the design system.
 */

// Literal union type for scrollbar properties
export type ScrollbarToken =
  | 'width'
  | 'backgroundImage'
  | 'background'
  | 'cornerBackground'
  | 'thumbBoxShadow'
  | 'thumbBorderRadius'
  | 'thumbBackground';

/**
 * Scrollbar styling tokens.
 * These values define the appearance of scrollbars across the system.
 */
export const scrollbar = {
  width: '6px',
  backgroundImage: 'none',
  background: 'transparent',
  cornerBackground: 'transparent',
  thumbBoxShadow: 'none',
  thumbBorderRadius: 'var(--we-radius-pill)',
  // The role that names exactly this — see `controlSurface`, whose own documentation lists a
  // scrollbar thumb. It was the last scale position left in the token layer after the migration.
  thumbBackground: 'var(--we-role-control-surface)',
} satisfies Record<ScrollbarToken, string>;

/**
 * The one ruleset that reads the tokens above.
 *
 * ## Why this is a function and not three copies
 *
 * There were three, and they disagreed in ways nobody could see from any one of them: the app's
 * global sheet, the stylesheet every primitive adopts into its shadow root, and `we-scroll-area`'s
 * own rules. Same intent, three spellings — the global one hid the scrollbar buttons and the shared
 * one did not, so an identical scroll region grew stepper arrows depending on whether it happened to
 * be inside a shadow root. `we-scroll-area` hardcoded `6px` rather than reading the token, so a
 * theme changing scrollbar width moved every scroll region except the one component named for
 * scrolling.
 *
 * ## The rule that makes all of this fragile
 *
 * **Never set `scrollbar-color` or `scrollbar-width` on an element you also style with
 * `::-webkit-scrollbar`.** Chromium treats either standard property as "use the platform scrollbar"
 * and ignores every pseudo-element rule on that element — so the webkit rules become dead code
 * without warning, and the element renders the OS's own bar: a different colour, a different shape,
 * and on Linux whatever stepper arrows the GTK theme draws.
 *
 * That is exactly what `we-scroll-area` did, with both properties at once, while carrying a full set
 * of `::-webkit-scrollbar` rules underneath that never applied. It is also written down already — in
 * `SpaceHeader`, which declines to set `scrollbarWidth` for this reason and says so.
 *
 * @param prefix Selector the pseudo-elements hang off — `"[part='base']"` for one element's own
 *               scrollbar, empty for every scroll region in the tree (a document, a shadow root).
 */
export function scrollbarRules(prefix = ''): string {
  return `
  ${prefix}::-webkit-scrollbar {
    width: var(--we-scrollbar-width);
    height: var(--we-scrollbar-width);
  }

  ${prefix}::-webkit-scrollbar-track {
    background: var(--we-scrollbar-background);
    background-image: var(--we-scrollbar-background-image);
  }

  ${prefix}::-webkit-scrollbar-corner {
    background: var(--we-scrollbar-corner-background);
  }

  ${prefix}::-webkit-scrollbar-thumb {
    box-shadow: var(--we-scrollbar-thumb-box-shadow);
    border-radius: var(--we-scrollbar-thumb-border-radius);
    background-color: var(--we-scrollbar-thumb-background);
  }

  ${prefix}::-webkit-scrollbar-button {
    display: none;
  }
`;
}

/**
 * Complete component token object that combines all component-specific categories.
 * This is the main export for consumers who need component tokens.
 */
export const component = { scrollbar };
