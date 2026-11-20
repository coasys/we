/**
 * What a person does in the web app that more than one journey needs: answer the first-run name
 * prompt, make a shared space, open one, and read how many are in its call.
 *
 * Used by `calls.e2e.mjs` and the `coasys-spaces/` suite. Each step is done through the screen, the
 * way a person does it; only what the screen cannot say (the space's neighbourhood URL) is read back
 * from the account's client.
 */
import assert from 'node:assert/strict';

import { LinkQuery } from '@coasys/ad4m';

import { until } from '@we/e2e/waits';

/**
 * How many are in this page's call, or null when the page is not in a call.
 *
 * Read where the call says it: the "N participants" line of the call's own settings popover, which
 * counts the tiles the stage shows. The bar carries no count of its own any more, so the popover is
 * opened for the read and put back the way it was found — closed, unless it was already open — so a
 * poll leaves nothing on screen that a test step would then have to work around.
 *
 * In a call means a "Leave the call" button on screen: the stage's bar, or the strip that stands in
 * for it while the stage is put away. The count lives on the stage, so a call with the stage put
 * away is an error rather than a guess.
 */
export async function inTheCall(page) {
  const leave = page.getByRole('button', { name: 'Leave the call' });
  if (!(await anyVisible(leave))) return null;
  const count = page.getByText(PARTICIPANTS, { exact: true });
  if (await anyVisible(count)) return participants(count);
  const toggle = await openCallSettings(page);
  if (!toggle) {
    // The call ended between the two looks, or the stage is not on screen to hold the count.
    if (!(await anyVisible(leave))) return null;
    throw new Error('in a call, but the stage is not on screen, so nothing says how many are in it');
  }
  try {
    await count.first().waitFor({ state: 'visible', timeout: 5_000 });
    return await participants(count);
  } finally {
    // The same control again: the gear and the menu line both toggle the popover.
    await toggle().catch(() => {});
  }
}

const PARTICIPANTS = /^\d+ participants?$/;

async function participants(locator) {
  const texts = await locator.allInnerTexts();
  const shown = texts.map((t) => t.trim()).find((t) => PARTICIPANTS.test(t));
  return shown === undefined ? null : Number.parseInt(shown, 10);
}

async function anyVisible(locator) {
  for (const el of await locator.all()) if (await el.isVisible()) return true;
  return false;
}

/**
 * Opens the call settings popover through the bar, and resolves with what closes it again — or null
 * when there is no bar to open it from. The gear while the bar has room, the "Call settings…" line
 * of its More menu when it does not; the gear has no name of its own, only its tooltip's
 * `aria-description`.
 */
async function openCallSettings(page) {
  const gear = page.locator('[aria-description="Call settings"]');
  if (await anyVisible(gear)) {
    const press = () => gear.first().click({ timeout: 5_000 });
    await press();
    return press;
  }
  const more = page.getByRole('button', { name: 'More controls' });
  if (!(await anyVisible(more))) return null;
  const press = async () => {
    await more.first().click({ timeout: 5_000 });
    await page.getByRole('menuitem', { name: 'Call settings…' }).first().click({ timeout: 5_000 });
  };
  await press();
  return press;
}

/** Answers the first-run name prompt, which is per account and covers the page until answered. */
export async function dismissNamePrompt(page, name = 'Dev') {
  // Exact: a role name matches by substring otherwise, and "Space name..." is a textbox too.
  const field = page.getByRole('textbox', { name: 'Name...', exact: true });
  if (await field.count()) {
    await field.fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
  }
  const later = page.getByRole('button', { name: 'Not now' });
  if (await later.count()) await later.first().click();
}

/**
 * A shared space made from the app's starter; returns its neighbourhood URL. With `mode`, the space's
 * call topology is set to it (`designated` or `mesh`), which is what decides it for a new call.
 */
export async function createSpace(page, account, name, mode) {
  await page
    .getByRole('button', { name: /^(Create a space|Add a space)$/ })
    .first()
    .click();
  const menu = page.getByRole('menuitem', { name: 'Create a space' });
  if (await menu.count()) await menu.click();
  await page.getByRole('textbox', { name: 'Space name...' }).fill(name);
  // Pressed where it is drawn, the `we-switch` itself: its input is visually hidden, so a click aimed
  // at the input is a click on a pixel, which may belong to something else (`enableTargets` in
  // coasys-spaces/steps.mjs).
  const drawn = page.locator('we-switch').first();
  const shared = drawn.getByRole('switch');
  if (!(await shared.evaluate((el) => el.checked))) await drawn.click();
  await page.getByRole('button', { name: 'Create Space' }).click();
  const perspective = await until(
    async () => (await account.client.perspective.all()).find((p) => p.name === name && p.sharedUrl),
    Boolean,
    { timeout: 180_000, what: `space "${name}" to be shared` },
  );
  // The app writes the address onto the space's record after publishing (SpaceStore `share`). A page
  // load before that write ends `share` and the record never gets it, so the space no longer matches
  // its own dataset. Waited for here, so a caller may load a page as soon as this returns.
  await until(
    async () => (await perspective.get(new LinkQuery({ predicate: 'we://url' }))).length,
    (n) => n > 0,
    { timeout: 120_000, what: `the app to record the address of "${name}"` },
  );
  if (mode) {
    const set = await perspective
      .getNeighbourhoodProxy()
      .setSfuConfig(perspective.sharedUrl, { mode, maxMeshParticipants: 6 });
    assert.equal(set, true, `setting the call topology of "${name}" to ${mode}`);
  }
  return perspective.sharedUrl;
}

/** Opens a space by its neighbourhood URL and waits for its Feed. */
export async function openSpace(page, app, sharedUrl) {
  await page.goto(`${app.url}/space/${sharedUrl.replace('neighbourhood://', '')}`);
  await page.getByText('Feed', { exact: true }).first().waitFor({ timeout: 120_000 });
  await dismissNamePrompt(page);
}
