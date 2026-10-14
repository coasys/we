/**
 * The app around every space is edited where it is drawn.
 *
 * The chrome surrounds everything, so it is gone into from the editor bar's Page | App switch rather
 * than by a press;
 * once in, a press inside the chrome selects the app's node, and a press in the page or Escape at the
 * app's top comes back out. While in it the page does not light up, and the press that leaves selects
 * nothing there.
 */
export const name = 'the app is edited where it is drawn';
export const scenario = 'security:self-firing-events';
export const widths = [320];

export async function check({ call, clickAt, moveTo, key, count, recorded }) {
  const problems = [];
  const last = async (bag) => (await recorded(bag)).at(-1);

  // The editor bar's switch is the way in and back, the inspector's bar says where you are, and WE's
  // app — built in — can be forked from there before anything is changed.
  await call('ownerCardProbe', 'targets');
  try {
    if (await count('[data-we-editing-section]')) problems.push('the inspector says something is edited before it is');
    if (!(await call('pressButton', 'App'))) problems.push('the editor offers no way into the app');
    if (!(await count('we-text:has-text("Editing WE, the app around every space")')))
      problems.push('the inspector does not say the app is being edited');
    if (!(await call('pressButton', 'Fork'))) problems.push('editing WE’s app offers no Fork');
    if (!(await recorded('__probeForkStarted')).length) problems.push('Fork does not start forking the app');
    if (!(await call('pressButton', 'Page'))) problems.push('the editor offers no way back to the page');
    if (!(await recorded('__probeLeft')).length) problems.push('Page does not leave the app');
    await call('pressButton', 'App');
    if (!(await call('pressButton', 'Done'))) problems.push('editing the app offers no Done');
    if ((await recorded('__probeLeft')).length < 2) problems.push('Done does not leave the app');
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

    // The page is not lit while the app is edited, and a press there only comes back out.
    await moveTo('#probe-n-content');
    if (await count('[data-we-ring="hover"]')) problems.push('the page lit up while the app was being edited');
    await clickAt('#probe-n-content');
    if ((await last('__probeTarget')) !== 'screen') problems.push('a press in the page did not leave the app');
    if ((await last('__probeSelected')) !== null)
      problems.push(`a press in the page selected ${await last('__probeSelected')} on the way out`);

    await call('editorProbeEnterApp');
    await clickAt('#probe-n-app-inner');
    await key('Escape');
    if ((await last('__probeTarget')) !== 'screen') problems.push('Escape at the app’s top did not leave it');
    return problems;
  } finally {
    await call('editorProbeDispose');
  }
}
