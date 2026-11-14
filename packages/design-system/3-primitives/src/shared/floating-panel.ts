import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';
import type { Placement } from '@we/design-types';

/**
 * One way to float a panel above everything, for the several components that need to.
 *
 * ## Why this exists
 *
 * Four things in this package open a panel anchored to a trigger, and until this they did it three
 * different ways. `we-popover` used the Popover API with Floating UI. `we-icon-picker` hand-rolled
 * `position: fixed` from a `getBoundingClientRect()` read on open — which escapes clipping but has
 * nothing watching the trigger, so the panel drifts away from it the moment anything scrolls.
 * `we-select` and `we-date-picker` used plain `position: absolute`, which any ancestor with a
 * non-visible `overflow` clips: every one of them inside a modal, a scroll area or a mid-animation
 * reveal, which is most of where they are used.
 *
 * The divergence is the point. This is the same situation `we-resize-handle` was created for —
 * several implementations of one behaviour, differing in ways nobody chose, each with its own bugs.
 *
 * ## What it does
 *
 * Promotes the panel into the browser's **top layer** with the Popover API, so no `z-index`,
 * `overflow` or stacking context can hide or clip it — including a `we-modal`, which is itself in
 * the top layer and cannot be beaten any other way. Then anchors it to the trigger with Floating
 * UI's `computePosition` and keeps it there with `autoUpdate`, which follows scrolls, resizes and
 * layout shifts for as long as the panel is open.
 *
 * A popover is *not* reparented — the element stays exactly where it is in the DOM. Keyboard
 * handling, `aria-activedescendant` and shadow-scoped styles all keep working, which is what makes
 * this safe to retrofit onto components that already had working listbox behaviour.
 *
 * Degrades where the Popover API is missing: the panel keeps its old positioning and its old
 * clipping, rather than disappearing.
 *
 * ## It stays in the window
 *
 * `flip` alone only tries the opposite side. A menu asked for `right-end` beside a trigger as wide
 * as a phone has no room on the right and none on the left, so it kept the side it asked for and
 * opened off the edge of the screen — the person menu at the foot of a phone's rail did exactly
 * that. So the sides across the other axis are tried as well (above, then below), `shift` keeps the
 * panel inside the window on both axes as a last resort, and `size` caps it at the room there is,
 * scrolling what does not fit rather than drawing it off screen.
 */
/** The least room kept between a panel and the window's edge, in pixels. */
const EDGE = 8;

export interface FloatingPanelOptions {
  /** Where the panel prefers to sit; `flip` moves it when there is no room. */
  placement?: Placement;
  /** Gap between trigger and panel, in pixels. */
  gap?: number;
}

/**
 * Show `panel` anchored to `trigger`, and keep it anchored.
 *
 * Returns the teardown: it stops the position watcher and hides the popover. Call it when the panel
 * closes and on disconnect — a panel left open in the top layer outlives the component otherwise.
 */
export function openFloatingPanel(
  trigger: HTMLElement | null | undefined,
  panel: HTMLElement | null | undefined,
  { placement = 'bottom-start', gap = 4 }: FloatingPanelOptions = {},
): () => void {
  if (!trigger || !panel) return () => {};

  // Fixed, because the coordinates Floating UI computes are viewport-relative — and because the
  // panel must not be laid out by whatever box it happens to sit in.
  panel.style.position = 'fixed';
  panel.style.margin = '0';

  /*
    Undo the UA's own [popover] rules.

    They are author-level-beating in one specific way that matters: a panel inheriting its text
    colour from the component around it suddenly gets `color: CanvasText` instead, because any
    declaration beats inheritance. Every one of these panels sets its own background and none set a
    colour, so promoting them turned themed text black on a themed surface. `inset` matters for the
    same reason — the UA anchors a popover to all four edges, which fights the coordinates below.
  */
  panel.style.inset = 'auto';
  panel.style.color = 'inherit';

  const supportsPopover = typeof (panel as HTMLElement & { showPopover?: () => void }).showPopover === 'function';
  if (supportsPopover && !panel.hasAttribute('popover')) panel.setAttribute('popover', 'manual');

  /*
    What the panel's own styles said before this capped it, so the cap is never larger than a
    panel's own limit (a listbox's max-height) and the teardown puts back exactly what was there.
  */
  const own = getComputedStyle(panel);
  const ownMax = { width: own.maxWidth, height: own.maxHeight };
  const ownOverflow = own.overflow;
  const inline = { maxWidth: panel.style.maxWidth, maxHeight: panel.style.maxHeight, overflow: panel.style.overflow };
  const cap = (ownLimit: string, room: number) =>
    ownLimit === 'none' || ownLimit === '' ? `${room}px` : `min(${ownLimit}, ${room}px)`;

  const reposition = () => {
    void computePosition(trigger, panel, {
      placement,
      middleware: [
        offset(gap),
        flip({ fallbackAxisSideDirection: 'start', padding: EDGE }),
        shift({ padding: EDGE, crossAxis: true }),
        size({
          padding: EDGE,
          apply({ availableWidth, availableHeight }) {
            const room = { width: Math.max(0, availableWidth), height: Math.max(0, availableHeight) };
            panel.style.maxWidth = cap(ownMax.width, room.width);
            panel.style.maxHeight = cap(ownMax.height, room.height);
            // Scrolled only while its content is more than the room — a panel that fits keeps its
            // own overflow, so nothing it draws past its edge (a focus ring, a shadow) is clipped.
            const tooBig = panel.scrollWidth > room.width || panel.scrollHeight > room.height;
            panel.style.overflow = tooBig && ownOverflow === 'visible' ? 'auto' : inline.overflow;
          },
        }),
      ],
    }).then(({ x, y }) => {
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
    });
  };

  if (supportsPopover) {
    try {
      (panel as HTMLElement & { showPopover: () => void }).showPopover();
    } catch {
      // Already open, or not connected — positioning below still applies.
    }
  }

  const stopWatching = autoUpdate(trigger, panel, reposition);

  return () => {
    stopWatching();
    panel.style.maxWidth = inline.maxWidth;
    panel.style.maxHeight = inline.maxHeight;
    panel.style.overflow = inline.overflow;
    if (!supportsPopover) return;
    const open = panel.matches?.(':popover-open');
    if (!open) return;
    try {
      (panel as HTMLElement & { hidePopover: () => void }).hidePopover();
    } catch {
      // Nothing to hide.
    }
  };
}
