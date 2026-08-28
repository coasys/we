/**
 * When a press becomes a drag.
 *
 * Two different answers, because two different input devices, and getting this wrong costs the
 * whole surface rather than the gesture:
 *
 * - **A mouse or pen** starts dragging once it has moved past a threshold. A few pixels of drift
 *   during a click is not a drag, which is why the threshold exists at all.
 * - **A finger** starts dragging after a **long press**, and never on movement. A touch that begins
 *   on a scrolling list and moves is somebody scrolling, and a surface that reads it as a drag
 *   cannot be scrolled at all. The alternative — `touch-action: none` on the container — is the
 *   same bug spelled in CSS.
 */
import type { DragPoint } from './types';

export interface PointerDragOptions {
  /**
   * The element that captures the pointer once the drag starts, and the one listeners hang off.
   *
   * Capture is what makes a cross-surface drag possible: moves keep arriving after the pointer
   * leaves the origin, which is why hit-testing is by coordinate rather than by listening on every
   * possible target.
   */
  capture: Element;
  /** Pixels of movement before a mouse press counts as a drag. */
  threshold?: number;
  /** Milliseconds a touch must be still before it counts as a drag. */
  longPress?: number;
  onStart: (e: PointerEvent) => void;
  onMove: (e: PointerEvent) => void;
  onEnd: (e: PointerEvent) => void;
  onCancel: () => void;
}

const DEFAULT_THRESHOLD = 4;
const DEFAULT_LONG_PRESS = 350;

/**
 * Watch a press that has already happened, and report if it becomes a drag.
 *
 * Returns a function that abandons the watch — for a caller that decides mid-gesture that the press
 * was somebody else's (see `dragSession.claimPress`).
 */
export function watchPointerDrag(down: PointerEvent, options: PointerDragOptions): () => void {
  const { capture } = options;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const isTouch = down.pointerType === 'touch';
  const start: DragPoint = { x: down.clientX, y: down.clientY };

  let dragging = false;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let last = down;

  function begin(e: PointerEvent) {
    if (dragging) return;
    dragging = true;
    clearHold();
    try {
      capture.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that has already been released cannot be captured; the drag still runs off the
      // events we are listening for.
    }
    options.onStart(e);
  }

  function clearHold() {
    if (holdTimer !== undefined) clearTimeout(holdTimer);
    holdTimer = undefined;
  }

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    last = e;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (!dragging) {
      // A finger that moves before the hold elapses is scrolling. Let it, and stop watching —
      // re-arming the timer would turn a slow scroll into a drag.
      if (isTouch) {
        if (moved > threshold) stop();
        return;
      }
      if (moved <= threshold) return;
      begin(e);
    }
    options.onMove(e);
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    const wasDragging = dragging;
    stop();
    if (wasDragging) options.onEnd(e);
  };

  const onCancel = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    stop();
    options.onCancel();
  };

  function stop() {
    clearHold();
    dragging = false;
    capture.removeEventListener('pointermove', onMove as EventListener);
    capture.removeEventListener('pointerup', onUp as EventListener);
    capture.removeEventListener('pointercancel', onCancel as EventListener);
  }

  capture.addEventListener('pointermove', onMove as EventListener);
  capture.addEventListener('pointerup', onUp as EventListener);
  capture.addEventListener('pointercancel', onCancel as EventListener);

  if (isTouch) holdTimer = setTimeout(() => begin(last), options.longPress ?? DEFAULT_LONG_PRESS);

  return () => {
    const wasDragging = dragging;
    stop();
    if (wasDragging) options.onCancel();
  };
}
