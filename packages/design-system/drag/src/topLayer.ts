/**
 * Getting a floating piece of drag feedback above everything, including a modal.
 *
 * ## Why a z-index is not enough
 *
 * The ghost and the drop line are appended to `document.body` and stacked with a large `z-index`,
 * which is enough on an ordinary page and worth nothing inside a modal: `we-modal` promotes itself
 * with `popover="manual"`, and **no z-index can raise an element above the top layer**. So both
 * painted behind the dialog they were dragging in — a drag inside a modal showed no ghost and no
 * drop line at all, which reads as "reordering has no feedback" rather than "the feedback is
 * underneath this".
 *
 * Promoting them the same way fixes it, because the top layer stacks by promotion order and these
 * are always promoted after the modal that contains them. Feature-detected: where the Popover API
 * is missing, the z-index behaviour it falls back to is exactly what shipped before.
 *
 * This module exists so the lesson is learned **once**. It was learned twice independently before —
 * the sortable carried `POPOVER_RESETS` and the block editor's drop bar did not, which is why that
 * one painted at ~10px instead of 4: a UA `[popover]` padding nobody had reset.
 */

/** UA `[popover]` defaults that would otherwise leak in — the same set `OverlayElement` undoes. */
export const POPOVER_RESETS = [
  'inset:auto',
  'margin:0',
  'border:none',
  'padding:0',
  'overflow:visible',
  'color:inherit',
] as const;

/** Put a body-appended overlay into the browser's top layer, where one exists. */
export function promoteToTopLayer(el: HTMLElement): void {
  const showPopover = (el as HTMLElement & { showPopover?: () => void }).showPopover;
  if (typeof showPopover !== 'function') return;
  el.setAttribute('popover', 'manual');
  try {
    showPopover.call(el);
  } catch {
    // A popover that cannot be shown (already open, detached) simply stays where it was.
  }
}

/**
 * Append an overlay to the body and promote it.
 *
 * Both callers want the same three lines in the same order, and the order matters: promotion only
 * works on a connected element.
 */
export function mountOverlay(el: HTMLElement): HTMLElement {
  document.body.appendChild(el);
  promoteToTopLayer(el);
  return el;
}
