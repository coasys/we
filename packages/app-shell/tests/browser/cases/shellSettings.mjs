/**
 * WE's sidebar and the Settings page share a phone's width without either breaking the other.
 *
 * On a phone held upright (412px) the rail opened under the first tap and stayed open — a touch is
 * reported as the pointer arriving, and nothing reports it leaving — so it covered Settings, and
 * Settings' own 200px nav left its page a column a few letters wide: "Devices" wrapped one letter to
 * a line. Then the nav became a strip across the top that scrolled sideways, which hid most of it.
 *
 * Below 640px now the rail is a bar across the top of the window; its mark is a button called
 * "Menu" that opens the rail over the whole window, and a row pressed in it shuts it again. Settings
 * is a list of its pages, grouped, until one is chosen; then the page has the width, under a header
 * whose Back is focused and returns to the list — with focus on the entry that opened the page, or
 * on the first where Settings opened on a page directly. At a desktop width both are as they were.
 *
 * The open menu covers the window, and is for that time the only thing there: Tab stays inside it,
 * and Escape shuts it with focus back on Menu. Tabbing past its last control used to land on the
 * covered page.
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

/** A Settings nav entry by its words — outside the rail, which has a Profile row of its own. */
const entry = async (measureText, text) => {
  const found = await measureText(text, '#settings-frame we-button');
  // A hidden entry still answers, with no box.
  return found && found.w > 0 ? found : null;
};

/** Whether the control holding the cursor is inside the rail, through the shadow roots on the way. */
const focusInRail = (evaluate) =>
  evaluate(() => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    const rail = document.getElementById('we-sidebar');
    for (let at = el; at; at = at.parentNode ?? at.host ?? null) if (at === rail) return true;
    return false;
  });

async function press(pressAt, box) {
  await pressAt(box.x + box.w / 2, box.y + box.h / 2);
  await sleep(300);
}

