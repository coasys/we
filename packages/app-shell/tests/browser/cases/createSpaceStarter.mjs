/**
 * The create dialog says what a new space starts with — the app's kit until somebody changes it —
 * and Change offers every starter in place, the one picked reaching `createSpace` by id.
 *
 * Not swept across widths, for the reason `createSpaceServer` gives. `WE_BROWSER_SHOTS` photographs
 * each step.
 */
export const name = 'the create dialog shows what a space starts with, and choosing another reaches createSpace';
export const scenario = 'space:create-shared';
export const widths = [560];

export async function check({ click, count, type, hover, screenshot }) {
  const problems = [];
  await type('we-input input', 'Garden');

  await hover('text=Starts with');
  await screenshot('create-space-starter');
  if (!(await count("text=Coasys's starter kit"))) problems.push('the app’s kit is not what a new space starts with');
  if (await count('text=Empty space')) problems.push('the other choice shows before anybody asks to change');

  await click('we-button:has-text("Change")');
  for (const choice of ["Coasys's starter kit", 'Empty space']) {
    if (!(await count(`we-button:has-text("${choice}")`))) problems.push(`Change does not offer ${choice}`);
  }
  await hover('text=Empty space');
  await screenshot('create-space-starter-choosing');

  await click('we-button:has-text("Empty space")');
  if (await count('we-button:has-text("Coasys")')) problems.push('choosing a starter leaves the list open');
  if (!(await count('text=Set up your own in Social DNA'))) problems.push('the card does not show the starter chosen');
  await hover('text=Starts with');
  await screenshot('create-space-starter-nothing');

  await click('we-button:has-text("Create Space")');
  if (!(await count("body[data-starter='$none']"))) problems.push('the starter chosen did not reach createSpace');
  return problems;
}
