/**
 * A `we-switch` inside a scroll area is brought into view by that scroll area.
 *
 * The switch's input is visually hidden and absolutely positioned. With nothing in the switch
 * positioned, it belonged to the nearest positioned box around it — in a space's settings, the dock
 * frame outside the panel's scroll area — so focusing the switch scrolled that frame (overflow:
 * hidden, nothing a person can scroll back) and slid the whole panel out of sight, and a click at the
 * input's place landed on the frame. jsdom has no layout, so a real browser is asked.
 *
 * Drives the Chrome already installed (`channel: 'chrome'`); `WE_CHROME_PATH` points it at another
 * Chromium build instead.
 */
import path from 'node:path';

import { build } from 'esbuild';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

let browser: Browser;
let page: Page;

beforeAll(async () => {
  const bundle = await build({
    entryPoints: [path.join(ROOT, 'src/index.ts')],
    absWorkingDir: ROOT,
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'WE',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' },
    loader: { '.css': 'text', '.svg': 'text' },
    logLevel: 'error',
  });
  browser = await chromium.launch(
    process.env.WE_CHROME_PATH ? { executablePath: process.env.WE_CHROME_PATH } : { channel: 'chrome' },
  );
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent('<!doctype html><html><body style="margin:0;font:14px sans-serif"></body></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
});

afterAll(async () => {
  await browser?.close();
});

/**
 * A positioned frame that clips (the dock frame), holding a scroller (the panel's scroll area) whose
 * content is taller than it, with the switch at the bottom. Replaces whatever the last test drew.
 */
async function mount() {
  await page.evaluate(`(async () => {
    document.body.innerHTML = \`
      <div id="frame" style="position:relative;overflow:hidden;height:400px">
        <div id="scroller" style="overflow:auto;height:300px">
          <div style="height:1200px"></div>
          <we-switch id="switch" label="Question"></we-switch>
        </div>
      </div>\`;
    await document.getElementById('switch').updateComplete;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  })()`);
}

const scrolls = () =>
  page.evaluate(`({
    frame: document.getElementById('frame').scrollTop,
    scroller: document.getElementById('scroller').scrollTop,
  })`) as Promise<{ frame: number; scroller: number }>;

describe('we-switch in a scroll area', () => {
  it('scrolls the scroll area, not the frame around it, when the switch is focused', async () => {
    await mount();
    await page.getByRole('switch', { name: 'Question' }).focus();
    const after = await scrolls();
    expect(after.frame).toBe(0);
    expect(after.scroller).toBeGreaterThan(0);
  });

  it('is in sight once focused, and Space presses it', async () => {
    await mount();
    await page.getByRole('switch', { name: 'Question' }).focus();
    // What is under the middle of the drawn track is the switch: the scroller brought it into its view.
    const underTrack = await page.evaluate(`(() => {
      const track = document.getElementById('switch').shadowRoot.querySelector('[part="track"]');
      const box = track.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.id ?? null;
    })()`);
    expect(underTrack).toBe('switch');
    await page.keyboard.press('Space');
    expect(await page.evaluate(`document.getElementById('switch').checked`)).toBe(true);
    expect((await scrolls()).frame).toBe(0);
  });
});
