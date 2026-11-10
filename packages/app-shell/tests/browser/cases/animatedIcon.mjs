/**
 * The drawings that move, and what they do for somebody who asked for less motion.
 *
 * A primitive's animation runs inside its shadow root, and the tokens stylesheet's reduced-motion
 * rule is written on `*` in the document, which does not match in there. So the skeleton's pulse,
 * the spinner and the rest went on moving whichever way somebody asked for less. jsdom runs no
 * animations, so only a browser can say whether one is running: `getAnimations()` lists the ones
 * that are, and a loop stopped by the shared rule finishes its one 0.01ms pass and leaves the list.
 *
 * Both ways of asking are tried, separately: the app's own Motion setting (the attribute on the
 * document root, seen through `:host-context`) and the system's (the media query).
 */
export const name = 'animated icons move, in step, and stop for less motion';
export const scenario = 'ds:animated-icons';
export const widths = [900];

/** The running animations inside one element's shadow root, by inner selector. */
function probe(evaluate) {
  return evaluate(() => {
    const inner = {
      spinner: '.ring div',
      live: '.live-ring',
      typing: '.typing circle',
      speaking: '.speaking rect',
      skeleton: "[part='base']",
    };
    const out = {};
    for (const [id, sel] of Object.entries(inner)) {
      const el = document.getElementById(id)?.shadowRoot?.querySelector(sel);
      out[id] = el
        ? { running: el.getAnimations().length, name: getComputedStyle(el).animationName }
        : { running: -1, name: '' };
    }
    return out;
  });
}

const settle = (evaluate) => evaluate(() => new Promise((r) => setTimeout(r, 150)));

export async function check({ evaluate, reducedMotion, partStyle, measure, screenshot }) {
  const problems = [];
  // Mid-cycle, so the ring and the bars are caught moving: `WE_BROWSER_SHOTS=<dir>` to look.
  await screenshot('animated-icons');

  // Moving, with nothing asked.
  const moving = await probe(evaluate);
  for (const [id, a] of Object.entries(moving)) {
    if (a.running === -1) problems.push(`${id}: drew nothing to animate`);
    else if (a.running === 0) problems.push(`${id}: not animating with no reduced motion asked for`);
  }

  // Two copies of a drawing at the same point in the cycle, whenever each mounted.
  const offset = await evaluate(() => {
    const t = (id) => document.getElementById(id).shadowRoot.querySelector('.live-ring').getAnimations()[0];
    const [a, b] = [t('live'), t('live-2')];
    if (!a || !b) return null;
    const cycle = 1800;
    const at = (x) => ((((x.currentTime ?? 0) - x.effect.getTiming().delay) % cycle) + cycle) % cycle;
    return Math.abs(at(a) - at(b));
  });
  if (offset === null) problems.push('the two live dots have no animation to compare');
  else if (offset > 50 && offset < 1750)
    problems.push(`the two live dots are ${Math.round(offset)}ms apart in their cycle`);

  // Less motion, two ways.
  const ways = [
    [
      "the app's Motion setting",
      async () => {
        const before = await evaluate(() => document.documentElement.getAttribute('data-we-motion'));
        await evaluate(() => document.documentElement.setAttribute('data-we-motion', 'reduced'));
        return () =>
          evaluate((v) => {
            if (v === null) document.documentElement.removeAttribute('data-we-motion');
            else document.documentElement.setAttribute('data-we-motion', v);
          }, before);
      },
    ],
    [
      "the system's preference",
      async () => {
        await reducedMotion(true);
        return () => reducedMotion(false);
      },
    ],
  ];
  for (const [way, ask] of ways) {
    const undo = await ask();
    // A stopped loop is still listed until its one pass ends; a frame or two is plenty.
    await settle(evaluate);
    const still = await probe(evaluate);
    for (const id of ['live', 'speaking', 'skeleton']) {
      if (still[id].running) problems.push(`${way}: ${id} is still animating`);
    }
    if (!still.spinner.running) problems.push(`${way}: the spinner stopped, and a still spinner looks stuck`);
    if (!still.typing.running || still.typing.name !== 'we-animated-typing-fade') {
      problems.push(`${way}: the typing dots should fade in turn rather than rise (got ${still.typing.name})`);
    }
    await undo();
    await settle(evaluate);
  }

  // A badge at every size holds its dot off its label.
  for (const id of ['badge-md', 'badge-sm', 'badge-xs']) {
    const gap = await partStyle(`#${id}`, 'column-gap');
    if (!gap || gap === 'normal' || gap === '0px')
      problems.push(`${id}: no gap between the dot and the label (${gap})`);
  }

  // Sizes, as a report: a badge is meant to sit beside a control of its size.
  const md = await measure('#badge-md');
  const sm = await measure('#badge-sm');
  if (md && sm)
    return [...problems, ...(sm.h >= md.h ? [`an sm badge (${sm.h}px) is not smaller than md (${md.h}px)`] : [])];
  return problems;
}
