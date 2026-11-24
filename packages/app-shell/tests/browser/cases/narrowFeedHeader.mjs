/**
 * A space's Feed page in a narrow window: its bar and its controls stay one compact, readable block.
 *
 * At about 450px the title row gave all its width to the Page / Canvas switch (the title was cut to
 * "F."), and the controls row did not wrap, so the "Show call transcripts" switch was squeezed to
 * nothing, its words breaking a letter to a line, and the header grew hundreds of pixels tall.
 *
 * Asserts, per width, what a reader would see: no text narrower than its own longest word, a title
 * that keeps room for a few letters, and a header — the bar and the controls — that stays short.
 * The page is waited on by its state (the Feed's controls being on the page), not by a delay.
 */
export const name = "a space's Feed header holds together at a narrow width";
export const scenario = 'coasys:space-feed';
export const widths = [320, 360, 450, 600];

/** The tallest the bar and the controls may be together: two rows of controls and the bar. */
const MAX_HEADER = 170;

export async function check({ evaluate, screenshot }) {
  const found = await evaluate(async () => {
    const until = async (get) => {
      const end = performance.now() + 5000;
      for (;;) {
        const v = get();
        if (v) return v;
        if (performance.now() > end) return null;
        await new Promise((r) => requestAnimationFrame(r));
      }
    };
    const mount = document.getElementById('mount');
    const everything = (root) => {
      const out = [];
      const walk = (n) => {
        for (const el of n.querySelectorAll('*')) {
          out.push(el);
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      };
      walk(root);
      return out;
    };
    const switchText = await until(() =>
      everything(mount).find(
        (el) => el.localName === 'we-text' && (el.textContent ?? '').trim() === 'Show call transcripts',
      ),
    );
    const feedTitle = await until(() =>
      everything(mount).find((el) => el.localName === 'we-text' && (el.textContent ?? '').trim() === 'Feed'),
    );
    if (!switchText) return { missing: 'the Show call transcripts text' };
    if (!feedTitle) return { missing: 'the Feed title' };
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const sw = switchText.getBoundingClientRect();
    const canvas = document.createElement('canvas').getContext('2d');
    const narrow = [];
    for (const el of everything(mount)) {
      if (el.localName !== 'we-text') continue;
      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      const r = el.getBoundingClientRect();
      // The header only: the bar and the controls, down to the switch. A message's name below it
      // gives way with an ellipsis by design (`messageLine`).
      if (!r.width || r.top > sw.bottom) continue;
      const cs = getComputedStyle(el);
      canvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const word = Math.max(...text.split(/\s+/).map((w) => canvas.measureText(w).width));
      // A truncating text may end in an ellipsis, but keeps room for a few letters of itself.
      const floor = el.hasAttribute('truncate') ? Math.min(word, 24) : word;
      if (r.width + 1 < floor)
        narrow.push(`"${text.slice(0, 30)}" is ${Math.round(r.width)}px, its longest word ${Math.round(word)}px`);
    }
    // On every row: a face keeps its square, whatever the name beside it gives up.
    for (const el of everything(mount)) {
      if (el.localName !== 'we-avatar') continue;
      const r = el.getBoundingClientRect();
      if (r.height && r.width + 1 < r.height)
        narrow.push(`an avatar is ${Math.round(r.width)}px wide, ${Math.round(r.height)}px tall`);
    }
    return {
      narrow,
      title: Math.round(feedTitle.getBoundingClientRect().width),
      // From the top of the page to the bottom of the controls' switch.
      header: Math.round(sw.bottom - mount.getBoundingClientRect().top),
    };
  });
  await screenshot?.('narrow-feed-header');
  if (found.missing) return [`no ${found.missing}`];
  const problems = found.narrow.map((n) =>
    n.startsWith('an avatar') ? n : `text narrower than its longest word: ${n}`,
  );
  if (found.title < 40) problems.push(`the title is ${found.title}px wide`);
  if (found.header > MAX_HEADER) problems.push(`the header runs ${found.header}px down the page, over ${MAX_HEADER}px`);
  return problems;
}
