import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
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
 */
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

  const supportsPopover = typeof (panel as HTMLElement & { showPopover?: () => void }).showPopover === 'function';
  if (supportsPopover && !panel.hasAttribute('popover')) panel.setAttribute('popover', 'manual');

  const reposition = () => {
    void computePosition(trigger, panel, {
      placement,
      middleware: [offset(gap), flip(), shift({ padding: 8 })],
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
