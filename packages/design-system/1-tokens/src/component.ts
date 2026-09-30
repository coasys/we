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
  | 'thumbInset'
  | 'thumbBackground';

/**
 * Scrollbar styling tokens.
 * These values define the appearance of scrollbars across the system.
 */
export const scrollbar = {
  /**
   * The room the bar takes, thumb *and* its clearance — see `thumbInset`.
   *
   * `10px` where it was `6px`, and the visible thumb is unchanged at six: the extra four are the
   * two pixels of air on either side of it. A scroll region's content is that much narrower when it
   * overflows, which is the whole price of the change.
   */
  width: '10px',
  backgroundImage: 'none',
  background: 'transparent',
  cornerBackground: 'transparent',
  thumbBoxShadow: 'none',
  thumbBorderRadius: 'var(--we-radius-pill)',
  /**
   * How far the thumb is held off the edges of its own track.
   *
   * Without it the thumb fills the track, so an overflowing panel ends its content flush against
   * the bar — the cards in the extraction panel are where that was noticed, and it was true of
   * every scroll region in WE. Padding on each scroller fixes one of them at a time and costs
   * layout: the padding cannot know whether anything is currently scrolling, so it is also there on
   * a panel with no bar, leaving the content nearer one edge than the other.
   *
   * Inset here instead, where it costs no layout at all and is right everywhere at once. `border`
   * with `background-clip: content-box` is what does it — a transparent border is still the
   * element's own box, so the thumb keeps its full hit area and only the paint pulls in. The track
   * is transparent, so what shows through the border is whatever is behind the bar.
   */
  thumbInset: '2px',
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
    /*
      The pair that insets the thumb inside its own track — see the \`thumbInset\` token.

      They only work together: the border is what reserves the space and \`content-box\` is what
      stops the background painting into it. Either alone is a no-op, and dropping the second is
      the likely accident, since a transparent border looks like it should already be invisible.

      The radius is on the border box, so the painted pill is the inner curve of it. That is right
      at a pill radius, which is larger than any of these figures and stays a capsule however far
      the thumb is pulled in.
    */
    border: var(--we-scrollbar-thumb-inset) solid transparent;
    background-clip: content-box;
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
