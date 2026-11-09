/**
 * The Coasys app before a session, end to end: the built page (`dist/`) in Chrome, with no executor
 * anywhere. Each case acts as a person does — reads the words on screen, presses a control by them —
 * and checks what the page shows next.
 *
 * - The phone: the first run's three doors, "Link to my identity" leaving for the phone's identity
 *   page, "Start now" → where to connect → the hand-off to WE's app; and offline → "Try again".
 * - The browser: where to connect → the hand-off.
 *
 * The phone's native layer is the one stand-in. A Playwright init script answers as the phone app's
 * `DeviceKey` plugin does for a phone that has joined no identity (`NoIdentity`), through the same
 * bridge the WebView exposes (`window.Capacitor`). Nothing else in the page is replaced.
 *
 * Needs `pnpm build:coasys` first, and Chrome (`WE_CHROME`, `/usr/bin/google-chrome` by default).
 * `WE_COASYS_SHOTS=<dir>` keeps a screenshot after each step.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const CHROME = process.env.WE_CHROME ?? '/usr/bin/google-chrome';
const SHOTS = process.env.WE_COASYS_SHOTS ?? null;
const STEP_MS = 20_000;

/**
 * The namespace the AD4M Connect this app bundles keeps its keys under: `${version}/`, its package's
 * version (its `setLocal`). A session written under any other is one the page would not resume.
 */
const CONNECT_PREFIX = (() => {
  const utils = createRequire(import.meta.url).resolve('@coasys/ad4m-connect/utils');
  const { version } = JSON.parse(readFileSync(join(dirname(utils), '..', 'package.json'), 'utf8'));
  return `${version}/`;
})();

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
      !document.querySelector('[data-node-id^="base__"]') && !/Where is your Coasys\?/.test(document.body.innerText),
    null,
    { timeout: STEP_MS },
  );
}

describe('the phone, with no identity and no executor', () => {
  it('opens on the first run, with the one door a phone opens', async () => {
    const { context, page } = await open({ phone: true });
    await sees(page, 'Join your identity');
    await shot(page, 'phone-first-run');
    assert.equal(await closed(control(page, 'Link to my identity')), false);
    assert.equal(await closed(control(page, 'Make my identity here')), true);
    assert.equal(await closed(control(page, 'Use my 12 words')), true);
    await sees(page, 'make it on your computer');
    // A phone is the one scanned or handed an offer, never the one showing a code to scan.
    await sees(page, 'scan or paste the offer it makes for this phone');
    assert.equal(await page.getByText('it scans this code').count(), 0);
    await context.close();
  });

  it("leaves for the phone's identity page to join, coming back to the app", async () => {
    const { context, page } = await open({ phone: true });
    await sees(page, 'Join your identity');
    await Promise.all([
      page.waitForURL(/\/mobile\/identity\.html\?/, { timeout: STEP_MS }),
      control(page, 'Link to my identity').click(),
    ]);
    const url = new URL(page.url());
    assert.ok(url.searchParams.has('join'));
    assert.equal(url.searchParams.get('back'), '/');
    await context.close();
  });

  it("starts now, offers where to connect, and hands the page to WE's app", async () => {
    const { context, page } = await open({ phone: true });
    await sees(page, 'Join your identity');
    await control(page, 'Start now').click();
    await sees(page, 'Where is your Coasys?');
    await sees(page, '127.0.0.1:9');
    await sees(page, 'AD4M Connect');
    await sees(page, 'None is offered yet.');
    await shot(page, 'phone-connection-choice');
    await control(page, 'AD4M Connect').click();
    await handedOff(page);
    await shot(page, 'phone-hand-off');
    // "Start now" is remembered on the device: a reload asks no first-run question again.
    await page.reload();
    await handedOff(page);
    await context.close();
  });

  it('shows the device offline, stays there on "Try again" with no network, and goes on once it is back', async () => {
    const { context, page } = await open({ phone: true });
    await control(page, 'Start now').click();
    await sees(page, 'Where is your Coasys?');
    await context.setOffline(true);
    await control(page, 'AD4M Connect').click();
    await sees(page, 'You are offline');
    await shot(page, 'phone-offline');
    await control(page, 'Try again').click();
    await sees(page, 'You are offline');
    // The network coming back is a try of its own: nobody has to press anything.
    await context.setOffline(false);
    await handedOff(page);
    await context.close();
  });

  /*
    Found on a real phone: relaunched with the executor AD4M Connect signed in to last switched off,
    the app drew AD4M Connect's own "How would you like to connect?" instead of the base's offline
    state. The session is the shape ad4m-connect stores, against an address where nothing listens.
  */
  it("relaunches to the offline state when AD4M Connect's last executor does not answer", async () => {
    const { context, page } = await open({ phone: true });
    await control(page, 'Start now').click();
    await control(page, 'AD4M Connect').click();
    await handedOff(page);
    await page.evaluate(
      ({ prefix, url }) => {
        localStorage.setItem(`${prefix}ad4m-token`, 'a-test-token');
        localStorage.setItem(`${prefix}ad4m-url`, url);
      },
      { prefix: CONNECT_PREFIX, url: 'http://127.0.0.1:9' },
    );
    await page.reload();
    await sees(page, 'could not be reached');
    await sees(page, 'did not answer');
    assert.equal(await page.getByText('How would you like to connect?').count(), 0);
    await shot(page, 'phone-relaunch-offline');
    await context.close();
  });
});

describe('the browser, with no executor', () => {
  it('asks no first-run question, offers AD4M Connect, and hands off', async () => {
    const { context, page } = await open();
    await sees(page, 'Where is your Coasys?');
    assert.equal(await page.getByText('Make my identity here').count(), 0);
    await shot(page, 'web-connection-choice');
    await control(page, 'AD4M Connect').click();
    await handedOff(page);
    await shot(page, 'web-hand-off');
    await context.close();
  });
});
