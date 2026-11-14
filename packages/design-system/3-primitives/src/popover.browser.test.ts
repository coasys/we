/**
 * A popover stays inside the window — checked where there is a window to measure.
 *
 * jsdom lays nothing out, so where Floating UI puts a panel is a real browser's answer. The case that
 * failed: the person menu at the foot of a phone's rail asks for `right-end`, and on a phone the
 * rail is as wide as the window. There was no room on the right and none on the left, `flip` only
 * tried those two, and the menu opened off the right edge of the screen.
 *
 * Each case mounts the real `we-popover` from source in a phone-sized window (390×844), opens it and
 * measures the panel the browser drew.
 */
import path from 'node:path';

import { build } from 'esbuild';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const VIEWPORT = { width: 390, height: 844 };

const PAGE = `<!doctype html>
<html>
<head><style>body { margin: 0; font: 14px sans-serif; }</style></head>
<body><div id="stage"></div></body>
</html>`;

const HARNESS = `
window.harness = {
  reset() {
    document.getElementById('stage').replaceChildren();
  },
  /** A popover whose trigger is the given box, fixed in the window, with content of the given size. */
  async open({ trigger, placement, content }) {
    const popover = document.createElement('we-popover');
    popover.placement = placement;
    const button = document.createElement('button');
    button.slot = 'trigger';
    button.textContent = 'Trigger';
    button.style.cssText = 'position: fixed; margin: 0; border: 0; padding: 0;'
      + 'left:' + trigger.x + 'px; top:' + trigger.y + 'px; width:' + trigger.width + 'px; height:' + trigger.height + 'px';
    const panel = document.createElement('div');
    panel.slot = 'content';
    panel.style.cssText = 'width:' + content.width + 'px; height:' + content.height + 'px; background: #eee';
    panel.textContent = 'Menu';
    popover.append(button, panel);
    document.getElementById('stage').append(popover);
    await popover.updateComplete;
    popover.open = true;
    await popover.updateComplete;
    // Floating UI positions on a promise, then again after size() changes the panel's dimensions.
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    const drawn = popover.shadowRoot.querySelector('[popover]');
    const rect = drawn.getBoundingClientRect();
    const triggerRect = button.getBoundingClientRect();
    return {
      shown: drawn.matches(':popover-open'),
      panel: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      trigger: { left: triggerRect.left, right: triggerRect.right, top: triggerRect.top, bottom: triggerRect.bottom },
      scrolls: drawn.scrollHeight > drawn.clientHeight,
    };
  },
};`;

type Box = { left: number; right: number; top: number; bottom: number };
type Opened = { shown: boolean; panel: Box; trigger: Box; scrolls: boolean };

let browser: Browser;
let page: Page;

const open = (args: {
  trigger: { x: number; y: number; width: number; height: number };
  placement: string;
  content: { width: number; height: number };
}) => page.evaluate((a) => (window as unknown as { harness: { open: (x: unknown) => Opened } }).harness.open(a), args);

const inWindow = (box: Box) => {
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(VIEWPORT.width);
  expect(box.bottom).toBeLessThanOrEqual(VIEWPORT.height);
};

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
  page = await browser.newPage({ viewport: VIEWPORT });
  await page.setContent(PAGE);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.addScriptTag({ content: HARNESS });
});

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  await page.evaluate(() => (window as unknown as { harness: { reset: () => void } }).harness.reset());
});

describe('a popover in a phone-sized window', () => {
  it('opens above a trigger as wide as the window when it asked for the right of it', async () => {
    // The person at the foot of a phone's rail, with the rail open across the whole window.
    const result = await open({
      trigger: { x: 0, y: 780, width: 390, height: 56 },
      placement: 'right-end',
      content: { width: 220, height: 180 },
    });
    expect(result.shown).toBe(true);
    inWindow(result.panel);
    // Above the person, not over them.
    expect(result.panel.bottom).toBeLessThanOrEqual(result.trigger.top);
  });

  it('still opens to the right where there is room, as on a desktop', async () => {
    const result = await open({
      trigger: { x: 0, y: 780, width: 72, height: 56 },
      placement: 'right-end',
      content: { width: 220, height: 180 },
    });
    inWindow(result.panel);
    expect(result.panel.left).toBeGreaterThanOrEqual(result.trigger.right);
    // `-end`: its foot level with the trigger's.
    expect(Math.round(result.panel.bottom)).toBe(Math.round(result.trigger.bottom));
  });

  it('is kept inside the window when it is wider than the room beside its trigger', async () => {
    const result = await open({
      trigger: { x: 300, y: 100, width: 80, height: 40 },
      placement: 'bottom-start',
      content: { width: 300, height: 120 },
    });
    inWindow(result.panel);
  });

  it('scrolls what does not fit rather than drawing it off the screen', async () => {
    const result = await open({
      trigger: { x: 0, y: 400, width: 390, height: 44 },
      placement: 'bottom',
      content: { width: 200, height: 1200 },
    });
    inWindow(result.panel);
    expect(result.scrolls).toBe(true);
  });
});
