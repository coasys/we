/**
 * The theme panel's headings arrive as the kit draws them.
 *
 * The panel is hand-written Solid, and its section titles were spread from the kit's label props —
 * a spread that delivered `variant` and `color` and silently dropped `textTransform` and
 * `letterSpacing`, so the titles were never in capitals and read as one more line of the sections
 * under them. `check:we-props` now refuses that spread; this reads the result off the page, and with
 * `WE_BROWSER_SHOTS` photographs the panel closed and with sections open.
 */
export const name = 'theme panel headings';
export const scenario = 'blank';
export const widths = [380];

export async function check({ themePanel, evaluate, screenshot }) {
  await themePanel();
  await screenshot('theme-panel-closed');
  const problems = [];
  for (const title of ['Theme Editor', 'Base preset', 'Colour']) {
    const style = await evaluate((t) => {
      const el = [...document.querySelectorAll('we-text')].find((n) => n.textContent.trim() === t);
      const base = el && el.shadowRoot.querySelector('[part=base]');
      return base && { transform: getComputedStyle(base).textTransform, spacing: getComputedStyle(base).letterSpacing };
    }, title);
    if (!style) problems.push(`no heading "${title}"`);
    else if (style.transform !== 'uppercase') problems.push(`"${title}" is ${style.transform}, not in capitals`);
    else if (style.spacing === 'normal' || style.spacing === '0px') problems.push(`"${title}" has no tracking`);
  }
  await evaluate(() => {
    for (const title of ['Colour', 'Type']) {
      const text = [...document.querySelectorAll('we-text')].find((t) => t.textContent.trim() === title);
      text?.closest('we-button')?.click();
    }
  });
  await new Promise((r) => setTimeout(r, 300));
  await screenshot('theme-panel-open');
  return problems;
}
