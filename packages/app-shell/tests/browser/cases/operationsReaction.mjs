/**
 * A reaction is drawn on the press, before its write lands, and stays drawn when it does.
 *
 * The press runs the whole path a template's does: the kit's reaction handler, the host's
 * `invokeOperation`, a speculative run whose predicted reaction is laid over the record's `signals`,
 * and the real run — held here until the case lets it land, which is the only moment drawing it
 * early is visible at all. Then the same press again takes it back, also before it lands.
 */
export const name = 'a reaction drawn before it lands';
export const scenario = 'blank';
export const widths = [420];

const text = () => document.getElementById('mount')?.textContent ?? '';

export async function check({ click, evaluate }) {
  const problems = [];
  const read = () => evaluate(text);
  const settle = () => evaluate(() => new Promise((r) => setTimeout(r, 150)));
  // A real press: a click the page did not make itself is not somebody asking, and writes nothing.
  const press = () => click('#mount we-button');

  await evaluate(() => window.__harness.operationsProbe('reaction'));
  await settle();
  if (!(await read()).includes('likes 0 mine 0')) return [`the post did not draw unreacted: "${await read()}"`];

  await press();
  await settle();
  if (!(await read()).includes('likes 1 mine 1'))
    problems.push(`the press was not drawn before its write landed: "${await read()}"`);

  await evaluate(() => window.__harness.operationsLand());
  await settle();
  if (!(await read()).includes('likes 1 mine 1')) problems.push(`the reaction went once it landed: "${await read()}"`);

  await evaluate(() => window.__harness.operationsHold());
  await press();
  await settle();
  if (!(await read()).includes('likes 0 mine 0'))
    problems.push(`taking it back was not drawn before it landed: "${await read()}"`);
  await evaluate(() => window.__harness.operationsLand());
  await settle();
  if (!(await read()).includes('likes 0 mine 0')) problems.push(`the reaction came back after: "${await read()}"`);
  return problems;
}
