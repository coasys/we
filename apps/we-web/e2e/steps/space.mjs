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
 * The "N in the call" count on the call bar, or null when the page is not in a call. Read from the
 * number element itself: its digits are in its shadow root, which `innerText` does not reach.
 */
export function inTheCall(page) {
  return page.evaluate(() => {
    const find = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.tagName === 'WE-NUMBER' && el.closest('we-text')?.textContent?.trim() === 'in the call') {
          return Number(el.value);
        }
        if (el.shadowRoot) {
          const found = find(el.shadowRoot);
          if (found !== null) return found;
        }
      }
      return null;
    };
    return find(document);
  });
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
