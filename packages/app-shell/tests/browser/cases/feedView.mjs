/**
 * The Feed as a page: its lines and what was found, newest at the foot, with its box under them.
 *
 * - Every line and the activity row are drawn, the line said in a call naming the call.
 * - The box to write in sits at the foot of the view, below the stream, not after it in the flow.
 */
export const name = 'the Feed as a page';
export const scenario = 'feed:view';
export const widths = [720];

export async function check({ evaluate, measureText, screenshot }) {
  const problems = [];
  for (const words of ['Morning all', 'Who has the venue?', 'See you all on Friday'])
    if (!(await measureText(words))) problems.push(`no "${words}" line`);
  if (!(await measureText('2 tasks extracted from Monday sync'))) problems.push('no row for what was found');
  if (!(await measureText('1 suggested'))) problems.push('the row does not say what is still a suggestion');

  const layout = await evaluate(() => {
    const box = document.querySelector('[data-we-line-composer], we-textarea, [contenteditable]');
    const newest = [...document.querySelectorAll('*')].find((el) => el.textContent?.trim() === 'See you all on Friday');
    return {
      box: box?.getBoundingClientRect().bottom,
      newest: newest?.getBoundingClientRect().bottom,
    };
  });
  if (!layout.box) problems.push('no box to write in');
  else if (layout.newest && layout.newest > layout.box) problems.push('the box is above the newest line');
  await screenshot?.('feed-view');
  return problems;
}
