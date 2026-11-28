/**
 * A Flux message card in a narrow window: the author's name gives way to the timestamp.
 *
 * The name is `truncate` with `maxWidth: 220px`. With `flex: '0 0 auto'` it kept its 220px once a
 * `we-*` host's `flex` held its shrink factor, and pushed the timestamp past the card's clipped edge.
 */
export const name = "a Flux card's timestamp stays on the card at a narrow width";
export const scenario = 'flux:channels';
export const widths = [260, 320];

export async function check({ evaluate, screenshot }) {
  const found = await evaluate(async () => {
    const all = () => {
      const out = [];
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          out.push(el);
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      };
      walk(document.getElementById('mount'));
      return out;
    };
    const end = performance.now() + 5000;
    let stamp = all().find((el) => el.localName === 'we-timestamp');
    while (!stamp && performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
      stamp = all().find((el) => el.localName === 'we-timestamp');
    }
    if (!stamp) return null;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Inside the clipped meta row (`overflow: hidden`) and inside the page: a card that grew to fit
    // its name would keep the timestamp in its row and still run off the page.
    let row = stamp.parentElement ?? stamp.getRootNode().host;
    while (row && getComputedStyle(row).overflow !== 'hidden') row = row.parentElement ?? row.getRootNode().host;
    if (!row) return { missing: 'the clipped meta row' };
    const edge = Math.min(
      row.getBoundingClientRect().right,
      document.getElementById('mount').getBoundingClientRect().right,
    );
    return { past: stamp.getBoundingClientRect().right - edge };
  });
  await screenshot?.('narrow-flux-card');
  if (!found) return ['no timestamp on the card'];
  if (found.missing) return [`no ${found.missing}`];
  return found.past <= 1 ? [] : [`the timestamp ends ${Math.round(found.past)}px past the card's edge`];
}
