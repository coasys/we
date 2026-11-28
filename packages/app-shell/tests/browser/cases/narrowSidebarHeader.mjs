/**
 * The Coasys sidebar's header in a narrow lane: the space's name keeps a readable width.
 *
 * The name was `flex: 1; min-width: 0` between a large avatar and two buttons, so in a narrow
 * lane it gave up everything and was cut to "C.". The header wraps now, and the name keeps room
 * for a few letters, so the buttons drop under it instead.
 */
export const name = "the sidebar's space name keeps room beside its avatar and buttons";
export const scenario = 'coasys:tree-section';
export const widths = [160, 220, 280];

/** Room for "Comm…" at the subheading size, in pixels. */
const MIN_NAME = 50;

export async function check({ evaluate, screenshot }) {
  const found = await evaluate(async () => {
    const mount = document.getElementById('mount');
    const named = () => {
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.localName === 'we-text' && (el.textContent ?? '').trim() === 'Community') return el;
          if (el.shadowRoot) {
            const inner = walk(el.shadowRoot);
            if (inner) return inner;
          }
        }
        return null;
      };
      return walk(mount);
    };
    const end = performance.now() + 5000;
    let name = named();
    while (!name && performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
      name = named();
    }
    if (!name) return null;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { width: Math.round(name.getBoundingClientRect().width) };
  });
  await screenshot?.('narrow-sidebar-header');
  if (!found) return ['no space name'];
  return found.width >= MIN_NAME ? [] : [`the space name is ${found.width}px wide, under ${MIN_NAME}px`];
}
