/**
 * A newer version of an installed app that asks for more than the installed one was agreed to says so
 * on its own, before the full list — where it would read as one more line of what was already agreed.
 */
export const name = 'an app update names what it asks for that was never agreed to';
export const scenario = 'bundle:update-asks-more';
export const widths = [420];

export async function check({ count }) {
  const problems = [];
  const says = async (text, what) => {
    if (!(await count(`text=${text}`))) problems.push(`it does not say ${what}`);
  };

  await says('Update Field Guide to 1.1.0?', 'that it is an update');
  await says('New in this version', 'that some of it is new');
  await says('It will also be able to', 'what more it will be able to do');
  await says('See who is in this space', 'the new capability');
  await says('It also turns on', 'which more modules it turns on');
  await says('Calls', 'the new module');
  await says('It also brings kinds of record', 'which new record types it brings');
  await says('Survey', 'the new record type');
  if (await count('text=asks for nothing the one you have'))
    problems.push('it says nothing is new while listing what is');
  return problems;
}
