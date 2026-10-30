/**
 * A Coasys view's bar: where the view is as a trail, each step before the last a way back to it, and
 * Page and Canvas at its end, the one in use marked.
 */
export const name = 'the Coasys bar, its trail and Page or Canvas';
export const scenario = 'coasys:bar';
export const widths = [900, 420];

export async function check({ evaluate, screenshot }, width) {
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

  // The steps back are buttons; where the view is, is not.
  const steps = buttons.filter((b) => ['Social DNA', 'Signal types', 'Like'].includes(b.text)).map((b) => b.text);
  if (JSON.stringify(steps) !== JSON.stringify(['Social DNA', 'Signal types']))
    problems.push(`the steps back are ${JSON.stringify(steps)}, not Social DNA and Signal types`);

  // Every step is on screen, in order on one line, and the last is not pushed out of the bar.
  const boxes = await evaluate(() =>
    [...document.querySelectorAll('we-text')]
      .filter((t) => ['Social DNA', 'Signal types', 'Like'].includes((t.textContent ?? '').trim()))
      .map((t) => {
        const r = t.getBoundingClientRect();
        return { text: t.textContent.trim(), x: r.x, w: r.width, y: Math.round(r.y + r.height / 2) };
      }),
  );
  if (boxes.length !== 3) problems.push(`${boxes.length} steps drawn, not 3`);
  else {
    if (!(boxes[0].x < boxes[1].x && boxes[1].x < boxes[2].x))
      problems.push(`steps out of order: ${JSON.stringify(boxes)}`);
    if (new Set(boxes.map((b) => b.y)).size !== 1) problems.push(`steps not on one line: ${JSON.stringify(boxes)}`);
    if (boxes.some((b) => b.w < 20)) problems.push(`a step squeezed to nothing: ${JSON.stringify(boxes)}`);
  }

  // A step back goes there.
  await evaluate(() => {
    const step = [...document.querySelectorAll('we-button')].find((b) => b.textContent.trim() === 'Signal types');
    step.shadowRoot?.querySelector('button')?.click() ?? step.click();
  });
  const went = await evaluate(() => globalThis.__navigated);
  if (went !== '/dna?dna=signal') problems.push(`pressing Signal types went to ${went}`);

  await screenshot(`coasys-bar-${width}`);
  return problems;
}
