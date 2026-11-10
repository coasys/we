/**
 * A running call's bar: the Live badge and the transcript export beside the Page / Canvas switch.
 *
 * The badge was `md`, which in Glow is exactly the height of the switch's track — and so a size
 * bigger than the Page and Canvas pills inside it, which are what the eye compares it with. An md
 * badge also had no gap, so its dot touched the word. Measured rather than asserted from props,
 * because both are arithmetic a browser does: a badge's height is its size's component height plus
 * the theme's offset.
 */
export const name = "a call's bar: Live and the export beside Page and Canvas";
export const scenario = 'coasys:call-bar';
export const widths = [900];

export async function check({ evaluate, partStyle, screenshot }) {
  const problems = [];
  await screenshot('coasys-call-bar');

  const boxes = await evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, h: r.height, mid: r.top + r.height / 2 };
    };
    const badge = document.querySelector('we-badge');
    const page = [...document.querySelectorAll('we-button')].find((b) => (b.textContent ?? '').trim() === 'Page');
    // The switch is the first box around Page taller than Page itself; a renderer wrapper in
    // between is `display: contents` and has none.
    let around = page?.parentElement;
    while (around && around.getBoundingClientRect().height <= page.getBoundingClientRect().height)
      around = around.parentElement;
    return { badge: box(badge), pill: box(page), switch: box(around), dot: !!badge?.querySelector('we-animated-icon') };
  });
  if (!boxes.badge) return ['no Live badge'];
  if (!boxes.switch) return ['no Page / Canvas switch'];
  if (!boxes.dot) problems.push('the Live badge has no animated dot');
  if (Math.abs(boxes.badge.h - boxes.pill.h) > 1) {
    problems.push(`the Live badge is ${boxes.badge.h}px tall beside ${boxes.pill.h}px Page and Canvas pills`);
  }
  if (Math.abs(boxes.badge.mid - boxes.switch.mid) > 1) {
    problems.push(`the badge's middle is ${Math.round(boxes.badge.mid - boxes.switch.mid)}px off the switch's`);
  }

  const gap = await partStyle('we-badge', 'column-gap');
  if (!gap || gap === '0px' || gap === 'normal') problems.push(`no gap between the dot and Live (${gap})`);

  // The export asks for this call's transcript.
  const exported = await evaluate(async () => {
    const button = [...document.querySelectorAll('we-button')].find(
      (b) => b.getAttribute('label') === 'Export the transcript' || b.label === 'Export the transcript',
    );
    if (!button) return 'no button';
    button.click();
    await new Promise((r) => setTimeout(r, 50));
    return globalThis.__exported ?? 'not called';
  });
  if (exported !== 'call-1') problems.push(`the export button gave ${exported}, not call-1`);

  return problems;
}
