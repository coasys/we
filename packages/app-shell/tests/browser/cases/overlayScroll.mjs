/**
 * A shell overlay (Settings, Profile) scrolls to its end in its own surface.
 *
 * The overlay's views are drawn in a surface, which is a size container. In the phone's WebView
 * (Chrome 124), what overflows a size container is ink overflow: painted, but no part of any
 * ancestor's scrollable area. With the scrolling on the box around the surface, Settings on a phone
 * ended at the bottom of the screen and its last rows could not be reached. Newer Chrome, which this
 * harness runs, counts that overflow and scrolled the box around it, so the old arrangement passed
 * here while failing on the phone. What holds on both is that the surface itself scrolls
 * (`overlaySurfaceStyle`), and that is what is checked.
 */
export const name = 'a shell overlay taller than the window scrolls to its end in its surface';
export const scenario = 'overlay:scroll';
export const widths = [412];

export async function check({ evaluate }) {
  const problems = [];
  const seen = await evaluate(() => {
    const surface = document.getElementById('overlay-surface');
    const end = document.getElementById('overlay-end');
    surface.scrollTop = surface.scrollHeight;
    const box = end.getBoundingClientRect();
    return {
      overflowY: getComputedStyle(surface).overflowY,
      scrolled: Math.round(surface.scrollTop),
      endTop: Math.round(box.top),
      endBottom: Math.round(box.bottom),
      window: window.innerHeight,
    };
  });
  if (seen.overflowY !== 'auto' && seen.overflowY !== 'scroll') {
    problems.push(
      `the surface is overflow ${seen.overflowY}: it does not scroll, and on the phone nothing around it can`,
    );
  }
  if (seen.scrolled <= 0) problems.push('the surface did not scroll');
  if (seen.endBottom > seen.window || seen.endTop < 0) {
    problems.push(
      `the last row (${seen.endTop}–${seen.endBottom}) cannot be scrolled into the ${seen.window}px window`,
    );
  }
  return problems;
}
