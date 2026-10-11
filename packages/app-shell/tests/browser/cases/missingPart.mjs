/**
 * Where a part's module is off, a marker the size of a control stands in — not a card.
 *
 * The card it replaced named the part, the reason, a fix and a way to remove it, so a row of icon
 * buttons grew a box in the middle. The part never drew, so there is no size of its own to keep; a
 * control's square is the honest guess, and the details are where somebody looks for them.
 */
export const name = 'a missing part stands in small, and says why on demand';
export const scenario = 'security:self-firing-events';
export const widths = [320];

export async function check({ call, measure, count, click, prop, recorded }) {
  const problems = [];

  await call('missingPartProbe', 'editing');
  try {
    const marker = await measure('[data-we-part-missing]');
    if (!marker || marker.w > 32 || marker.h > 32)
      problems.push(`the marker is ${marker?.w}x${marker?.h}, not a control's size`);
    if (await count('#probe-missing-row :text("is not here")'))
      problems.push('the marker spells out the reason in the page');
  } finally {
    await call('editorProbeDispose');
  }

  await call('missingPartProbe', 'fixable');
  try {
    if ((await count('we-button[data-we-part-missing]')) !== 1) problems.push('somebody who can fix it gets no button');
    const tip = await prop('we-tooltip', 'content');
    if (!String(tip).includes('Calls is turned off in this space.')) problems.push('the reason is not there on hover');
    await click('we-button[data-we-part-missing]');
    if (!(await recorded('__probeFixed')).length) problems.push('pressing the marker does not go to the fix');
  } finally {
    await call('editorProbeDispose');
  }

  await call('missingPartProbe', 'unfixable');
  try {
    if (await count('[data-we-part-missing]')) problems.push('somebody who cannot fix it is shown a marker');
  } finally {
    await call('editorProbeDispose');
  }
  return problems;
}
