/**
 * A template cannot read the page through what a handler hands it (coasys/we#282).
 *
 * The scenario holds a secret in storage and a cookie, and its button tries every route to them that
 * once worked: the event's target walked to the document, a node kept in a local and walked later,
 * and `pick()` over the target. Whatever comes back is drawn, so a leak is on the page to be found.
 * Run in a real browser because jsdom implements the DOM in JavaScript, and the rule tells the page
 * from data partly by native code, which only a browser has.
 */
export const name = 'a template cannot read the page through an event';
export const scenario = 'security:page-through-event';
export const widths = [320];

export async function check({ count, click, note }) {
  await click('#reach');
  const problems = [];
  if (!(await count('#reach-ran'))) problems.push('the handler never ran, so this proves nothing');
  const leaked = [];
  if (await count('#reach-leaked:has-text("TOP-SECRET")')) leaked.push('localStorage');
  if (await count('#reach-leaked:has-text("SESSION-COOKIE")')) leaked.push('document.cookie');
  if (leaked.length) problems.push(`the template read ${leaked.join(' and ')}`);
  note(leaked.length ? `leaked: ${leaked.join(', ')}` : 'every route came back empty');
  return problems;
}
