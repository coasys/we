/**
 * The Flows page in a narrow window: the workflow list and the open workflow stack rather than
 * squeezing each other, so the open workflow's headings keep their words.
 *
 * Side by side, the list took its 240px and the open workflow was left a few pixels: "Going through
 * it" and the workflow's own name broke a letter to a line.
 */
export const name = 'the Flows page stacks its panes at a narrow width';
export const scenario = 'coasys:flows-page';
// 240px: a lane narrower than the detail pane's 16rem floor and the page's padding.
export const widths = [240, 300, 450];

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
    // Nothing runs past the page's right edge: not the detail pane, not the stuck record's sentence.
    const edge = document.getElementById('mount').getBoundingClientRect().right;
    const past = [];
    const walk = (root) => {
      for (const t of root.querySelectorAll('*')) {
        if (t.localName === 'we-text' && t.getBoundingClientRect().right > edge + 1)
          past.push((t.textContent ?? '').trim().slice(0, 30));
        if (t.shadowRoot) walk(t.shadowRoot);
      }
    };
    walk(document.getElementById('mount'));
    return {
      width: el.getBoundingClientRect().width,
      word: Math.max(...'Going through it'.split(' ').map((w) => c.measureText(w).width)),
      past,
    };
  });
  await screenshot?.('narrow-flows-page');
  if (!found) return ['no "Going through it" heading'];
  const problems = found.past.map((t) => `"${t}" runs past the page's right edge`);
  if (found.width + 1 < found.word)
    problems.push(
      `"Going through it" is ${Math.round(found.width)}px wide, its longest word ${Math.round(found.word)}px`,
    );
  return problems;
}
