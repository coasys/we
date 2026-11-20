/**
 * The Feed with older lines not yet loaded: nothing is drawn for them, and the list still says which
 * end has more.
 *
 * - No spinner and no "Earlier in the space…" line above the oldest loaded line.
 * - The list carries `data-we-more="start"`, the edge away from the newest-at-the-foot anchor, so the
 *   scroller's jump to the top asks for older lines instead of scrolling.
 */
export const name = 'the Feed with more beyond the window';
export const scenario = 'feed:view-more';
export const widths = [720];

export async function check({ evaluate, screenshot }) {
  const problems = [];
  await screenshot?.('feed-view-more');
  const drawn = await evaluate(() => ({
    words: /(Earlier|Later) in /.test(document.body.innerText),
    spinners: document.querySelectorAll('we-animated-icon').length,
    marker: [...document.querySelectorAll('[data-we-more]')].map((el) => el.getAttribute('data-we-more')),
  }));
  if (drawn.words) problems.push('draws an "Earlier in …" line');
  if (drawn.spinners) problems.push(`${drawn.spinners} spinners in a loaded Feed`);
  if (!drawn.marker.includes('start'))
    problems.push(`no data-we-more="start" marker (found ${JSON.stringify(drawn.marker)})`);
  return problems;
}
