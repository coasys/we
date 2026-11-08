/**
 * A bot's page says who else can change its grant.
 *
 * Widening a bot's spaces or actions, or resuming it, does not go through the identity window: any
 * app the person let manage their identity can do it, as the executor's `bot.setGrant` allows. A
 * page that said nothing would let the person believe the grant is theirs alone to change.
 */
export const name = "a bot's page says which apps can change its grant";
export const scenario = 'bots:detail';
export const widths = [900];

export async function check({ count, screenshot }) {
  const problems = [];
  await screenshot('bots-detail');
  if (!(await count('text=What it may do'))) problems.push('the grant editor was not drawn');
  if (!(await count('text=Apps you let manage your identity can change this grant')))
    problems.push('it does not say which apps can change the grant');
  if (!(await count('text=without asking you again'))) problems.push('it does not say the person is not asked again');
  return problems;
}
