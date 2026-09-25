/**
 * Whether a press landed on text somebody might be selecting.
 *
 * ## Why this is a question at all
 *
 * A card that can be picked up is a card whose body is also something to read, and reading includes
 * selecting a sentence to copy it. A press on the card started a drag after four pixels, so dragging
 * across a paragraph picked the whole post up instead of highlighting anything — the gesture that
 * has meant "select" on every page for thirty years was taken over by one nobody expected there.
 *
 * ## Opted into, then measured
 *
 * Two conditions, both needed:
 *
 * - **The press is inside a text region** — an ancestor marked `data-we-text`. Opt-in, because most
 *   draggable rows are *labels*: a Pocket row, a member, a sidebar space. Their text is what you grab
 *   them by, and selecting it is never what anybody meant. A rendered composition is the opposite,
 *   and marks itself.
 * - **It landed on the glyphs themselves**, not merely inside the region. The empty half of a short
 *   line, the gap between two paragraphs and a block's padding all still drag, which is what keeps a
 *   card that is mostly text draggable by anything but its words.
 *
 * The second is a hit test against the characters either side of the caret position the browser
 * reports for the point, because the caret position alone answers "nearest character" — which is
 * somewhere on every line, however far right of its end the press was.
 */

/** The attribute a text region carries. */
export const TEXT_REGION_ATTRIBUTE = 'data-we-text';

/** The two ways a browser reports the caret under a point, as far as this needs them. */
interface CaretLookup {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  createRange: () => Range;
}

/**
 * `path` is the event's composed path. The whole of it counts, including what is outside the
 * draggable asking: a paragraph's own draggable sits *inside* the composition that is the text
 * region, and has to give the same answer as the card around it or the press would pick the
 * paragraph up instead.
 */
export function pressIsOnText(
  path: readonly EventTarget[],
  point: { x: number; y: number },
  doc: CaretLookup = document as unknown as CaretLookup,
): boolean {
  let region: Element | null = null;
  for (const node of path) {
    if (node instanceof Element && node.hasAttribute(TEXT_REGION_ATTRIBUTE)) {
      region = node;
      break;
    }
  }
  if (!region) return false;

  const caret = caretAt(doc, point);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE || !region.contains(caret.node)) return false;

  const length = caret.node.textContent?.length ?? 0;
  const range = doc.createRange();
  for (const start of [caret.offset - 1, caret.offset]) {
    if (start < 0 || start >= length) continue;
    range.setStart(caret.node, start);
    range.setEnd(caret.node, start + 1);
    for (const rect of Array.from(range.getClientRects())) {
      if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) return true;
    }
  }
  return false;
}

function caretAt(doc: CaretLookup, point: { x: number; y: number }): { node: Node; offset: number } | null {
  const position = doc.caretPositionFromPoint?.(point.x, point.y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = doc.caretRangeFromPoint?.(point.x, point.y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}
