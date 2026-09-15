/**
 * The cascade, resolved by a browser — what the stylesheet tests can only describe.
 *
 * Every bug this exists for passed every unit test, because a unit test can check the text of a
 * rule and not which rule wins. A truncated label unwrapped on hover; a header label shown at a
 * breakpoint vanished under the pointer and flashed; pressing a textarea took its focus ring away;
 * `we-link` never showed its hover underline. Each is a computed style under a real pointer at a
 * real container width, so that is what this checks, on the real primitives bundled from source.
 *
 * Drives the Chrome already installed (`channel: 'chrome'`, as `apps/we-preview` does) so it
 * downloads nothing. `WE_CHROME_PATH` points it at another Chromium build instead.
 */
import fs from 'node:fs';
import path from 'node:path';

import { build } from 'esbuild';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DS_LAYERS } from './shared/helpers';

const ROOT = path.resolve(import.meta.dirname, '..');

const PAGE = `<!doctype html>
<html>
<head>
<style>
  /* No arrival fade, so a state is fully applied by the time it is read. Departures already snap. */
  :root { --we-theme-state-duration: 0s; }
  /* The few roles a check reads, since no theme is loaded: distinct, so no two states can agree by accident. */
  :root { --we-ring-color: rgb(0, 90, 200); --we-role-border: rgb(200, 200, 200); --we-role-border-hover: rgb(150, 150, 150); }
  body { margin: 0; font: 14px sans-serif; }
  .surface { container: we-surface / inline-size; padding: 8px 0; }
</style>
</head>
<body><div id="stage"></div></body>
</html>`;

/** In the page: mounting, reading and sampling, so each test is a few lines on the Node side. */
const HARNESS = `
window.harness = {
  async frames() {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    // A component may bring its own transition; the question is where a state lands, not how.
    for (const animation of document.getAnimations()) {
      try { animation.finish(); } catch { /* an infinite animation cannot finish, and is not a state */ }
    }
  },
  async mount(id, tag, { width = 1000, attrs = {}, props = {}, text = 'A label long enough to need truncating' } = {}) {
    const surface = document.createElement('div');
    surface.className = 'surface';
    surface.style.width = width + 'px';
    const el = document.createElement(tag);
    el.id = id;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    Object.assign(el, props);
    if (text) el.textContent = text;
    surface.append(el);
    document.getElementById('stage').append(surface);
    await el.updateComplete;
    await this.frames();
  },
  node(id, part = 'base') {
    const host = document.getElementById(id);
    return part === 'host' ? host : host.shadowRoot.querySelector('[part=' + part + ']');
  },
  read(id, prop, part) {
    return getComputedStyle(this.node(id, part)).getPropertyValue(prop);
  },
  box(id, part) {
    const el = this.node(id, part);
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + Math.min(8, r.width / 2), y: r.y + r.height / 2, width: r.width, height: r.height };
  },
  async sample(id, prop, part, frames = 20) {
    const seen = new Set();
    for (let i = 0; i < frames; i++) {
      seen.add(this.read(id, prop, part));
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    return [...seen];
  },
  focus(id) {
    const root = document.getElementById(id).shadowRoot;
    root.querySelector('button, input, textarea, a[href], [tabindex]:not([tabindex="-1"])').focus({ focusVisible: true });
  },
  /** Every rule a primitive adopts that is not inside one of the named layers. */
  outsideLayers(tag, layers) {
    const el = document.createElement(tag);
    document.getElementById('stage').append(el);
    const root = el.shadowRoot;
    const found = [];
    for (const sheet of root ? root.adoptedStyleSheets : []) {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSLayerStatementRule) continue;
        if (rule instanceof CSSLayerBlockRule && layers.includes(rule.name)) continue;
        found.push(rule.cssText.slice(0, 80));
      }
    }
    el.remove();
    return found;
  },
};`;

let browser: Browser;
let page: Page;

