/**
 * A space's default template, set from its settings page, shows on the page at once.
 *
 * The page configures whichever space was clicked, usually not the one on screen, and its rows are
 * the space store's held records — read once, not followed. The press runs the space's operation
 * through the host with the real run held: only the pending write drawn over the held record can
 * mark the row as the default before it lands, and the row must keep saying so once it has.
 */
export const name = 'a space default drawn on its settings row before it lands';
export const scenario = 'blank';
export const widths = [720];

/** The rows the page marks as the default, by the name each row shows. */
const defaults = () =>
  [...document.querySelectorAll('#mount we-badge')]
    .filter((badge) => badge.textContent?.trim() === 'Default')
    .map((badge) => {
      // The row is the nearest box around the badge that says more than the badge does.
      let row = badge.parentElement;
      while (row && row.textContent?.trim() === 'Default') row = row.parentElement;
      return row?.textContent?.replace('Default', '').trim() ?? '';
    });

export async function check({ click, evaluate }) {
  const problems = [];
  const settle = () => evaluate(() => new Promise((r) => setTimeout(r, 200)));
  const marked = () => evaluate(defaults);

  await evaluate(() => window.__harness.operationsProbe('defaults'));
  await settle();
  if ((await marked()).length) return [`a template was the default before anything was pressed: ${await marked()}`];

  const buttons = await evaluate(
    () =>
      [...document.querySelectorAll('#mount we-button')].filter((b) => b.textContent?.includes('Set as default'))
        .length,
  );
  if (buttons < 2)
    return [
      `the page offers no default to set: "${(await evaluate(() => document.getElementById('mount')?.textContent ?? '')).slice(0, 400)}"`,
    ];
  // The Garden row's "Set as default": the second template row on the page.
  await click('#mount we-button:has-text("Set as default") >> nth=1');
  await settle();
  const pending = await marked();
  if (pending.length !== 1 || !pending[0].includes('Garden'))
    problems.push(`the press was not drawn on the row before its write landed: ${JSON.stringify(pending)}`);

  await evaluate(() => window.__harness.operationsLand());
  await settle();
  await evaluate(() => new Promise((r) => setTimeout(r, 600)));
  const landed = await marked();
  if (landed.length !== 1 || !landed[0].includes('Garden'))
    problems.push(`the row stopped saying so once the write landed: ${JSON.stringify(landed)}`);
  return problems;
}
