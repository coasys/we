/**
 * A pinned list with less content than it has room for puts it at the TOP.
 *
 * Pinning is `flex-direction: column-reverse`, and a flex container packs its items at the main
 * start — which, reversed, is the bottom. So a panel holding less than a screenful sat its content
 * on the floor: a transcript with nothing said in it yet showed "Nothing has been said" hovering at
 * the bottom edge, which reads as a bug rather than as a placeholder.
 *
 * The case is worth keeping rather than folding into the others because it is the one state where
 * pinning and ordinary document order disagree, and it is invisible in every test that supplies
 * enough content to scroll.
 */
export const name = 'a pinned list with little content starts at the top';
export const scenario = 'ds:pinned-empty';
export const widths = [420];

export async function check({ measure, measurePart }) {
  const view = await measurePart('#feed', 'base');
  const placeholder = await measure('#placeholder');
  if (!view || !placeholder) return ['expected a scroll area and a placeholder'];

  // Nothing overflows, or this is measuring the wrong thing.
  if (view.scrollH > view.h + 1) {
    return [`the content is ${view.scrollH}px in a ${view.h}px box — it overflows, so this is not the short case`];
  }

  // Near the top, allowing for the container's own padding. "Near" rather than exact so the padding
  // token can move without failing this.
  const fromTop = placeholder.y - view.y;
  if (fromTop > 48) {
    return [`the placeholder is ${Math.round(fromTop)}px down a ${view.h}px panel — it is at the bottom`];
  }
  return [];
}
