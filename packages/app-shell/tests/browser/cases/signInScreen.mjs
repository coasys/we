/**
 * WE's sign-in screen, built from the parts an app's sign-in places: the form in the middle, the other
 * accounts in the bottom-left corner, and the words the form's inputs default to.
 */
export const name = 'WE’s sign-in screen, from its parts';
export const scenario = 'signIn:we';
export const widths = [1200];

export async function check({ evaluate, screenshot }) {
  const problems = [];
  const seen = await evaluate(() => {
    const deep = (root, sel) => {
      const found = [...root.querySelectorAll(sel)];
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) found.push(...deep(el.shadowRoot, sel));
      return found;
    };
    const text = (el) => (el.textContent ?? '').trim();
    const button = deep(document, 'we-button').find((b) => /^(Login|Unlock)$/.test(text(b)));
    const others = deep(document, 'we-button').filter((b) => /Grace Hopper|Alan Kay/.test(text(b)));
    const rect = (el) => el?.getBoundingClientRect();
    return {
      button: button ? text(button) : null,
      buttonX: rect(button) ? rect(button).x + rect(button).width / 2 : null,
      others: others.map((b) => ({ x: rect(b).x, bottom: window.innerHeight - rect(b).bottom })),
      width: window.innerWidth,
    };
  });
  if (seen.button !== 'Login') problems.push(`the unlock button says ${seen.button ?? 'nothing'}, not Login`);
  if (seen.buttonX === null || Math.abs(seen.buttonX - seen.width / 2) > 200)
    problems.push(`the form is not in the middle (its button at ${seen.buttonX})`);
  if (seen.others.length !== 2) problems.push(`${seen.others.length} other accounts shown, not 2`);
  else if (!seen.others.every((o) => o.x < 100 && o.bottom < 200))
    problems.push(`the other accounts are not in the bottom-left corner: ${JSON.stringify(seen.others)}`);
  await screenshot('sign-in-we');
  return problems;
}
