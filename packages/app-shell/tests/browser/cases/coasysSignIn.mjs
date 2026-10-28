/**
 * The Coasys sign-in screen: WE's, placed as parts, in Glow — with Coasys's mark and name in the
 * corner where the rail draws them, and its own words on the form, given as the form's inputs.
 */
export const name = 'the Coasys sign-in screen';
export const scenario = 'signIn:coasys';
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
    const mark = deep(document, 'we-image')[0]?.getBoundingClientRect();
    const others = deep(document, 'we-button').filter((b) => /Grace Hopper|Alan Kay/.test(text(b)));
    return {
      buttons: deep(document, 'we-button').map(text),
      labels: deep(document, 'we-form-field').map((f) => f.label),
      mark: mark && { x: Math.round(mark.x), y: Math.round(mark.y), w: Math.round(mark.width) },
      others: others.map((b) => ({
        x: b.getBoundingClientRect().x,
        bottom: innerHeight - b.getBoundingClientRect().bottom,
      })),
    };
  });
  // The form's inputs: its words, not WE's, with nothing of the form opened or copied.
  if (!seen.buttons.includes('Unlock')) problems.push(`no Unlock button — the buttons say ${seen.buttons.join(', ')}`);
  if (seen.buttons.includes('Login')) problems.push('the form still says Login');
  if (!seen.labels.includes('Password'))
    problems.push(`the password field is not labelled — labels ${JSON.stringify(seen.labels)}`);
  // The corner the rail draws (see the lockup case for the rail's side).
  if (!seen.mark || seen.mark.x !== 22 || seen.mark.y !== 22 || seen.mark.w !== 28)
    problems.push(`the mark is ${JSON.stringify(seen.mark)}, not 28px at 22,22`);
  if (seen.others.length !== 2 || !seen.others.every((o) => o.x < 100 && o.bottom < 200))
    problems.push(`the other accounts are not two in the bottom-left corner: ${JSON.stringify(seen.others)}`);
  await screenshot('sign-in-coasys');
  return problems;
}
