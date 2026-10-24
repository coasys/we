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

  // A colour picked for the accent is drawn as picked: written as its settings, the preset's own
  // accent formula unpinned, and no note saying the theme drew something else.
  const picked = await evaluate(async () => {
    const picker = document.querySelector('we-color-picker');
    picker.dispatchEvent(new CustomEvent('change', { detail: '#3b82f6', bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r, 400));
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'var(--we-role-accent)';
    picker.closest('we-scroll-area').appendChild(probe);
    const drawn = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const adjusted = [...document.querySelectorAll('we-text')].some((t) =>
      t.textContent.includes('Adjusted so its label'),
    );
    return { drawn, adjusted };
  });
  if (picked.adjusted) problems.push(`a plain blue accent was reported as adjusted (drawn ${picked.drawn})`);
  await screenshot('theme-panel-picked');
  await evaluate(() => {
    const heading = [...document.querySelectorAll('we-text')].find((t) => t.textContent.trim() === 'Colour');
    const scroller = heading?.closest('we-scroll-area');
    const viewport = scroller?.shadowRoot?.querySelector('[part=viewport], [part=base]') ?? scroller;
    if (viewport) viewport.scrollTop += heading.getBoundingClientRect().top - 300;
  });
  await new Promise((r) => setTimeout(r, 200));
  await screenshot('theme-panel-colour');
  return problems;
}
