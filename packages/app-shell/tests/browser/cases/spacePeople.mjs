/**
 * A space's People page draws its members and their roles from records.
 *
 * The members are `spaceStore.memberDids` joined to `profileStore.profiles`, and the roles the space's
 * `Role` and `RoleGrant` records — so this is the page a template now writes in expressions rather
 * than reading the store's view of it. Checked as a person reads it:
 *
 * - **who is listed** — the two members with a profile, and not the one whose profile has not arrived;
 * - **their badges** — Ann holds Admin and Moderator; Ben's moderator grant was revoked, so none;
 * - **the roles** — Admin first whatever order the records came in, each counting who holds it.
 */
export const name = 'the People page draws members and roles from records';
export const scenario = 'space:people';
export const widths = [480];

export async function check({ evaluate }) {
  const problems = [];
  await new Promise((resolve) => setTimeout(resolve, 300));
  const page = await evaluate(() => {
    const texts = [...document.querySelectorAll('we-text')].map((t) => t.textContent?.trim() ?? '');
    const rowOf = (label) => {
      const text = [...document.querySelectorAll('we-text')].find((t) => t.textContent?.trim() === label);
      let box = text?.parentElement;
      while (box && !box.querySelector('we-avatar')) box = box.parentElement;
      return box;
    };
    const badges = (label) =>
      [...(rowOf(label)?.querySelectorAll('we-badge') ?? [])].map((b) => b.textContent?.trim() ?? '');
    return {
      texts,
      ann: badges('Ann Okafor'),
      ben: badges('Ben Ruiz'),
      roleOrder: texts.filter((t) => t === 'Admin' || t === 'Moderator'),
      counts: texts.filter((t) => /^\d+ (person|people)$/.test(t)),
    };
  });
  if (!page.texts.includes('Ann Okafor') || !page.texts.includes('Ben Ruiz'))
    problems.push(`the members with a profile are not both listed (${JSON.stringify(page.texts.slice(0, 40))})`);
  if (page.texts.some((t) => t.includes('did:test:cy'))) problems.push('a member with no profile yet was drawn');
  if (JSON.stringify(page.ann) !== JSON.stringify(['Admin', 'Moderator']))
    problems.push(`Ann's badges read ${JSON.stringify(page.ann)}, not Admin and Moderator`);
  if (page.ben.length) problems.push(`Ben's revoked grant still shows as ${JSON.stringify(page.ben)}`);
  if (page.roleOrder[0] !== 'Admin')
    problems.push(`the roles do not lead with Admin (${JSON.stringify(page.roleOrder)})`);
  if (JSON.stringify(page.counts) !== JSON.stringify(['1 person', '1 person']))
    problems.push(`each role should count one holder, read ${JSON.stringify(page.counts)}`);
  return problems;
}
