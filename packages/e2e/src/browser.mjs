/**
 * Chrome as a person's devices: a browser context is a browser profile — one device — and a page in
 * it is one of that device's tabs. Two pages in one context share its `localStorage` (where the
 * device id lives) and its `BroadcastChannel`s; two contexts share nothing.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

import { chromePath } from './env.mjs';

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Chrome (`chromePath()`), headless, with a fake camera and microphone. `fakeAudio` names a WAV file
 * the fake microphone plays instead of its beep: 16 kHz mono PCM is what transcription hears best.
 */
export async function launchBrowser({ fakeAudio, headless = true } = {}) {
  return chromium.launch({
    executablePath: chromePath(),
    headless,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      ...(fakeAudio ? [`--use-file-for-fake-audio-capture=${fakeAudio}`] : []),
    ],
  });
}

/**
 * ad4m-connect keeps its session under its own version: `<version>/ad4m-url`, `<version>/ad4m-token`.
 * `WE_CONNECT_VERSION` names it when the build under test bundles an ad4m-connect other than the
 * installed one — a local ad4m checkout, before it is published. The installed one is the pin's, the
 * same in every workspace package.
 */
export function connectVersion() {
  if (process.env.WE_CONNECT_VERSION) return process.env.WE_CONNECT_VERSION;
  const manifest = join(PACKAGE, 'node_modules', '@coasys', 'ad4m-connect', 'package.json');
  return JSON.parse(readFileSync(manifest, 'utf8')).version;
}

/**
 * One device: a browser profile signed in as `account`, as ad4m-connect leaves one after its
 * "Remote node" screen. Pages opened from it with `tab(label)` are that device's tabs, and what they
 * log to the console is kept in `logs`.
 */
export async function device(browser, executor, account, { name, viewport = { width: 1280, height: 860 } } = {}) {
  const context = await browser.newContext({ viewport });
  await context.grantPermissions(['camera', 'microphone']);
  const version = connectVersion();
  await context.addInitScript(
    ([version, url, token]) => {
      if (localStorage.getItem(`${version}/ad4m-token`)) return;
      localStorage.setItem(`${version}/ad4m-url`, url);
      localStorage.setItem(`${version}/ad4m-token`, token);
    },
    [version, executor.url, account.token],
  );
  // Every peer connection a page makes, so a test can ask whether a tab still holds one.
  await context.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    if (!Native) return;
    const made = [];
    window.__wePeerConnections = made;
    window.RTCPeerConnection = class extends Native {
      constructor(...args) {
        super(...args);
        made.push(this);
      }
    };
  });
  const logs = [];
  const tab = async (label) => {
    const page = await context.newPage();
    const tag = `${name ?? account.email}/${label}`;
    page.on('console', (msg) => logs.push(`[${tag}] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', (err) => logs.push(`[${tag}] pageerror: ${err.message}`));
    return page;
  };
  return { name: name ?? account.email, context, tab, logs, close: () => context.close() };
}

/** How many of a page's peer connections are not closed. */
export function openConnections(page) {
  return page.evaluate(() => (window.__wePeerConnections ?? []).filter((pc) => pc.connectionState !== 'closed').length);
}

/**
 * The page's video elements showing a stream, each with how many frames it decoded over `ms`.
 * Shadow roots included: the call's tiles sit inside components.
 */
export function videoFlow(page, ms = 2_000) {
  return page.evaluate(async (ms) => {
    const videos = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.tagName === 'VIDEO' && el.srcObject) videos.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    const frames = () => videos.map((v) => v.getVideoPlaybackQuality?.().totalVideoFrames ?? 0);
    const before = frames();
    await new Promise((done) => setTimeout(done, ms));
    return frames().map((n, i) => ({ width: videos[i].videoWidth, frames: n - before[i] }));
  }, ms);
}