async function mount(id: string, tag: string, options: Record<string, unknown> = {}) {
  await page.evaluate(([i, t, o]) => window.harness.mount(i, t, o), [id, tag, options] as const);
}
const read = (id: string, prop: string, part?: string) =>
  page.evaluate(([i, p, pt]) => window.harness.read(i, p, pt), [id, prop, part] as const);

/**
 * A reading after the pointer or focus moved. `:hover` lands a frame or two after the mouse does and
 * a component may animate into it, so this waits for the value rather than for a fixed time.
 */
const settled = (id: string, prop: string, part?: string) =>
  expect.poll(() => read(id, prop, part), { timeout: 3000, interval: 50 });

async function hover(id: string, part?: string) {
  const box = await page.evaluate(([i, pt]) => window.harness.box(i, pt), [id, part] as const);
  await page.mouse.move(box.x, box.y);
  await page.evaluate(() => window.harness.frames());
}

async function leave() {
  await page.mouse.move(1, 1);
  await page.evaluate(() => window.harness.frames());
}

beforeAll(async () => {
  const bundle = await build({
    entryPoints: [path.join(ROOT, 'src/index.ts')],
    absWorkingDir: ROOT,
    bundle: true,
    write: false,
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' },
    loader: { '.css': 'text', '.svg': 'text' },
    logLevel: 'error',
  });
  browser = await chromium.launch(
    process.env.WE_CHROME_PATH ? { executablePath: process.env.WE_CHROME_PATH } : { channel: 'chrome' },
  );
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.setContent(PAGE);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.addScriptTag({ content: HARNESS });
});

afterAll(async () => {
  await browser?.close();
});

describe('what a primitive adopts', () => {
  it('is all inside the named layers, for every primitive', async () => {
    // A rule outside every layer beats every layer, so one sheet adopted as written would override
    // every breakpoint and state on that component — silently, and only where someone looks.
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'custom-elements.json'), 'utf8')) as {
      modules: { declarations?: { tagName?: string }[] }[];
    };
    const tags = manifest.modules.flatMap((m) => (m.declarations ?? []).map((d) => d.tagName).filter(Boolean));
    expect(tags.length).toBeGreaterThan(40);

    const offenders: Record<string, string[]> = {};
    for (const tag of tags as string[]) {
      const found = await page.evaluate(([t, l]) => window.harness.outsideLayers(t, l), [
        tag,
        [...DS_LAYERS] as string[],
      ] as const);
      if (found.length > 0) offenders[tag] = found;
    }
    expect(offenders).toEqual({});
  });
});

describe('a state changes only what it names', () => {
  it("leaves a truncated label's white-space alone on hover", async () => {
    await mount('truncated', 'we-text', { attrs: { truncate: '' }, props: { hoverProps: { bg: 'rgb(1, 2, 3)' } } });
    expect(await read('truncated', 'white-space')).toBe('nowrap');
    await hover('truncated');
    await settled('truncated', 'background-color').toBe('rgb(1, 2, 3)');
    expect(await read('truncated', 'white-space')).toBe('nowrap');
    await leave();
  });

  it("keeps a breakpoint's display under the pointer, without flashing", async () => {
    const props = { display: 'none', mdUpProps: { display: 'inline' }, hoverProps: { color: 'rgb(9, 9, 9)' } };
    await mount('shown-at-md', 'we-text', { width: 1000, props });
    await mount('hidden-below-md', 'we-text', { width: 700, props });
    expect(await read('hidden-below-md', 'display')).toBe('none');
    expect(await read('shown-at-md', 'display')).toBe('inline');

    await hover('shown-at-md');
    // Hovered for certain before sampling, so a flash has something to show up in.
    await settled('shown-at-md', 'color').toBe('rgb(9, 9, 9)');
    const seen = await page.evaluate(() => window.harness.sample('shown-at-md', 'display'));
    expect(seen).toEqual(['inline']);
    await leave();
  });

  it("does not undo the component's own hover style", async () => {
    // `we-link` thickens its underline on hover in its own CSS. The DS hover rule used to reset it.
    await mount('link', 'we-link', { attrs: { href: '#' }, text: 'A link' });
    const resting = await read('link', 'text-decoration-thickness');
    await hover('link');
    await settled('link', 'text-decoration-thickness').toBe('2px');
    expect(resting).not.toBe('2px');
    await leave();
  });

  it('beats a breakpoint on a property both set', async () => {
    await mount('both', 'we-badge', {
      width: 1000,
      props: { mdUpProps: { bg: 'rgb(200, 0, 0)' }, hoverProps: { bg: 'rgb(0, 200, 0)' } },
      text: 'Badge',
    });
    expect(await read('both', 'background-color')).toBe('rgb(200, 0, 0)');
    await hover('both');
    await settled('both', 'background-color').toBe('rgb(0, 200, 0)');
    await leave();
  });
});

