/**
 * A folded `$animate` section opens as smoothly as it closes.
 *
 * Once closed it is taken out of the layout (`display: none`), so the gap either side of it stops
 * being spent. The opening then went straight from `display: none` to open in one style change,
 * which a transition cannot start from — so closing slid and opening jumped. Seen as a rail group
 * that folded away smoothly and reappeared at once.
 *
 * The line below the section is sampled on every frame: an animated opening passes through
 * positions between closed and open; a jump goes from one to the other.
 */
export const name = 'a folded section opens as smoothly as it closes';
export const scenario = 'ds:folding-section';
export const widths = [400];

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

const between = (tops) => {
  const closed = Math.min(...tops);
  const open = Math.max(...tops);
  return { closed, open, middle: tops.filter((top) => top > closed + 2 && top < open - 2).length };
};

export async function check({ call, click, recorded, note }) {
  const problems = [];

  await call('sampleTop', '#below-fold', '__closing', 600);
  await click('#fold-toggle');
  await wait(700);
  const closing = between(await recorded('__closing'));

  await call('sampleTop', '#below-fold', '__opening', 600);
  await click('#fold-toggle');
  await wait(700);
  const opening = between(await recorded('__opening'));

  note(
    `closing ${closing.open}→${closing.closed} over ${closing.middle} frames · opening ${opening.closed}→${opening.open} over ${opening.middle} frames`,
  );
  if (closing.open - closing.closed < 100) problems.push('the section did not close');
  if (opening.open - opening.closed < 100) problems.push('the section did not open');
  if (closing.middle < 3) problems.push('closing did not animate');
  if (opening.middle < 3) problems.push(`opening jumped: ${opening.middle} frames between closed and open`);
  return problems;
}
