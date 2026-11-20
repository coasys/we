/**
 * A space's Feed with a floating panel over the bottom of the window.
 *
 * The Feed's column was padded by `--we-covered-bottom` to keep its composer above the call bar.
 * The call bar sits inside the call's own stage now, so the padding only left a blank band under
 * the composer. The composer keeps the page's ordinary bottom gap, whatever floats over it.
 */
export const name = "a space's Feed keeps its ordinary bottom gap under a floating panel";
export const scenario = 'coasys:space-feed';
export const widths = [720];

/** As much as a floating call window near the bottom of the window covers. */
const COVERED = 160;

export async function check({ evaluate, screenshot }) {
  const gap = await evaluate((covered) => {
    document.documentElement.style.setProperty('--we-covered-bottom', `${covered}px`);
    // The scenario's 600px column: wrappers above it draw no box of their own.
    const frame = [...document.getElementById('mount').querySelectorAll('*')].find(
      (el) => Math.round(el.getBoundingClientRect().height) === 600,
    );
    // Wait out the 300 ms padding transition the column had, so a padding that grows is measured grown.
    return new Promise((resolve) =>
      setTimeout(() => {
        // The composer's send button is the last button on the page.
        const send = [...frame.querySelectorAll('we-button')].at(-1);
        if (!send) return resolve(null);
        resolve(Math.round(frame.getBoundingClientRect().bottom - send.getBoundingClientRect().bottom));
      }, 500),
    );
  }, COVERED);
  await screenshot?.('coasys-space-feed-covered');
  await evaluate(() => document.documentElement.style.removeProperty('--we-covered-bottom'));
  if (gap === null) return ['no composer'];
  // The page's bottom gap is `--we-space-500` (24px), and nothing of the covered height on top of it.
  return Math.abs(gap - 24) <= 2 ? [] : [`${gap}px under the composer with ${COVERED}px covered, wanted 24px`];
}
