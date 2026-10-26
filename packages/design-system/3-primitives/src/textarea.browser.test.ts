/**
 * `we-textarea` fits itself to what it holds — including when it is first drawn hidden.
 *
 * A folded section that keeps its contents mounted draws the box while it cannot be seen, where its
 * content measures zero high. It used to keep that height when revealed: a sliver a few pixels tall,
 * clickable only along its top edge. jsdom has no layout, so a real browser is asked.
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

const frames = 'await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));';

describe('autoGrow', () => {
  it('measures again when a box drawn hidden is shown', async () => {
    const heights = (await page.evaluate(`(async () => {
      const fold = document.createElement('div');
      fold.style.display = 'none';
      const box = document.createElement('we-textarea');
      box.autoGrow = true;
      box.value = 'one\\ntwo\\nthree';
      fold.append(box);
      document.body.append(fold);
      await box.updateComplete;
      ${frames}
      const field = () => box.shadowRoot.querySelector('textarea');
      fold.style.display = 'block';
      ${frames}
      const shown = field().getBoundingClientRect().height;
      const reference = document.createElement('we-textarea');
      reference.autoGrow = true;
      reference.value = 'one\\ntwo\\nthree';
      document.body.append(reference);
      await reference.updateComplete;
      ${frames}
      return { shown, drawnVisible: reference.shadowRoot.querySelector('textarea').getBoundingClientRect().height };
    })()`)) as { shown: number; drawnVisible: number };
    expect(heights.shown).toBeGreaterThan(30);
    expect(heights.shown).toBeCloseTo(heights.drawnVisible, 0);
  });
});