export async function check(
  { measureAll, measure, measureText, measureControl, hover, pressAt, screenshot, call, key, evaluate },
  width,
  scale,
) {
  if (width !== scale) return [];
  const problems = [];
  const phone = width < 640;
  await screenshot(phone ? 'settings-phone' : 'settings-desktop');

  const frame = await measure('#settings-frame');
  const page = await measure('#settings-page');

  if (!phone) {
    const closed = await rail(measureAll);
    if (!closed || closed.w !== 80) return [`no 80px rail (found ${closed?.w}px)`];
    // On a desktop Settings is at most 960px, and the page has that less the padding, the 200px nav
    // and the gap beside it.
    const room = Math.min(frame.w, 960) - 2 * 16 - 200 - 32;
    if (!page) problems.push('no settings page drawn');
    else if (page.w < room - 2) problems.push(`the page is ${page.w}px wide, with ${room}px of room`);
    const label = await entry(measureText, 'Devices');
    if (label && label.h > 40) problems.push(`the Devices nav entry wraps (${label.w}×${label.h})`);
    // The nav sits beside the page at its 200px, and there is no Back: the nav is the way about.
    const nav = await entry(measureText, 'Profile');
    if (!nav || !page || nav.x >= page.x) problems.push('the settings nav is not beside the page');
    if (await entry(measureText, 'Back')) problems.push('a desktop settings page has a Back');
    await hover('#we-sidebar *');
    await sleep(450);
    const open = await rail(measureAll);
    if (open?.w !== 240) problems.push(`hovering the rail opens it to ${open?.w}px, expected 240px`);
    if (await measureControl('Menu')) problems.push('a desktop rail shows a menu button');
    return problems;
  }

  // Phone. The rail is a bar across the top, as wide as the window and no taller than the frame's band.
  // (The harness mounts at the phone's width in a wider viewport, which the fixed rail spans: at least
  // the mount's width is the claim.)
  const bar = await rail(measureAll);
  if (!bar || bar.w < width || bar.h !== 56)
    problems.push(`the shut rail is ${bar?.w}×${bar?.h}, expected ${width}×56`);

  // Opened on a page (a link into Settings): the page has the width, under Back and its name.
  if (!page || page.w < frame.w - 2 * 12 - 2) problems.push(`the page is ${page?.w}px wide in a ${frame.w}px frame`);
  if (await entry(measureText, 'Security')) problems.push('the list is drawn beside an open page');
  const back = await entry(measureText, 'Back');
  if (!back) return [...problems, 'no Back on a phone’s settings page'];
  if (!(await measureText('Devices'))) problems.push('the page’s header does not name it');

  const focusedName = () => call('focusedName');

  // Back: the list, grouped, every entry the width of the frame, and no page.
  await press(pressAt, back);
  await screenshot('settings-phone-list');
  // Nothing in the list opened that page, so the first entry has focus rather than nothing.
  if ((await focusedName()) !== 'Profile')
    problems.push(`after Back from a page opened directly, focus is on "${await focusedName()}", not Profile`);
  const devices = await entry(measureText, 'Devices');
  const profile = await entry(measureText, 'Profile');
  if (!devices || !profile) return [...problems, 'Back does not show the list'];
  if (devices.y <= profile.y) problems.push('the list does not run down the page');
  if (!(await measureText('Devices and access'))) problems.push('the list is not grouped under headings');
  const shown = await measure('#settings-page');
  if (shown && shown.w > 0) problems.push('the page is still drawn under the list');
  const row = (await measureAll('#settings-frame we-button')).find((b) => b.y === devices.y && b.w > 0);
  if (row && row.w < frame.w - 2 * 12 - 2) problems.push(`a list entry is ${row.w}px wide in a ${frame.w}px frame`);

  // Choosing one opens it, and the Back at its top has focus.
  await press(pressAt, devices);
  await screenshot('settings-phone-page');
  const opened = await measure('#settings-page');
  if (!opened || opened.w === 0) problems.push('choosing Devices does not open its page');
  if (!(await entry(measureText, 'Back'))) problems.push('the opened page has no Back');
  if ((await focusedName()) !== 'Back') problems.push(`focus is on "${await focusedName()}", not on Back`);

  // Back, from the keyboard where focus already is: the list, with focus on the entry that opened it.
  await key('Enter');
  await sleep(300);
  if (!(await entry(measureText, 'Security'))) problems.push('Enter on Back does not show the list');
  if ((await focusedName()) !== 'Devices')
    problems.push(`after Back, focus is on "${await focusedName()}", not on the Devices entry that opened the page`);

  // A touch is the pointer arriving: it must not open the rail on its own.
  await hover('#we-sidebar *');
  await sleep(450);
  const touched = await rail(measureAll);
  if (touched?.h !== 56) problems.push(`the pointer arriving opens the rail to ${touched?.h}px tall`);

  const menu = await measureControl('Menu');
  if (!menu) return [...problems, 'no menu button on a phone-width rail'];

  // From the keyboard: Menu opens it, and the menu is all there is until it shuts.
  await evaluate(() => {
    for (const host of document.querySelectorAll('#we-sidebar we-button')) {
      const inner = host.shadowRoot?.querySelector('[aria-label="Menu"]');
      if (inner) return inner.focus();
    }
  });
  await key('Enter');
  await sleep(300);
  const byKey = await rail(measureAll);
  if (!byKey || byKey.h < 600) problems.push(`Enter on Menu opens the rail to ${byKey?.w}×${byKey?.h}`);
  // Past the last control and round again: more presses than the menu has controls.
  const controls = (await measureAll('#we-sidebar we-button')).filter((b) => b.w > 0).length;
  for (let i = 0; i < controls + 3; i++) {
    await key('Tab');
    if (!(await focusInRail(evaluate))) {
      problems.push(`Tab ${i + 1} of ${controls + 3} leaves the open menu, for "${await focusedName()}"`);
      break;
    }
  }
  // And backwards out of the first.
  for (let i = 0; i < controls + 3; i++) {
    await key('Shift+Tab');
    if (!(await focusInRail(evaluate))) {
      problems.push(`Shift+Tab ${i + 1} of ${controls + 3} leaves the open menu, for "${await focusedName()}"`);
      break;
    }
  }
  // What it covers is out of reach for anything else, a screen reader included.
  const covered = await evaluate(() => document.getElementById('settings-frame')?.closest('[inert]') !== null);
  if (!covered) problems.push('the page under the open menu is not inert');
  await key('Escape');
  await sleep(300);
  const shutByKey = await rail(measureAll);
  if (shutByKey?.h !== 56) problems.push(`Escape leaves the rail ${shutByKey?.h}px tall`);
  if ((await focusedName()) !== 'Menu') problems.push(`after Escape, focus is on "${await focusedName()}", not Menu`);
  const released = await evaluate(() => document.getElementById('settings-frame')?.closest('[inert]') === null);
  if (!released) problems.push('the page stays inert after the menu shuts');

  // The menu button opens it over the window…
  await press(pressAt, menu);
  await sleep(200);
  const full = await rail(measureAll);
  if (!full || full.w < width || full.h < 600) problems.push(`the menu button opens the rail to ${full?.w}×${full?.h}`);
  await screenshot('settings-phone-menu');

  // …and pressing a row in it shuts it again, so the page it led to is not left covered.
  const profileRow = await measureText('Profile', '#we-sidebar we-button');
  if (profileRow) {
    await press(pressAt, profileRow);
    await sleep(200);
    const after = await rail(measureAll);
    if (after?.h !== 56) problems.push(`pressing a row leaves the rail ${after?.h}px tall`);
  } else problems.push('no Profile row in the opened rail');
  return problems;
}
