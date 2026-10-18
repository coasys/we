/**
 * Safe mode can be left into another app, so an app that hides every way out of it — or does not
 * finish loading — is not where leaving has to go. Leaving without picking goes back to the app that
 * was chosen, as it always did.
 */
export const name = 'safe mode can be left into another app';
export const scenario = 'safe-mode:leaving';
export const widths = [900];

export async function check({ count, click }) {
  const problems = [];
  if (!(await count('text=did not finish loading last time'))) problems.push('it does not say why safe mode is on');
  if (!(await count('we-select'))) problems.push('it offers no other app to leave into');

  await click('we-button:has-text("Leave safe mode")');
  if (!(await count('body[data-left]'))) problems.push('leaving without picking does not go back to the chosen app');

  await click('we-select');
  await click('text=Workbench');
  await click('we-button:has-text("Leave safe mode")');
  if (!(await count('body[data-left-into="workbench"]')))
    problems.push('leaving after picking an app does not go into it');
  return problems;
}
