/**
 * A newer version of an installed app that asks for more than the installed one was agreed to says so
 * on its own, and folds away what was agreed already — under its own name, so it never reads as
 * something the update adds — where it can still be opened and checked.
 */
export const name = 'an app update names what it asks for that was never agreed to';
export const scenario = 'bundle:update-asks-more';
export const widths = [420];

export async function check({ count, click }) {
  const problems = [];
  const says = async (text, what) => {
    if (!(await count(`text=${text}`))) problems.push(`it does not say ${what}`);
  };

  await says('Update Field Guide to 1.1.0?', 'that it is an update');
  await says('This version asks for more', 'that it asks for more');
  await says('You haven’t agreed to these for the version you have.', 'why it is asking');
  await says('It will also be able to', 'what more it will be able to do');
  await says('See who is in this space', 'the new capability');
  // "Uses", not "turns on": a module already on is new to the agreement and turns nothing on. Whether
  // one is off is said by the install's own "It turns on" list.
  await says('It also uses', 'which more modules it uses');
  if (await count('text=It also turns on')) problems.push('it says it turns on a module that may already be on');
  await says('Calls', 'the new module');
  await says('It also brings kinds of record', 'which new record types it brings');
  await says('Survey', 'the new record type');
  if (await count('text=can do nothing the one you have could not'))
    problems.push('it says nothing is new while listing what is');

  if (await count('text=Read and write the content of this space'))
    problems.push('what was agreed already is listed again, unfolded, beside what is new');
  const fold = 'we-button:has-text("What you already agreed to")';
  if (await count(fold)) {
    await click(fold);
    await says('Read and write the content of this space', 'what was agreed already, once opened');
  } else problems.push('what was agreed already cannot be opened');
  if (!(await count('we-button:has-text("Update")'))) problems.push('there is no Update button');
  return problems;
}
