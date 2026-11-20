/**
 * A thread's "window" cover and the frame it could empty, in a real window.
 *
 * The chat route's mark reads `surface.tier == 'base'`; asking for the whole window empties the
 * app frame, which widens the very surface the mark reads — a loop, if the ask were granted
 * anywhere but a phone. It is not: a `"window"` mark is a cover only while the window is narrow,
 * so at 660 and 700px — either side of where a 72px band lands the tier on `base` — the frame
 * stays, the tier stays `base`, and the mark stays `window` without ever being a cover. The same
 * holds with a dock taking a third of a 1000px window, the other thing that can put the surface
 * at the boundary. Only the phone (390px) grants the ask — the chrome goes, and Back gives it
 * back with focus on the sidebar's selected row and the squeezed view inert behind the lane.
 */
export const name = 'a window cover the surface settles under';
export const scenario = 'security:self-firing-events';
export const widths = [660, 700, 1000, 390];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function check({ call, setViewport, measureControl, pressAt, focusedName }, width) {
  const problems = [];
  const phone = width < 640;
  // The window itself is the subject — `narrowWindow` reads `innerWidth`, never the mount.
  await setViewport(width);
  // A displacing dock 320px wide on the right joins the frame's 72px at the wide width: the surface
  // then sits at 608px — `base` — with or without the cover, unless the cover moved the frame.
  await call('coverProbe', width === 1000);
  try {
    await sleep(400);
    // The tree folded with the thread open is `CHAT_COVERS`'s other half.
    await call('coverProbeAct', 'setLaneCollapsed', 'tree', true);
    await sleep(400);

    const first = await call('coverProbeState');
    await sleep(500);
    const second = await call('coverProbeState');
    // Nothing may still be moving: every leg of the triangle sampled twice, half a second apart.
    if (JSON.stringify(first) !== JSON.stringify(second))
      problems.push(`never settles: ${JSON.stringify(first)} → ${JSON.stringify(second)}`);
    const state = second;
    if (state.mark !== 'window') problems.push(`the thread is not asking: mark=${state.mark}`);
    if (state.tier !== 'base') problems.push(`the surface is not where the mark reads it: tier=${state.tier}`);

    if (!phone) {
      // A wide window grants nothing: the mark is not a cover, the bands stay, and what is drawn
      // stays in the tab order — a cover that is not there cannot put chrome out of reach.
      if (state.covered) problems.push('a "window" mark covered a wide window');
      if (state.frame !== 72) problems.push(`the frame moved under the mark: left=${state.frame}`);
      if (state.bandInert) problems.push('visible chrome went inert behind no cover');
      if (state.viewInert) problems.push('the folded lane put the view out of reach');
      return problems;
    }

    // The phone grants the ask: the thread has the whole window, chrome and all.
    if (!state.covered) problems.push('a phone thread did not take the window');
    if (state.frame !== 0) problems.push(`the frame held a band under a whole-window cover: ${state.frame}`);
    if (state.bandW !== 0) problems.push(`the band kept its width under a whole-window cover: ${state.bandW}`);

    const back = await measureControl('Back', '#probe-thread we-button');
    if (!back) {
      problems.push('the covering thread shows no way back');
      return problems;
    }
    await pressAt(back.x + back.w / 2, back.y + back.h / 2);
    await sleep(400);
    const after = await call('coverProbeState');
    if (after.covered || after.mark === 'window') problems.push('Back left the thread covering the window');
    // The lane back open fills the row — the squeezed view beside it is out of reach.
    if (!after.viewInert) problems.push('the open lane did not put the squeezed view out of reach');
    const who = await focusedName();
    if (who !== 'Chosen') problems.push(`Back left focus on "${who || 'nothing'}" rather than the selected row`);
    return problems;
  } finally {
    await call('editorProbeDispose');
  }
}
