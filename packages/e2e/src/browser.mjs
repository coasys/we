/**
 * Chrome as a person's devices: a browser context is a browser profile — one device — and a page in
 * it is one of that device's tabs. Two pages in one context share its `localStorage` (where the
 * device id lives) and its `BroadcastChannel`s; two contexts share nothing.
 */
import { chromium } from 'playwright-core';

import { chromePath } from './env.mjs';

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
 * One device: a browser profile signed in as `account`, through the boot session an embedding host
 * hands WE (`window.__WE_AD4M_SESSION`, read once and never stored). Pages opened from it with `tab(label)` are that device's tabs, and what they
 * log to the console is kept in `logs`.
 */
export async function device(browser, executor, account, { name, viewport = { width: 1280, height: 860 } } = {}) {
  const context = await browser.newContext({ viewport });
  await context.grantPermissions(['camera', 'microphone']);
  await context.addInitScript(
    ([url, token]) => {
      window.__WE_AD4M_SESSION = { url, token };
    },
    [executor.url, account.token],
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
