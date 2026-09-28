/**
 * The Voices popover shows its people without a scroll bar when they fit.
 *
 * Reported from use: the list always carried a vertical bar, whether it held one person or three.
 * Only a browser can say — a box with a needless bar and one without are the same size, so the
 * question is whether what a scroller holds is taller (or wider) than what it shows.
 */
export const name = 'voices popover fits its rows';
export const scenario = 'canvas:voices';
export const widths = [900];

export async function check({ click, count, scrollers }) {
  await click('we-button:has-text("Voices")');
  if (!(await count('we-popover [slot="content"] we-slider'))) return ['the Voices popover did not open with its rows'];

  const problems = [];
  for (const box of await scrollers('[slot="content"]')) {
    if (box.scrollH > box.clientH) {
      problems.push(`a ${box.tag} scrolls vertically: holds ${box.scrollH}px, shows ${box.clientH}px`);
    }
    if (box.scrollW > box.clientW) {
      problems.push(`a ${box.tag} scrolls sideways: holds ${box.scrollW}px, shows ${box.clientW}px`);
    }
  }
  return problems;
}
