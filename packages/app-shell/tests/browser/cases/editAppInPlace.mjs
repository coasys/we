/**
 * The app around every space is edited where it is drawn.
 *
 * The chrome surrounds everything, so it is gone into from the inspector rather than by a press;
 * once in, a press inside the chrome selects the app's node, and a press in the page or Escape at the
 * app's top comes back out.
 */
export const name = 'the app is edited where it is drawn';
export const scenario = 'security:self-firing-events';
export const widths = [320];

export async function check({ call, clickAt, key, count, recorded }) {
  const problems = [];
  const last = async (bag) => (await recorded(bag)).at(-1);

  // The inspector's bar is the way in, and Done the way out.
  await call('ownerCardProbe', 'targets');
  try {
    if (!(await call('pressButton', 'Edit the app'))) problems.push('the inspector offers no way into the app');
    if (!(await count('we-text:has-text("Editing WE, the app around every space")')))
      problems.push('the inspector does not say the app is being edited');
    if (!(await call('pressButton', 'Done'))) problems.push('editing the app offers no Done');
    if (!(await recorded('__probeLeft')).length) problems.push('Done does not leave the app');
  } finally {
    await call('editorProbeDispose');
  }

  await call('editorProbe');
  try {
    // Outside the app, its chrome is not the editor's: a press there selects nothing of it.
    await clickAt('#probe-n-app-inner');
    if ((await last('__probeSelected')) === 'n-app-inner')
      problems.push('the app’s chrome was selectable without going in');

    await call('editorProbeEnterApp');
    await clickAt('#probe-n-app-inner');
    if ((await last('__probeSelected')) !== 'n-app-inner')
      problems.push('a press inside the app did not select its node');

    await clickAt('#probe-n-content');
    if ((await last('__probeTarget')) !== 'screen') problems.push('a press in the page did not leave the app');
    if ((await last('__probeSelected')) !== 'n-content') problems.push('a press in the page did not select there');

    await call('editorProbeEnterApp');
    await clickAt('#probe-n-app-inner');
    await key('Escape');
    if ((await last('__probeTarget')) !== 'screen') problems.push('Escape at the app’s top did not leave it');
    return problems;
  } finally {
    await call('editorProbeDispose');
  }
}
