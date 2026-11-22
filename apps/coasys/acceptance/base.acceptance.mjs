/**
 * The Coasys app before a session, end to end: the built page (`dist/`) in Chrome, with no executor
 * anywhere. Each case acts as a person does — reads the words on screen, presses a control by them —
 * and checks what the page shows next.
 *
 * - The phone: the first run's three doors, "Link to another device" leaving for the phone's identity
 *   page, "Skip for now" → where to connect → the hand-off to WE's app; and offline → "Try again".
 * - The browser: where to connect → the hand-off.
 *
 * The phone's native layer is the one stand-in. A Playwright init script answers as the phone app's
 * `DeviceKey` plugin does for a phone that has joined no identity (`NoIdentity`), through the same
 * bridge the WebView exposes (`window.Capacitor`). Nothing else in the page is replaced.
 *
 * Needs `pnpm build:coasys` first, and Chrome (`WE_CHROME`, `/usr/bin/google-chrome` by default).
 * `WE_COASYS_SHOTS=<dir>` keeps a screenshot after each step.
 */
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const CHROME = process.env.WE_CHROME ?? '/usr/bin/google-chrome';
const SHOTS = process.env.WE_COASYS_SHOTS ?? null;
const STEP_MS = 20_000;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** The built page, as a host serves it: a file where there is one, `index.html` everywhere else. */
function serve() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(DIST, path);
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/**
 * The phone app's bridge, answering for a phone with no identity. A port nothing listens on is the
 * executor the phone was told to log in to: there is no executor.
 */
function phoneBridge() {
  const NO_EXECUTOR = 'http://127.0.0.1:9';
  localStorage.setItem('we-phone/key-host', NO_EXECUTOR);
  const refuse = (code) => Promise.reject(Object.assign(new Error(code), { code }));
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    isPluginAvailable: (name) => name === 'DeviceKey',
    nativePromise(plugin, method) {
      if (plugin !== 'DeviceKey') return refuse('UNIMPLEMENTED');
      if (method === 'devices') return Promise.resolve({ devices: [] });
      if (method === 'requests') return Promise.resolve({ requests: [] });
      if (method === 'masterWaiting') return Promise.resolve({ waiting: false });
      return refuse('NoIdentity');
    },
  };
}

let server;
let browser;
let origin;

before(async () => {
  assert.ok(existsSync(join(DIST, 'index.html')), 'Build the app first: pnpm build:coasys');
  server = await serve();
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
});

/** A fresh page, as a first start: nothing stored. */
async function open({ phone = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 420, height: 860 } });
  if (phone) await context.addInitScript(phoneBridge);
  const page = await context.newPage();
  await page.goto(`${origin}/`);
  return { context, page };
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** The control whose words are `words`, as a person finds it. */
const control = (page, words) => page.locator('we-button').filter({ hasText: words }).first();

/** Whether a `we-button` cannot be pressed: its own property, which Playwright's check does not read. */
const closed = (locator) => locator.evaluate((el) => el.disabled === true || el.hasAttribute('disabled'));

const sees = (page, words) => page.getByText(words, { exact: false }).first().waitFor({ timeout: STEP_MS });

/** WE's app has the page: no screen of the app before a session is left. */
async function handedOff(page) {
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-node-id^="base__"]') && !/Where to keep your spaces/.test(document.body.innerText),
    null,
    { timeout: STEP_MS },
  );
}

describe('the phone, with no identity and no executor', () => {
  it('opens on the first run, with the one door a phone opens', async () => {
    const { context, page } = await open({ phone: true });
    await sees(page, 'Link this phone');
    await shot(page, 'phone-first-run');
    assert.equal(await closed(control(page, 'Link to another device')), false);
    assert.equal(await closed(control(page, 'Create new identity')), true);
    assert.equal(await closed(control(page, 'Restore with recovery phrase')), true);
    await sees(page, 'Create it on a computer, then link this phone.');
    // A phone is the one scanned or handed an offer, never the one showing a code to scan.
    await sees(page, 'Enter the code from a computer that has your master key.');
    assert.equal(await page.getByText('Show a code to scan').count(), 0);
    await context.close();
  });

  it("leaves for the phone's identity page to join, coming back to the app", async () => {
    const { context, page } = await open({ phone: true });
    await sees(page, 'Link this phone');
    await Promise.all([
      page.waitForURL(/\/mobile\/identity\.html\?/, { timeout: STEP_MS }),
      control(page, 'Link to another device').click(),
    ]);
    const url = new URL(page.url());
    assert.ok(url.searchParams.has('join'));
    assert.equal(url.searchParams.get('back'), '/');
    await context.close();
  });

  it("starts now, offers where to connect, and hands the page to WE's app", async () => {
    const { context, page } = await open({ phone: true });
    await sees(page, 'Link this phone');
    await control(page, 'Skip for now').click();
    await sees(page, 'Where to keep your spaces');
    await sees(page, '127.0.0.1:9');
    await sees(page, 'Link this browser');
    await sees(page, 'Hosts run by Coasys and by communities will appear here.');
    await shot(page, 'phone-connection-choice');
    await control(page, 'Link this browser').click();
    await handedOff(page);
    await shot(page, 'phone-hand-off');
    // "Skip for now" is remembered on the device: a reload asks no first-run question again.
    await page.reload();
    await handedOff(page);
    await context.close();
  });

  it('shows the device offline, stays there on "Try again" with no network, and goes on once it is back', async () => {
    const { context, page } = await open({ phone: true });
    await control(page, 'Skip for now').click();
    await sees(page, 'Where to keep your spaces');
    await context.setOffline(true);
    await control(page, 'Link this browser').click();
    await sees(page, 'Can’t connect');
    await shot(page, 'phone-offline');
    await control(page, 'Try again').click();
    await sees(page, 'Can’t connect');
    // The network coming back is a try of its own: nobody has to press anything.
    await context.setOffline(false);
    await handedOff(page);
    await context.close();
  });

  /*
    Coasys Connect keeps no executor in this page: the token is in memory and the browser key is the
    frame's, so a reload asks the frame again and there is no "last executor" to be unreachable.
  */
  it('keeps no session in this page across a reload', async () => {
    const { context, page } = await open({ phone: true });
    await control(page, 'Skip for now').click();
    await control(page, 'Link this browser').click();
    await handedOff(page);
    const stored = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
    assert.deepEqual(
      stored.filter((key) => /token|ad4m-url/.test(key)),
      [],
    );
    await context.close();
  });
});

describe('the browser, with no executor', () => {
  it('asks no first-run question, offers to link this browser, and hands off', async () => {
    const { context, page } = await open();
    await sees(page, 'Where to keep your spaces');
    assert.equal(await page.getByText('Create new identity').count(), 0);
    await shot(page, 'web-connection-choice');
    await control(page, 'Link this browser').click();
    await handedOff(page);
    await shot(page, 'web-hand-off');
    await context.close();
  });
});
