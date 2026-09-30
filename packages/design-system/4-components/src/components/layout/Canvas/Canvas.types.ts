import type { LayoutProps } from '@we/design-utils/solid';

/** The coordinate space children are placed in, in the author's own units. */
export interface Artboard {
  width: number;
  height: number;
}

/**
 * How the artboard meets the box it was given.
 *
 * `reflow` — freeform above a breakpoint, a stack below it — is deliberately absent rather than
 * unimplemented. It is the one convention that cannot be a property of the *container*: it needs
 * every item to stop translating and take a reading order, which a canvas can only do to arbitrary
 * children by overruling their own styles. When somebody wants it, it wants an item-level answer.
 */
export type CanvasFit = 'scale' | 'contain' | 'stretch' | 'none';

export type CanvasProps = LayoutProps & {
  /**
   * The coordinate space the children's `x` / `y` are in — **the whole point of this component**.
   *
   * `position: absolute` and a pixel resolve against whatever positioned ancestor happens to be
   * there: a docked panel, the editor's preview pane, a phone. Declaring the space is what lets
   * anything downstream do arithmetic with those numbers — scale them, letterbox them, convert them
   * to percentages, or hand a manipulation layer somewhere to write a drag back to.
   *
   * A scrapbook is precisely the case where the author *does* mean a specific geometry, and the
   * rule the rest of the codebase follows — named positions only, never pixels, because a template
   * cannot see the viewport — is not weakened by this. It is satisfied by it: a pixel inside a
   * declared 1200×3000 space is not a guess about the display, it is a coordinate.
   *
   * Written out rather than as `Artboard`, which it is: the generated component reference prints
   * whatever the type node says, and a schema author told `artboard: Artboard` has been told
   * nothing. Same for `fit` below.
   */
  artboard: { width: number; height: number };
  /**
   * How that space meets the box the canvas ends up in. Defaults to `scale`.
   *
   * - **`scale`** — uniform, driven by width, and the default. The canvas takes the height the
   *   scaled artboard needs, so a tall artboard scrolls in document flow like any other content.
   *   One authored layout is never *broken*, which is the property that makes freeform placement
   *   usable by people who are not designers. Text does get small on a phone.
   * - **`contain`** — uniform, fitted to both axes and centred, letterboxing whichever axis has
   *   room left. Needs the canvas to have a height of its own; without one there is no second axis
   *   to fit against and it behaves as `scale`.
   * - **`stretch`** — each axis scaled independently to fill the box. Distorts, deliberately.
   * - **`none`** — the artboard at its declared size, whatever the box is. Pair it with `overflow`.
   */
  fit?: 'scale' | 'contain' | 'stretch' | 'none';
  /**
   * Called with the canvas's content box whenever it changes, and with the scale it settled on.
   *
   * The same narrow escape hatch `Grid.onMeasure` is, for the same reason: the canvas is measuring
   * anyway, and something outside occasionally has to make a decision from the number — a
   * manipulation layer converting a pointer delta back into artboard coordinates has to divide by
   * exactly this scale, and getting it from anywhere else is how the two drift apart.
   */
  onMeasure?: (box: { width: number; height: number; scale: number }) => void;
};