describe('two true states compose', () => {
  it('keeps the hover fill on a focused button, and the focus ring under the pointer', async () => {
    await mount('focused', 'we-button', {
      props: { hoverProps: { bg: 'rgb(0, 0, 200)' }, focusProps: { ring: '0 0 0 3px rgb(200, 0, 0)' } },
      text: 'Button',
    });
    await page.evaluate(() => window.harness.focus('focused'));
    await page.evaluate(() => window.harness.frames());
    await settled('focused', 'box-shadow').toContain('rgb(200, 0, 0)');
    await hover('focused');
    await settled('focused', 'background-color').toBe('rgb(0, 0, 200)');
    expect(await read('focused', 'box-shadow')).toContain('rgb(200, 0, 0)');
    await leave();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  });

  it('keeps the hover fill while pressed', async () => {
    await mount('pressed', 'we-badge', {
      props: { hoverProps: { bg: 'rgb(0, 120, 0)' }, activeProps: { opacity: 0.5 } },
      text: 'Badge',
    });
    await hover('pressed');
    await page.mouse.down();
    await page.evaluate(() => window.harness.frames());
    await settled('pressed', 'opacity').toBe('0.5');
    await settled('pressed', 'background-color').toBe('rgb(0, 120, 0)');
    await page.mouse.up();
    await leave();
  });
});

