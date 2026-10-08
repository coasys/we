/**
 * A timeline in each of its four readings opens at its anchored end, with "more" at the other.
 *
 * The four come down to one question — is the anchored end the bottom? — and getting it wrong is
 * quiet: a list that opens at the wrong end looks like a list somebody scrolled, and a marker at the
 * wrong edge makes the jump button at that end scroll instead of asking for the rest. Neither is
 * checkable without layout, which is why this is here and not in a unit test.
 *
 * One case per reading, sharing `checkReading`; this file is the newest-at-bottom, live-end one.
 */
export const name = 'a live timeline drawn newest-at-bottom opens at the bottom, with more above';
export const scenario = 'timeline:live-newest-bottom';
export const widths = [420];

export async function check(api) {
  return checkReading(api, { anchor: 'bottom', more: 'start' });
}

/** The anchored row is on screen and at its end of the box; the marker is at the other edge. */
export async function checkReading({ measure, measurePart }, { anchor, more }) {
  const problems = [];
  const view = await measurePart('#feed', 'base');
  const row = await measure('#anchor-row');
  const marker = await measure(`#more-${more}`);
  const other = await measure(`#more-${more === 'start' ? 'end' : 'start'}`);
  if (!view || !row) return ['expected a scroll area and the row nearest the anchor'];
  if (view.scrollH <= view.h) return [`the content is ${view.scrollH}px in a ${view.h}px box — nothing scrolls`];

  const visible = row.y >= view.y - 1 && row.y + row.h <= view.y + view.h + 1;
  if (!visible) {
    problems.push(
      `the row nearest the anchor (y=${Math.round(row.y)}) is not on screen (box ${Math.round(view.y)}..` +
        `${Math.round(view.y + view.h)}) on open — the list opened at the wrong end`,
    );
  }
  const nearer = anchor === 'bottom' ? row.y + row.h > view.y + view.h / 2 : row.y < view.y + view.h / 2;
  if (!nearer) problems.push(`the row nearest the anchor is not in the ${anchor} half of the box`);

  if (!marker || marker.h === 0) problems.push(`no "more" marker at the ${more} edge`);
  if (other && other.h > 0)
    problems.push(`a "more" marker at the anchored edge too — the jump there would ask, not scroll`);
  return problems;
}
