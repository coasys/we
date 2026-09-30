/**
 * What a connection drag is pointing at.
 *
 * A pure function, extracted for the reason `resize.ts` is: the gesture around it is DOM and pointer
 * capture and cannot be tested without a browser, while the *rule* is three lines and is where the
 * behaviour actually lives. Both halves of it are quiet refusals, which is precisely the kind of
 * thing that stops working without anything failing.
 *
 * In the core rather than beside the gesture, because three separate places now ask it and they must
 * not be able to disagree: the renderer marks the card under the line, the engine ends the preview on
 * that card's edge, and the release decides what is connected. Two of those are in one package and
 * one is in another; a copy of the rule anywhere would show up as a line snapping to a card the drop
 * then refuses.
 */

/**
 * The node a connection should be made to, or null when the drag ended in nothing.
 *
 * Two refusals, and both are deliberate silence rather than an error:
 *
 * - **Released on empty canvas** is an abandoned gesture, not a connection to nothing. Somebody who
 *   changed their mind mid-drag drops it where there is no card, and the right response is that the
 *   line goes away.
 * - **Released on the card it started from** is the same. Dragging out of an edge and back is how a
 *   gesture is cancelled by hand, and a self-connection is not a thing the graph can draw or the
 *   data can hold.
 *
 * Emitting for either would open a dialog about a connection nobody made, which is worse than doing
 * nothing — a dialog has to be read and dismissed before the canvas is usable again.
 *
 * Asked twice per gesture, on purpose: once on release to decide what is connected, and once per
 * move to decide which card is marked under the line. One rule, so the mark cannot promise a
 * connection the drop then refuses — the source card does not light up as you drag out of it, and
 * neither does empty canvas.
 */
export function connectionTarget(hit: string | undefined, source: string): string | null {
  if (!hit || hit === source) return null;
  return hit;
}
