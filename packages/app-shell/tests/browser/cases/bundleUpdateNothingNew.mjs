/**
 * A newer version of an installed app that asks for nothing new says it changes the app and can do
 * nothing more, so the person can tell an update that only changes how the app looks and works from
 * one that reaches further. It can still be updated to.
 */
export const name = 'an app update asking for nothing new says so';
export const scenario = 'bundle:update-nothing-new';
export const widths = [420];

export async function check({ count }) {
  const problems = [];
  if (!(await count('text=This version changes how the app looks and works'))) {
    problems.push('it does not say the update changes the app and asks for nothing new');
  }
  if (await count('text=New in this version')) problems.push('it warns about something new when nothing is');
  if (await count('text=Read and write the content of this space'))
    problems.push('what was agreed already is listed again, unfolded');
  if (!(await count('text=What you already agreed to'))) problems.push('what was agreed already cannot be opened');
  if (!(await count('we-button:has-text("Update")'))) problems.push('there is no Update button');
  return problems;
}
