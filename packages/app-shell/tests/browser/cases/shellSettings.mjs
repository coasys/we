/**
 * WE's sidebar and the Settings page share a phone's width without either breaking the other.
 *
 * On a phone held upright (412px) the rail opened under the first tap and stayed open — a touch is
 * reported as the pointer arriving, and nothing reports it leaving — so it covered Settings, and
 * Settings' own 200px nav left its page a column a few letters wide: "Devices" wrapped one letter to
 * a line. Below 640px the rail now opens only from its menu button and closes when a row in it is
 * pressed, and Settings stacks its nav above the page. At a desktop width both are as they were.
 */
export const name = 'the sidebar beside settings';
export const scenario = 'shell:settings';
// `scale` is the window's width and `width` the mount's; only the matching pairs are a window.
export const widths = [1280, 412];
export const scales = [1280, 412];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The rail: the first box under the sidebar's wrapper (the renderer's own wrappers draw none). */
async function rail(measureAll) {
  return (await measureAll('#we-sidebar *')).find((b) => b.w > 0 && b.x === 0);
}

/**
 * The phone's nav strip, scrolled to its start, part way and to its end: the entries in view at
 * rest. A strip cut flush at the page's edge showed a sliver of an entry scrolled past, to the left
 * of "Plan & usage". Now it reaches over Settings' 12px padding and fades across it, and rests at
 * the start of an entry, so the leftmost entry in view begins inside the fade's inner edge.
 */
async function stripEdges(evaluate, page, screenshot) {
  const problems = [];
  const at = (to) =>
    evaluate(async (scrollTo) => {
      const profile = [...document.querySelectorAll('we-button')].find(
        (b) => b.textContent.trim() === 'Profile' && !b.closest('#we-sidebar'),
      );
      let strip = profile?.parentElement;
      while (strip && getComputedStyle(strip).overflowX !== 'auto') strip = strip.parentElement;
      if (!strip) return null;
      const max = strip.scrollWidth - strip.clientWidth;
      strip.scrollTo({ left: scrollTo === 'end' ? max : scrollTo, behavior: 'instant' });
      // Snapping settles after the scroll; give it a few frames.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const box = strip.getBoundingClientRect();
      const fade = parseFloat(getComputedStyle(strip).paddingLeft);
      const entries = [...strip.querySelectorAll('we-button')]
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.width > 0)
        .map((r) => ({ left: r.left, right: r.right }));
      return { left: box.left, right: box.right, fade, max, scrollLeft: strip.scrollLeft, entries };
    }, to);

  const start = await at(0);
  if (!start) return ['no scrolling nav strip on a phone'];
  if (start.max <= 0) return problems;
  if (start.fade < 8) problems.push(`the strip keeps ${start.fade}px inside its edges, too little to fade over`);
  const first = start.entries[0];
  if (first.left < start.left + start.fade - 1) {
    problems.push(`at its start the first entry begins at ${first.left}px, inside the strip's fade`);
  }
  if (page && Math.abs(first.left - page.x) > 2) {
    problems.push(`the strip's first entry (${first.left}px) is not on the page's edge (${page.x}px)`);
  }

  for (const to of [37, 150, Math.round(start.max / 2)]) {
    const s = await at(to);
    const inner = s.left + s.fade;
    // The leftmost entry not wholly scrolled past the fade's inner edge.
    const leftmost = s.entries.find((e) => e.right > inner + 1);
    if (leftmost && leftmost.left < inner - 1 && s.scrollLeft < s.max - 1) {
      problems.push(`scrolled to ${to}px the strip rests on part of an entry (${leftmost.left}px < ${inner}px)`);
    }
  }
  await at(150);
  await screenshot('settings-phone-strip-scrolled');

  const end = await at('end');
  const last = end.entries[end.entries.length - 1];
  if (last.right > end.right - end.fade + 1) {
    problems.push(`at its end the last entry ends at ${last.right}px, inside the strip's fade`);
  }
  await at(0);
  return problems;
}

export async function check(
  { measureAll, measure, measureText, measureControl, hover, pressAt, screenshot, evaluate },
  width,
  scale,
) {
  if (width !== scale) return [];
  const problems = [];
  const phone = width < 640;
  await screenshot(phone ? 'settings-phone' : 'settings-desktop');

  const closed = await rail(measureAll);
  if (!closed || closed.w !== 80) return [`no 80px rail (found ${closed?.w}px)`];

  // The page beside the rail has the room it is given: its text is not a column of letters.
  const frame = await measure('#settings-frame');
  const page = await measure('#settings-page');
  if (!page) problems.push('no settings page drawn');
  else {
    // On a phone the page has the frame's width less Settings' padding. On a desktop Settings is at
    // most 960px, and the page has that less the padding, the 200px nav and the gap beside it.
    const room = phone ? frame.w - 2 * 12 : Math.min(frame.w, 960) - 2 * 16 - 200 - 32;
    if (page.w < room - 2) problems.push(`the page is ${page.w}px wide, with ${room}px of room`);
  }

  const label = await measureText('Devices', 'we-button');
  if (label && label.h > 40) problems.push(`the Devices nav entry wraps (${label.w}×${label.h})`);

  if (!phone) {
    // Desktop: the nav sits beside the page at its 200px, and the rail opens under the pointer.
    const nav = await measureText('Profile', 'we-button');
    if (nav && page && nav.x >= page.x) problems.push('the settings nav is not beside the page');
    await hover('#we-sidebar *');
    await sleep(450);
    const open = await rail(measureAll);
    if (open?.w !== 240) problems.push(`hovering the rail opens it to ${open?.w}px, expected 240px`);
    if (await measureControl('Open menu')) problems.push('a desktop rail shows a menu button');
    return problems;
  }

  // Phone: the settings nav is above the page rather than beside it.
  const nav = await measureText('Profile', 'we-button');
  if (nav && page && nav.y >= page.y) problems.push('the settings nav is not above the page');

  // The strip starts cleanly and comes to rest at the start of an entry, never on a sliver of one.
  problems.push(...(await stripEdges(evaluate, page, screenshot)));

  // A touch is the pointer arriving: it must not open the rail on its own.
  await hover('#we-sidebar *');
  await sleep(450);
  const touched = await rail(measureAll);
  if (touched?.w !== 80) problems.push(`the pointer arriving opens the rail to ${touched?.w}px`);

  // The menu button opens it…
  const menu = await measureControl('Open menu');
  if (!menu) return [...problems, 'no menu button on a phone-width rail'];
  await pressAt(menu.x + menu.w / 2, menu.y + menu.h / 2);
  await sleep(450);
  const opened = await rail(measureAll);
  if (opened?.w !== 240) problems.push(`the menu button opens the rail to ${opened?.w}px, expected 240px`);
  await screenshot('settings-phone-menu');

  // …and pressing a row in it closes it again, so the page it led to is not left covered.
  const row = await measureText('Profile', '#we-sidebar we-button');
  if (row) {
    await pressAt(row.x + row.w / 2, row.y + row.h / 2);
    await sleep(450);
    const after = await rail(measureAll);
    if (after?.w !== 80) problems.push(`pressing a row leaves the rail ${after?.w}px wide`);
  } else problems.push('no Profile row in the opened rail');
  return problems;
}
