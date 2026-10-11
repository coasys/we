/**
 * A placed part that draws nothing right now can still be found while the template is edited.
 *
 * A microphone meter draws only while there is a microphone, so placed from the palette outside a
 * call it had no box: nothing to ring, nothing to press, and adding it looked like adding nothing.
 */
export const name = 'an empty part stands in while edited, and only then';
export const scenario = 'security:self-firing-events';
export const widths = [320];

export async function check({ call, count }) {
  await call('emptyPartProbe');
  try {
    const problems = [];
    const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
    const standIn = () => count('[data-we-part-empty]');

    await settle();
    if (!(await standIn())) problems.push('an empty part draws no stand-in while edited');
    if (!(await count('[data-we-part-empty]:has-text("nothing to show right now")')))
      problems.push('the stand-in does not say why it is there');

    await call('emptyPartDraws', true);
    await settle();
    if (await standIn()) problems.push('the stand-in stays once the part draws something');

    await call('emptyPartDraws', false);
    await settle();
    if (!(await standIn())) problems.push('the stand-in does not come back when the part empties again');

    await call('emptyPartEditing', false);
    await settle();
    if (await standIn()) problems.push('an empty part draws a stand-in outside editing');
    return problems;
  } finally {
    await call('editorProbeDispose');
  }
}
