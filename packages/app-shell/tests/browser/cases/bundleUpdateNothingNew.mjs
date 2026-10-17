/**
 * A newer version of an installed app that asks for nothing new says that, so the person can tell an
 * update that only changes how the app looks from one that reaches further.
 */
export const name = 'an app update asking for nothing new says so';
export const scenario = 'bundle:update-nothing-new';
export const widths = [420];

export async function check({ count }) {
  const problems = [];
  if (!(await count('text=This version asks for nothing the one you have could not already do.'))) {
    problems.push('it does not say the update asks for nothing new');
  }
  if (await count('text=New in this version')) problems.push('it warns about something new when nothing is');
  return problems;
}