describe('what sits above the variant layers', () => {
  it("still draws an overlay's surface in each state", async () => {
    // OverlayElement's surface rules live in `we-overlay`, above every state: they replace how the DS
    // paints an overlay's fill, and must keep doing so under the pointer.
    const expected = (color: string) =>
      page.evaluate((c) => {
        const probe = document.createElement('div');
        probe.style.background = `color-mix(in srgb, ${c} 100%, transparent)`;
        document.body.append(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      }, color);
    await mount('overlay', 'we-modal', {
      props: { bg: 'rgb(10, 20, 30)', hoverProps: { bg: 'rgb(30, 20, 10)' }, hideclosebutton: true },
      text: 'Modal body',
    });
    expect(await read('overlay', 'background-color')).toBe(await expected('rgb(10, 20, 30)'));
    await hover('overlay');
    await settled('overlay', 'background-color').toBe(await expected('rgb(30, 20, 10)'));
    await leave();
    await page.evaluate(() => document.getElementById('overlay')?.remove());
  });

  it('lets a theme styling a part from outside keep winning', async () => {
    // Themes reach primitives through ::part() from the document, which outranks anything inside the
    // shadow root whatever layer it is in — the layers change nothing about that.
    await page.addStyleTag({ content: '.themed::part(base) { border-top-color: rgb(250, 0, 0); }' });
    await mount('themed', 'we-badge', {
      attrs: { class: 'themed' },
      props: { border: '2px solid rgb(0, 0, 250)', hoverProps: { border: '2px solid rgb(0, 250, 0)' } },
      text: 'Badge',
    });
    expect(await read('themed', 'border-top-color')).toBe('rgb(250, 0, 0)');
    await hover('themed');
    await settled('themed', 'border-bottom-color').toBe('rgb(0, 250, 0)');
    expect(await read('themed', 'border-top-color')).toBe('rgb(250, 0, 0)');
    await leave();
  });
});

describe('what used to be worked around', () => {
  it('keeps a fitted select at its fitted width, under the pointer and against a breakpoint', async () => {
    // Fitted by a stylesheet rule again. It was an inline width, because the hover rule used to
    // re-declare width and a fitted select jumped to full width under the pointer — and an inline
    // width also beat every breakpoint.
    const options = [
      { label: 'One', value: 'one' },
      { label: 'Two', value: 'two' },
    ];
    await mount('fitted', 'we-select', { width: 1000, attrs: { fit: '' }, props: { options, value: 'one' }, text: '' });
    const width = () => page.evaluate(() => document.getElementById('fitted')!.getBoundingClientRect().width);
    const fitted = await width();
    expect(fitted).toBeLessThan(400);
    await hover('fitted', 'input-wrapper');
    await expect.poll(width).toBe(fitted);
    await leave();

    await mount('fitted-wide-at-md', 'we-select', {
      width: 1000,
      attrs: { fit: '' },
      props: { options, value: 'one', mdUpProps: { width: '600px' } },
      text: '',
    });
    await expect
      .poll(() => page.evaluate(() => document.getElementById('fitted-wide-at-md')!.getBoundingClientRect().width))
      .toBe(600);
  });

  it("shows a pressed field its focus ring's edge, not the hover outline", async () => {
    // A field has no pressed state. It used to repeat hover's values in activeProps, which painted the
    // hover outline over the focus ring for as long as the button was held.
    await mount('field', 'we-input', { text: '' });
    await hover('field', 'input');
    await settled('field', 'border-top-color').toBe('rgb(150, 150, 150)');
    await page.mouse.down();
    await page.evaluate(() => window.harness.frames());
    const ring = 'rgb(0, 90, 200)';
    await settled('field', 'border-top-color').toBe(ring);
    await page.mouse.up();
    await settled('field', 'border-top-color').toBe(ring);
    await leave();
  });
});

describe('a breakpoint changes only what it names', () => {
  it('carries a smaller tier up through the wider ones', async () => {
    await mount('cascade', 'we-text', { width: 1300, props: { smUpProps: { color: 'rgb(0, 90, 0)' } } });
    expect(await read('cascade', 'color')).toBe('rgb(0, 90, 0)');
  });

  it("outranks the component's own attribute rule, which sits in the base layer", async () => {
    await mount('tier-over-component', 'we-text', {
      width: 1000,
      attrs: { truncate: '' },
      props: { mdUpProps: { whiteSpace: 'normal' } },
    });
    expect(await read('tier-over-component', 'white-space')).toBe('normal');
  });

  it("leaves a plain element's own styles untouched at every width", async () => {
    await mount('plain-wide', 'we-text', { width: 1300, attrs: { truncate: '' } });
    await mount('plain-narrow', 'we-text', { width: 400, attrs: { truncate: '' } });
    expect(await read('plain-wide', 'white-space')).toBe('nowrap');
    expect(await read('plain-narrow', 'white-space')).toBe('nowrap');
  });
});

declare global {
  interface Window {
    harness: {
      frames(): Promise<void>;
      mount(id: string, tag: string, options: Record<string, unknown>): Promise<void>;
      read(id: string, prop: string, part?: string): string;
      box(id: string, part?: string): { x: number; y: number; width: number; height: number };
      sample(id: string, prop: string, part?: string, frames?: number): Promise<string[]>;
      focus(id: string): void;
      outsideLayers(tag: string, layers: string[]): string[];
    };
  }
}
