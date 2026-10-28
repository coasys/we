/**
 * A Coasys view's bar: Page and Canvas at its end, the one in use marked.
 */
export const name = 'the Coasys bar, Page or Canvas';
export const scenario = 'coasys:bar';
export const widths = [900];

export async function check({ evaluate, screenshot }) {
  const problems = [];
  const buttons = await evaluate(() =>
    [...document.querySelectorAll('we-button')].map((b) => ({
      text: (b.textContent ?? '').trim(),
      variant: b.variant,
    })),
  );
  const page = buttons.find((b) => b.text === 'Page');
  const canvas = buttons.find((b) => b.text === 'Canvas');
  if (!page || !canvas) problems.push(`no Page and Canvas: ${JSON.stringify(buttons)}`);
  // The address says canvas, so Canvas is the one marked.
  else if (canvas.variant !== 'soft' || page.variant !== 'ghost')
    problems.push(`Canvas is ${canvas.variant} and Page ${page.variant}, not soft and ghost`);
  await screenshot('coasys-bar');
  return problems;
}
