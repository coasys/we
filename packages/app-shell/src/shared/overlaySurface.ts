import { surfaceStyles } from '@we/schema-shared';

/**
 * The style of the box a shell overlay (Settings, Profile, a bundle's page) is drawn in: the surface
 * its views measure themselves against, and the box that scrolls them.
 *
 * It has to be the scroller itself. A surface is a size container (`container-type: inline-size`),
 * and a size container has layout containment, which in the phone's WebView (Chrome 124) makes
 * whatever overflows it *ink* overflow: painted, but no part of any ancestor's scrollable area
 * (newer Chrome counts it, which is why this held on the desktop). With the scrolling on the box
 * around it, a page taller than the window overflowed this one and the box above had nothing to
 * scroll, so
 * Settings on a phone ended at the bottom of the screen and the rows below it could not be reached.
 *
 * `height: 100%`, so the views inside, which size themselves with `minHeight: '100%'`, have a
 * definite height to resolve against: left at `auto`, Firefox treats the percentage as indefinite and
 * Settings collapsed to its content with the space template showing underneath. The gutter is
 * reserved for good, so a view whose content crosses the window's height does not shift sideways
 * as its scrollbar comes and goes.
 */
export const overlaySurfaceStyle = (): Record<string, string> => ({
  ...surfaceStyles(),
  height: '100%',
  overflow: 'auto',
  'scrollbar-gutter': 'stable',
});
