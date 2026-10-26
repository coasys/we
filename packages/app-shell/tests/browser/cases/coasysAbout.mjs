/**
 * The Coasys About page: the site's first screen, inside the app.
 *
 * - The film's frame is 16:9 at any width, before its poster has loaded — offline here, so it never
 *   does — and it keeps that shape when the film replaces the poster, so nothing under it moves.
 * - The headline holds its height while its last part types, so the line under it stays put.
 * - The two buttons sit side by side where there is room, and wrap on a phone.
 *
 * `WE_BROWSER_SHOTS=<dir>` also writes a picture.
 */
export const name = 'the Coasys About page';
export const scenario = 'coasys:about';
export const widths = [1280, 420];

const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance;

export async function check({ measure, measureAll, measureText, evaluate, screenshot }, width) {
  const problems = [];
  const frame = async () => {
    const boxes = await evaluate(() =>
      [...document.querySelectorAll('we-image, we-video')].map((el) => {
        // The frame is the nearest ancestor with a box that is not the element's own wrapper.
        let box = el.parentElement;
        while (box && getComputedStyle(box).aspectRatio === 'auto') box = box.parentElement;
        const r = box?.getBoundingClientRect();
        return r ? { w: r.width, h: r.height, y: r.top } : null;
      }),
    );
    return boxes.find(Boolean);
  };

  const before = await frame();
  if (!before) problems.push('no film frame with an aspect ratio');
  else if (!near(before.h, (before.w * 9) / 16)) problems.push(`the frame is ${before.w}×${before.h}, not 16:9`);

  // The headline does not change height as it types: sample it while the phrases change.
  const heading = await measure('h1');
  const heights = new Set([heading?.h]);
  for (let i = 0; i < 6; i++) {
    await evaluate(() => new Promise((resolve) => setTimeout(resolve, 400)));
    heights.add((await measure('h1'))?.h);
  }
  if (heights.size > 1) problems.push(`the headline's height moved while it typed: ${[...heights].join(', ')}`);

  const watch = await measureText('Watch the film', 'we-button');
  const see = await measureText('See the app', 'we-button');
  if (!watch || !see) problems.push('the two buttons are missing');
  else if (width >= 768 && !near(watch.y, see.y, 4)) problems.push('the buttons are not side by side');

  await screenshot('coasys-about');

  // Playing the film swaps the poster for the player in the same frame.
  await evaluate(() => [...document.querySelectorAll('we-button')].find((b) => b.label?.startsWith('Play'))?.click());
  await evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  const videos = await measureAll('we-video');
  if (!videos.length) problems.push('pressing the poster did not bring up the player');
  const after = await frame();
  if (before && after && !(near(after.h, before.h) && near(after.y, before.y)))
    problems.push(`the frame moved when the film started: ${before.y}/${before.h} → ${after.y}/${after.h}`);

  return problems;
}
