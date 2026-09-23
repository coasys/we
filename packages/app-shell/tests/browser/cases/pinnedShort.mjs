/**
 * A pinned list opens at its newest end and **stays there while its rows grow**.
 *
 * The second half is the whole point, and it is what two previous fixes missed. A transcript's rows
 * keep getting taller for seconds after they mount, as bylines resolve and avatars load. The old
 * implementation jumped to the bottom, the content grew, the browser moved the scroller to keep the
 * reader's place, the element read that as the reader scrolling away — and it gave up 45px short of
 * the end, in silence, permanently. Measured in the app, not inferred: growth of 479px, the scroller
 * moved 434px, 45px left over.
 *
 * So the case presses `grow`, which reflows every row, and requires the newest line to be exactly as
 * visible afterwards as before. Nothing about that is checkable in jsdom, which lays nothing out —
 * and nothing about it was checkable in the earlier version of this case, which only measured a
 * first paint.
 *
 * The short length is deliberate: a list barely taller than its panel was the case that failed while
 * a long one looked fine, so both lengths run the same assertions.
 */
export const name = 'a short pinned list opens at its end and stays there';
export const scenario = 'ds:pinned-short';
export const widths = [420];

export async function check(api) {
  return checkPinned(api);
}

/** Shared by both lengths — see `pinnedPage` for why there are two. */
export async function checkPinned({ measure, measurePart, click }) {
  const problems = [];

  const view = await measurePart('#feed', 'base');
  const last = await measure('#last-line');
  if (!view || !last) return ['expected a scroll area and a findable last line'];
  if (last.h === 0) return ['the last line has no box, so it never rendered'];
  if (view.scrollH <= view.h) {
    return [`the content is ${view.scrollH}px in a ${view.h}px box — nothing overflows, so nothing is pinned`];
  }

  /*
    At the newest end on the first frame it could be measured on. Under `column-reverse` that is
    where the box rests by layout, so there is no window in which it is somewhere else — which is
    what makes this assertion meaningful rather than a race.
  */
  const visible = (box, port) => box.y >= port.y - 1 && box.y + box.h <= port.y + port.h + 1;
  if (!visible(last, view)) {
    problems.push(
      `the last line (y=${Math.round(last.y)}..${Math.round(last.y + last.h)}) is outside the panel ` +
        `(y=${Math.round(view.y)}..${Math.round(view.y + view.h)}) on open`,
    );
  }

  // Every row gets taller, as a real transcript's do once their bylines arrive.
  const before = view.scrollH;
  await click('#grow');
  await new Promise((resolve) => setTimeout(resolve, 200));

  const grown = await measurePart('#feed', 'base');
  const lastGrown = await measure('#last-line');
  if (!grown || !lastGrown) return [...problems, 'lost the scroll area after growing'];

  if (grown.scrollH <= before) {
    problems.push(
      `pressing grow did not change the content height (${before} -> ${grown.scrollH}) — the case is inert`,
    );
  } else if (!visible(lastGrown, grown)) {
    problems.push(
      `after the rows grew ${grown.scrollH - before}px the last line is outside the panel — the list ` +
        `lost its place, which is the failure this exists for`,
    );
  }

  return problems;
}
