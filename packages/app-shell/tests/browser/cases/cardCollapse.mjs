/**
 * A card's body is clipped in compact mode and unwrapped in expanded mode — and stays right when
 * the mode changes under it.
 *
 * `cardShell` used to branch on the mode and carry its whole body down both sides of a `$if`: in
 * `CardsView` that was 150,445 characters written twice, in the one place where size is a hard
 * budget rather than merely a large one. It is now one `CollapsedContent` with the mode in its
 * props, which renders its children bare when there is nothing to collapse and no toggle offered.
 *
 * Two things that can only be judged here. Whether the compact card is actually CLIPPED is a fact
 * about a measured `max-height` and an `overflow: hidden`, which jsdom has no opinion about. And
 * whether the expanded card is really unwrapped is a fact about the box around it, not the markup:
 * a wrapper with `overflow: hidden` and a measured height is a no-op for height and is not a no-op
 * for anything that needs to escape the box.
 *
 * The pressing matters more than either. A Solid component body runs once, so an early `return`
 * for "nothing to collapse" decides that at creation and never again — a card would paint
 * correctly in whichever mode it was born in and keep that shape forever. Mounting each mode
 * separately passes against that; changing the mode in place is what fails.
 */
export const name = 'a card collapses, and stops collapsing, as its mode changes';
export const scenario = 'cards:collapse';
export const widths = [900];

/** The clipping box `CollapsedContent` puts around a body it may have to cut short. */
const CLIP = '.we-collapsed-content > div';

export async function check({ measure, measureAll, click, count }) {
  const problems = [];

  const body = async () => {
    const lines = await measureAll('p');
    return { first: lines[0], last: lines[lines.length - 1], lines };
  };

  /*
    Compact: the clip is there and is doing something.

    Measured against the LAST body line rather than against 100px, because the number is the
    kit's to choose — what this case is about is whether the box cuts the content off, which is
    true whatever `maxHeight` the kit picks.
  */
  const clipped = await measure(CLIP);
  const compact = await body();
  if (!clipped) {
    problems.push('compact: no clipping box — the card is rendering its body with no wrapper');
  } else if (compact.last && clipped.h >= compact.last.y + compact.last.h - clipped.y) {
    problems.push(`compact: the ${clipped.h}px box is tall enough for the whole body — nothing is clipped`);
  }
  // And a way out of it, which is the other half of being collapsed.
  if ((await count('.we-collapsed-content button')) === 0) {
    problems.push('compact: clipped with no toggle — the rest of the body is unreachable');
  }

  /*
    Expanded: no wrapper at all, and the whole body on screen.

    Both asserted, because they fail separately: a wrapper that still measures correctly passes the
    height check while clipping a popover, and a missing wrapper with a stale height fails the
    second while passing the first.
  */
  await click('we-button:has-text("Expanded mode")');
  if ((await count('.we-collapsed-content')) > 0) {
    problems.push('expanded: the collapsing wrapper is still there — nothing to collapse should mean no box');
  }
  const open = await body();
  if (open.lines.length !== compact.lines.length) {
    problems.push(
      `expanded: ${open.lines.length} body lines against ${compact.lines.length} compact — the body changed`,
    );
  }
  if (open.last && open.first && open.last.y + open.last.h <= open.first.y + open.first.h) {
    problems.push('expanded: the body has no height — it is still inside something clipping it');
  }

  /*
    Back to compact, which is the reactivity check.

    A card that decided its shape once renders the expanded form here: no wrapper, nothing clipped,
    and a body that stays as tall as it was.
  */
  await click('we-button:has-text("Compact mode")');
  const again = await measure(CLIP);
  if (!again) {
    problems.push('back to compact: the clipping box did not come back — the shape was decided once and frozen');
  } else if (clipped && Math.abs(again.h - clipped.h) > 2) {
    problems.push(`back to compact: the box is ${again.h}px against ${clipped.h}px the first time`);
  }

  return problems;
}
