/**
 * The Flows page in a narrow window: the workflow list and the open workflow stack rather than
 * squeezing each other, so the open workflow's headings keep their words.
 *
 * Side by side, the list took its 240px and the open workflow was left a few pixels: "Going through
 * it" and the workflow's own name broke a letter to a line.
 */
export const name = 'the Flows page stacks its panes at a narrow width';
export const scenario = 'coasys:flows-page';
export const widths = [300, 450];

export async function check({ evaluate, screenshot }) {
  const found = await evaluate(async () => {
    const find = () => {
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.localName === 'we-text' && (el.textContent ?? '').trim() === 'Going through it') return el;
          if (el.shadowRoot) {
            const inner = walk(el.shadowRoot);
            if (inner) return inner;
          }
        }
        return null;
      };
      return walk(document.getElementById('mount'));
    };
    const end = performance.now() + 5000;
    let el = find();
    while (!el && performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
      el = find();
    }
    if (!el) return null;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c = document.createElement('canvas').getContext('2d');
    const cs = getComputedStyle(el);
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return {
      width: el.getBoundingClientRect().width,
      word: Math.max(...'Going through it'.split(' ').map((w) => c.measureText(w).width)),
    };
  });
  await screenshot?.('narrow-flows-page');
  if (!found) return ['no "Going through it" heading'];
  return found.width + 1 >= found.word
    ? []
    : [`"Going through it" is ${Math.round(found.width)}px wide, its longest word ${Math.round(found.word)}px`];
}
