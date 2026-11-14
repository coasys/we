/**
 * A space's settings panel on a phone is a list of its sections, and a section under Back.
 *
 * On a phone the panel covers the window, and its five tabs were a strip across the top that
 * scrolled sideways: at 390px "Vocabulary" was off the edge, with nothing saying it was there. Below
 * 640px now the panel opens on a list of its sections, each the width of the panel; choosing one
 * opens it under a header whose Back is focused, and Back returns to the list with focus on the entry
 * that opened it — the same as app Settings. At a desktop width it keeps its tabs.
 */
export const name = 'space settings on a phone';
export const scenario = 'shell:space-settings';
// `scale` is the window's width and `width` the mount's; only the matching pairs are a window.
export const widths = [1280, 390];
export const scales = [1280, 390];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SECTIONS = ['About', 'People', 'Appearance', 'Features', 'Vocabulary'];

/** A section's entry or tab by its words, with a box — a hidden one still answers, with none. */
const drawn = async (measureText, text) => {
  const found = await measureText(text, '#space-settings we-button');
  return found && found.w > 0 ? found : null;
};

async function press(pressAt, box) {
  await pressAt(box.x + box.w / 2, box.y + box.h / 2);
  await sleep(300);
}

export async function check({ measure, measureAll, measureText, pressAt, screenshot, call, key }, width, scale) {
  if (width !== scale) return [];
  const problems = [];
  const phone = width < 640;
  const frame = await measure('#space-settings');
  if (!frame) return ['no space settings panel drawn'];
  const tabs = (await measureAll('#space-settings we-tabs')).filter((b) => b.w > 0);

  if (!phone) {
    await screenshot('space-settings-desktop');
    if (tabs.length === 0) problems.push('a desktop panel has no tabs');
    if (await drawn(measureText, 'Back')) problems.push('a desktop panel has a Back');
    return problems;
  }

  await screenshot('space-settings-phone');
  if (tabs.length > 0) problems.push('a phone panel still draws its tab strip');
  if (await drawn(measureText, 'Back')) problems.push('the list has a Back');
  // Every section is there, one under the other, the width of the panel and inside it.
  let above = -1;
  for (const label of SECTIONS) {
    const found = await drawn(measureText, label);
    if (!found) {
      problems.push(`no "${label}" entry in the list`);
      continue;
    }
    if (found.y <= above) problems.push(`"${label}" is not below the entry before it`);
    above = found.y;
    if (found.x < frame.x || found.x + found.w > frame.x + frame.w + 1)
      problems.push(`"${label}" runs past the panel (${found.x}+${found.w} in ${frame.x}+${frame.w})`);
    const row = (await measureAll('#space-settings we-button')).find(
      (b) => b.w > 0 && b.y <= found.y && b.y + b.h >= found.y + found.h,
    );
    if (row && row.w < frame.w - 2 * 16 - 2)
      problems.push(`the "${label}" entry is ${row.w}px in a ${frame.w}px panel`);
  }

  // Choosing one opens it, under a Back that has focus and the section's name.
  const people = await drawn(measureText, 'People');
  if (!people) return problems;
  await press(pressAt, people);
  await screenshot('space-settings-phone-page');
  const back = await drawn(measureText, 'Back');
  if (!back) return [...problems, 'choosing People opens no page with a Back'];
  // Back starts where the section's heading does, as in app Settings — not in the middle of the row.
  // The button is the row's width; its words are what sit somewhere in it.
  const words = await measureText('Back', '#space-settings we-button we-text');
  if (!words || words.x > frame.x + 64)
    problems.push(`Back's words are ${words ? words.x - frame.x : '?'}px in from the panel's edge, not at its start`);
  if ((await call('focusedName')) !== 'Back') problems.push(`focus is on "${await call('focusedName')}", not on Back`);
  if (await drawn(measureText, 'Vocabulary')) problems.push('the list is drawn beside an open section');
  if (!(await measureText('People'))) problems.push('the page’s header does not name it');

  // Back, from the keyboard: the list again, with focus on the entry that opened the page.
  await key('Enter');
  await sleep(300);
  if (!(await drawn(measureText, 'Vocabulary'))) problems.push('Enter on Back does not show the list');
  const focused = await call('focusedName');
  if (!focused.includes('People')) problems.push(`after Back, focus is on "${focused}", not on the People entry`);
  return problems;
}
