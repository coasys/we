/**
 * One person in a call from several tabs and several devices, in the built web app against a real
 * multi-user executor — the way a person on a hosted node uses it.
 *
 * A browser context is a device and a page in it is a tab (see `harness.mjs`). The account is one
 * agent throughout: what is under test is how the agent's own tabs and devices see each other and
 * share a call, which nothing with two different agents exercises.
 *
 * Each topology gets its own space, made the way a person makes one: the app switched to Coasys,
 * a shared space created from its starter, and the call started from the Feed's "Start a call".
 * The topology is the space's call config (`setSfuConfig`), which is what decides it for a new call.
 *
 * Needs `pnpm build:web` and the pinned executor (`pnpm ad4m:executor`, or `AD4M_EXECUTOR`); Chrome
 * from playwright, `/usr/bin/google-chrome`, or `WE_CHROME`. Run with `pnpm --filter @we/app-web
 * test:live`.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import * as h from './harness.mjs';
import { createSpace, dismissNamePrompt, inTheCall, openSpace } from './space.mjs';

const REPLACED = 'You joined this call from another tab, so it ended here.';
const JOIN_BUTTON = /^(Open|Join)$/;

/** What the page says, shadow roots included. */
const text = (page) => page.locator('body').innerText();

/** The account's app becomes Coasys, so a space created next starts as one. */
async function useCoasys(page, app) {
  await page.goto(app.url);
  await page.getByRole('textbox', { name: 'Name...' }).waitFor({ timeout: 120_000 });
  await dismissNamePrompt(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Apps & templates' }).click();
  await page.getByRole('button', { name: 'Toggle options' }).first().click();
  await page
    .getByRole('option', { name: /Coasys/ })
    .first()
    .click();
  // The chosen app is written to the agent's own data before the chrome swaps over.
  await h.sleep(3_000);
  await page.keyboard.press('Escape');
}

const waitInCall = (page, n, what) =>
  h.until(
    () => inTheCall(page),
    (count) => count === n,
    { timeout: 90_000, what },
  );

/** Every shown video decodes frames, and there are `n` of them. */
const waitVideos = (page, n, what) =>
  h.until(
    () => h.videoFlow(page),
    (videos) => videos.length === n && videos.every((v) => v.width > 0 && v.frames > 0),
    { timeout: 90_000, what },
  );

const leaveCall = (page) => page.locator('we-icon[name="phone-x"]').first().click();

let executor;
let app;
let browser;
let account;
const opened = [];

before(async () => {
  executor = await h.startExecutor();
  app = await h.serveApp();
  browser = await h.launchBrowser();
  account = await h.signUp(executor, 'calls@test.com');
  const setup = await h.device(browser, executor, account, { name: 'setup' });
  opened.push(setup);
  await useCoasys(await setup.tab('settings'), app);
});

after(async () => {
  for (const device of opened) await device.close().catch(() => {});
  await browser?.close().catch(() => {});
  await app?.close();
  await executor?.stop();
});

for (const [topology, mode] of [
  ['sfu', 'designated'],
  ['mesh', 'mesh'],
]) {
  describe(`one agent's tabs and devices in a call (${topology})`, () => {
    let space;
    let laptop;
    let phone;
    let tabA;
    let tabB;
    let phoneTab;

    before(async () => {
      laptop = await h.device(browser, executor, account, { name: `${topology}-laptop` });
      phone = await h.device(browser, executor, account, { name: `${topology}-phone` });
      opened.push(laptop, phone);
      const page = await laptop.tab('setup');
      await page.goto(app.url);
      space = await createSpace(page, account, `Calls ${topology}`, mode);
      await page.close();

      tabA = await laptop.tab('A');
      await openSpace(tabA, app, space);
      await tabA.getByRole('button', { name: 'Start a call' }).first().click();
      await waitInCall(tabA, 1, 'tab A in its call');
    });

    after(() => {
      if (process.env.WE_LIVE_VERBOSE) console.log([...laptop.logs, ...phone.logs].join('\n'));
    });

    it('a second tab sees the call the first tab is in', async () => {
      tabB = await laptop.tab('B');
      await openSpace(tabB, app, space);
      await h.until(
        () => text(tabB),
        (t) => t.includes('Call running'),
        {
          timeout: 60_000,
          what: "tab B to show tab A's call running",
        },
      );
    });

    it('joining from the second tab moves the call there, and the first lets go', async () => {
      await tabB.getByRole('button', { name: JOIN_BUTTON }).first().click({ timeout: 30_000 });
      await waitInCall(tabB, 1, 'tab B in the call');
      await h.until(
        () => text(tabA),
        (t) => t.includes(REPLACED),
        {
          timeout: 60_000,
          what: 'tab A to say the call moved to another tab',
        },
      );
      assert.equal(await inTheCall(tabA), null, 'tab A is out of the call');
      await h.until(
        () => h.openConnections(tabA),
        (n) => n === 0,
        {
          timeout: 30_000,
          what: 'tab A to close every peer connection',
        },
      );
    });

    it("a second device of the same agent joins beside the first, each showing the other's tile", async () => {
      phoneTab = await phone.tab('C');
      await openSpace(phoneTab, app, space);
      await h.until(
        () => text(phoneTab),
        (t) => t.includes('Call running'),
        {
          timeout: 60_000,
          what: 'the second device to show the call running',
        },
      );
      await phoneTab.getByRole('button', { name: JOIN_BUTTON }).first().click({ timeout: 30_000 });
      await waitInCall(phoneTab, 2, 'the second device to count both devices');
      await waitInCall(tabB, 2, 'the first device to count both devices');
      await waitVideos(phoneTab, 2, 'two tiles with moving video on the second device');
      await waitVideos(tabB, 2, 'two tiles with moving video on the first device');
    });

    it('the second device hanging up leaves the first in the call', async () => {
      await leaveCall(phoneTab);
      await h.until(
        () => inTheCall(phoneTab),
        (n) => n === null,
        { what: 'the second device out of the call' },
      );
      await waitInCall(tabB, 1, 'the first device counting only itself');
      // Long enough for a teardown that was going to follow the other device out to have done so.
      await h.sleep(8_000);
      assert.equal(await inTheCall(tabB), 1, 'the first device is still in the call');
      assert.ok(!(await text(tabB)).includes(REPLACED), 'the first device was not told the call moved');
      await waitVideos(tabB, 1, "the first device's own video still moving");
    });
  });
}
