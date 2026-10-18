/**
 * The file an installed app came from changes nothing if installed again, so the prompt says so and
 * offers nothing to press but Close.
 */
export const name = 'the file an app was installed from says it is already installed';
export const scenario = 'bundle:already-installed';
export const widths = [420];

export async function check({ count, click }) {
  const problems = [];
  if (!(await count('text=Field Guide 1.0.0 is already installed'))) problems.push('it does not say it is installed');
  if (!(await count('text=installing it again would change nothing')))
    problems.push('it does not say nothing would change');
  if (await count('we-button:has-text("Update")')) problems.push('it offers an Update that would change nothing');
  if (await count('text=It adds')) problems.push('it lists what the app adds, as though it were adding it');
  await click('we-button:has-text("Close")');
  if (!(await count('body[data-bundle-cancelled]'))) problems.push('Close did not close');
  return problems;
}
