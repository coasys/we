/**
 * A press on a row of the Coasys tree opens it and a second press closes it, as its caret does.
 *
 * It used to open only: a press never closed a row, and only the caret did, which read as two rules
 * for one row. Pressed with the real pointer, on the row's label rather than its caret.
 */
export const name = 'the Coasys tree, a row pressed twice';
export const scenario = 'coasys:tree-dna';
export const widths = [320];

export async function check({ evaluate, pressAt }) {
  const problems = [];
  const visible = (text) =>
    evaluate((t) => {
      const label = (i) =>
        [...i.children].find((c) => c.getAttribute('slot') !== 'children')?.textContent?.trim() ?? '';
      return [...document.querySelectorAll('we-tree-item')].some(
        (i) => i.getBoundingClientRect().height > 0 && new RegExp(`^${t}\\d*$`).test(label(i)),
      );
    }, text);
  const press = async (text) => {
    const at = await evaluate((t) => {
      const label = (i) =>
        [...i.children].find((c) => c.getAttribute('slot') !== 'children')?.textContent?.trim() ?? '';
      const item = [...document.querySelectorAll('we-tree-item')].find((i) => new RegExp(`^${t}\\d*$`).test(label(i)));
      const row = item?.shadowRoot?.querySelector('[part="row"]')?.getBoundingClientRect();
      // On the label, well clear of the caret at the row's end.
      return row && { x: row.x + 48, y: row.y + row.height / 2 };
    }, text);
    if (!at) return problems.push(`no "${text}" row to press`);
    await pressAt(at.x, at.y);
    await evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
  };

  await press('Social DNA');
  if (!(await visible('Signal types'))) problems.push('pressing Social DNA did not open it');
  await press('Signal types');
  if (!(await visible('Like'))) problems.push('pressing Signal types did not open it');
  await press('Signal types');
  if (await visible('Like')) problems.push('pressing Signal types again did not close it');
  await press('Social DNA');
  if (await visible('Signal types')) problems.push('pressing Social DNA again did not close it');
  return problems;
}
