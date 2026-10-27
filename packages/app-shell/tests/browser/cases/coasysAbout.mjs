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

export async function check({ measureAll, measureText, evaluate, moveTo, screenshot }, width) {
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

  // The headline does not change height as it types: sample it while the phrases change. The `h1` is
  // inside the we-text's shadow root, where `measure` cannot see, so this reads the host — which
  // once made the check pass by measuring nothing.
  const headline = () =>
    evaluate(() => {
      const host = [...document.querySelectorAll('we-text')].find((t) => t.tag === 'h1');
      const r = host?.getBoundingClientRect();
      return r ? { x: r.x, h: r.height } : null;
    });
  const heading = await headline();
  if (!heading) problems.push('no headline');
  const heights = new Set([heading?.h]);
  for (let i = 0; i < 6; i++) {
    await evaluate(() => new Promise((resolve) => setTimeout(resolve, 400)));
    heights.add((await headline())?.h);
  }
  if (heights.size > 1) problems.push(`the headline's height moved while it typed: ${[...heights].join(', ')}`);

  // The text starts where the site's does: centred in 1200px, inset 40px (22px on a phone). The inset
  // and the top padding are set at different widths, and a tier that named only the top once
  // wrote the sides as 0 there.
  const inset = Math.max(0, (width - 1200) / 2) + (width >= 640 ? 40 : 22);
  if (heading && !near(heading.x, inset)) problems.push(`the headline starts at x=${heading.x}, not ${inset}`);

  const watch = await measureText('Watch the film', 'we-button');
  const see = await measureText('See the app', 'we-button');
  if (!watch || !see) problems.push('the two buttons are missing');
  else if (width >= 768 && !near(watch.y, see.y, 4)) problems.push('the buttons are not side by side');

  // The site's secondary button: a 2px mint outline round white words, filled mint under the pointer.
  // Mint is read off the solid button beside it, so this follows the theme rather than a hex.
  const buttonStyle = () =>
    evaluate(() => {
      const base = (text) =>
        [...document.querySelectorAll('we-button')]
          .find((b) => b.textContent.includes(text))
          ?.shadowRoot.querySelector('[part=base]');
      const see = getComputedStyle(base('See the app'));
      return {
        mint: getComputedStyle(base('Watch the film')).backgroundColor,
        border: see.borderTopColor,
        width: see.borderTopWidth,
        bg: see.backgroundColor,
        text: see.color,
      };
    });
  const rest = await buttonStyle();
  if (rest.width !== '2px' || rest.border !== rest.mint || rest.text !== 'rgb(255, 255, 255)')
    problems.push(`"See the app" rests as ${rest.width} ${rest.border} round ${rest.text}, not 2px mint round white`);
  await moveTo('we-button:has-text("See the app")');
  await evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  const hover = await buttonStyle();
  if (hover.bg === rest.bg || hover.bg !== hover.border)
    problems.push(`"See the app" does not fill under the pointer: ${hover.bg} inside ${hover.border}`);
  await moveTo('we-text');

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
