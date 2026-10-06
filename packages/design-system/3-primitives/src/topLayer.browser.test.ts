/**
 * The top layer, held for the host's own question — checked where a top layer exists.
 *
 * jsdom has no top layer and no hit-testing, so everything this guards against is invisible to it:
 * whether a sheet a template opened is drawn over the host's prompt, and where a click on that spot
 * lands. Both are a real browser's answer, so that is what is asked.
 *
 * Each case mounts the real `we-modal` from source. "Prompt" is the host's question, mounted inside
 * the element that holds the layer; "sheet" is a template's overlay, mounted outside it.
 */
import path from 'node:path';

import { build } from 'esbuild';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

const PAGE = `<!doctype html>
<html>
<head><style>body { margin: 0; font: 14px sans-serif; }</style></head>
<body><div id="template"></div><div id="prompts"></div></body>
</html>`;

const HARNESS = `
window.harness = {
  release: null,
  closed: [],
  reset() {
    this.release?.();
    this.release = null;
    this.closed = [];
    document.getElementById('template').replaceChildren();
    document.getElementById('prompts').replaceChildren();
  },
  modal(where, id) {
    const el = document.createElement('we-modal');
    el.id = id;
    el.close = () => this.closed.push(id);
    const button = document.createElement('button');
    button.textContent = id;
    button.id = id + '-button';
    button.style.cssText = 'width: 300px; height: 200px';
    el.append(button);
    document.getElementById(where).append(el);
    return el;
  },
  hold() {
    this.release = WE.holdTopLayer(document.getElementById('prompts'));
  },
  shown(id) {
    return document.getElementById(id).matches(':popover-open');
  },
  /** What a click in the middle of the window would reach. */
  hit() {
    let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    while (el?.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(innerWidth / 2, innerHeight / 2);
      if (!inner || inner === el) break;
      el = inner;
    }
    // Up the composed tree, since the backdrop a click lands on is inside the modal's shadow root.
    for (let node = el; node; node = node.parentNode ?? node.host) {
      if (node.tagName === 'WE-MODAL') return node.id;
    }
    return null;
  },
  frames() {
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  },
};`;

let browser: Browser;
let page: Page;

const harness = <T>(body: string): Promise<T> => page.evaluate(`(async () => { ${body} })()`) as Promise<T>;

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
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.setContent(PAGE);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.addScriptTag({ content: HARNESS });
  await page.evaluate(() =>
    (window as unknown as { WE: { installTopLayerGuard: () => void } }).WE.installTopLayerGuard(),
  );
});

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  await harness('harness.reset()');
});

describe('while the host holds the top layer', () => {
  it('keeps a sheet opened afterwards from being drawn over its prompt', async () => {
    const result = await harness<{ sheetShown: boolean; hit: string }>(`
      harness.modal('prompts', 'prompt');
      harness.hold();
      harness.modal('template', 'sheet');
      await harness.frames();
      return { sheetShown: harness.shown('sheet'), hit: harness.hit() };
    `);
    expect(result.sheetShown).toBe(false);
    expect(result.hit).toBe('prompt');
  });

  it('shows the sheet once the question is answered', async () => {
    const result = await harness<{ before: boolean; after: boolean; hit: string }>(`
      const prompt = harness.modal('prompts', 'prompt');
      harness.hold();
      harness.modal('template', 'sheet');
      const before = harness.shown('sheet');
      prompt.remove();
      harness.release();
      harness.release = null;
      await harness.frames();
      return { before, after: harness.shown('sheet'), hit: harness.hit() };
    `);
    expect(result.before).toBe(false);
    expect(result.after).toBe(true);
    expect(result.hit).toBe('sheet');
  });

  it('lets the prompt open things of its own', async () => {
    const shown = await harness<boolean>(`
      harness.modal('prompts', 'prompt');
      harness.hold();
      harness.modal('prompts', 'nested');
      return harness.shown('nested');
    `);
    expect(shown).toBe(true);
  });

  it('puts the prompt on top of a sheet opened in the same breath', async () => {
    // The ordering a template controls: raise the host's confirmation and mount a sheet in one
    // handler, so the sheet enters the layer after the prompt and before anything holds it.
    const hit = await harness<string>(`
      harness.modal('prompts', 'prompt');
      harness.modal('template', 'sheet');
      harness.hold();
      await harness.frames();
      return harness.hit();
    `);
    expect(hit).toBe('prompt');
  });

  it('gives Escape to the prompt, not to a sheet waiting behind it', async () => {
    const closed = await harness<string[]>(`
      harness.modal('prompts', 'prompt');
      harness.hold();
      harness.modal('template', 'sheet');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return harness.closed;
    `);
    expect(closed).toEqual(['prompt']);
  });

  it('defers a sheet that a template opens with showModal on a dialog, too', async () => {
    const result = await harness<{ open: boolean; after: boolean }>(`
      harness.modal('prompts', 'prompt');
      harness.hold();
      const dialog = document.createElement('dialog');
      document.getElementById('template').append(dialog);
      dialog.showModal();
      const open = dialog.open;
      harness.release();
      harness.release = null;
      return { open, after: dialog.open };
    `);
    expect(result.open).toBe(false);
    expect(result.after).toBe(true);
  });
});
