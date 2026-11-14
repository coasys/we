/**
 * `pnpm record:tokens` — record `vectors/tokens/<theme>.json`: every `--we-*` custom property on
 * `document.documentElement` with its browser-computed value, for each of the six themes the
 * vectors cover (the five THEME_PRESETS plus the bundle's `glow`).
 *
 * ## Why a browser
 *
 * Theme values are CSS: `--we-color-accent-50: oklch(var(--we-color-lightness-50) calc(…))` — and
 * `applyThemeVars` derives role variables by writing vars and reading the computed result back.
 * Only a real layout engine can answer `getComputedStyle(document.documentElement)`, so this runs
 * the same way `tests/browser` and `we-render` do: an esbuild bundle + a tiny HTTP server + the
 * installed Chrome driven by playwright-core (`WE_CHROME` overrides the binary).
 *
 * Custom properties compute to their own token stream, not to resolved colours — so anything
 * that quacks like a colour is additionally probed: `color` set to `var(--x)` on a probe element
 * computes to `rgb()`/`rgba()`, which is the form a Rust renderer can compare without a CSS engine.
 *
 * NOT part of `pnpm test`: there is no browser in the vitest run. vectors.test.ts only checks the
 * files exist, parse, and agree with style.json's computed values.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { THEME_PRESETS } from '@we/themes/presets';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const VECTORS = join(HERE, '..', 'vectors', 'tokens');
const PORT = Number(process.env.WE_TOKEN_PORT ?? 8797);
const CHROME = process.env.WE_CHROME ?? '/usr/bin/google-chrome';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
};

/**
 * The page entry: expose the theme pipeline and a computed-var reader. applyThemeVars is reached
 * through @we/schema-shared exactly as the app shell's browser harness does.
 */
const ENTRY = `
import { applyThemeVars, clearThemeVars } from '@we/schema-shared';
window.__tokens = {
  apply(overrides: any, baseName: string) {
    clearThemeVars(document.documentElement);
    document.documentElement.setAttribute('data-we-theme', baseName);
    applyThemeVars(document.documentElement, overrides);
  },
  names() {
    const names = new Set();
    const walk = (rule) => {
      if ('cssRules' in rule && rule.cssRules) for (const r of rule.cssRules) walk(r);
      else if (rule.style) for (let i = 0; i < rule.style.length; i++) {
        const p = rule.style.item(i);
        if (p.startsWith('--we-')) names.add(p);
      }
    };
    for (const sheet of document.styleSheets) { try { for (const r of sheet.cssRules) walk(r); } catch {} }
    const st = document.documentElement.style;
    for (let i = 0; i < st.length; i++) { const p = st.item(i); if (p.startsWith('--we-')) names.add(p); }
    return [...names].sort();
  },
  computed() {
    const cs = getComputedStyle(document.documentElement);
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const pcs = getComputedStyle(probe);
    const out = {};
    for (const name of window.__tokens.names()) {
      const raw = cs.getPropertyValue(name).trim();
      // Colour probe: var() as a real colour property computes to rgb()/rgba(); anything else
      // leaves the sentinel, which says the var is not a colour and its own text stands.
      probe.style.setProperty('color', 'rgb(1, 2, 3)');
      probe.style.setProperty('color', 'var(' + name + ')');
      const c = pcs.getPropertyValue('color').trim();
      out[name] = c !== 'rgb(1, 2, 3)' ? c : raw;
    }
    probe.remove();
    return out;
  },
};
`;

interface ThemeJob {
  id: string;
  baseName: string;
  overrides: Record<string, unknown>;
}

/** The harness `ENTRY` installs on `window`. */
interface TokenHarness {
  apply(overrides: Record<string, unknown>, baseName: string): void;
  names(): string[];
  computed(): Record<string, string>;
}
declare const window: { __tokens?: TokenHarness } & Window;

async function main() {
  const jobs: ThemeJob[] = [];
  const presetNames = new Set(Object.keys(THEME_PRESETS));
  for (const [id, preset] of Object.entries(THEME_PRESETS) as [string, { parameters?: Record<string, unknown> }][]) {
    jobs.push({ id, baseName: id, overrides: preset.parameters ?? {} });
  }
  // The bundle's glow theme: same apply path as applyThemeToDOM — themeName or id when they name a
  // preset, 'light' otherwise.
  const bundle = JSON.parse(readFileSync(join(ROOT, 'bundles', 'coasys.bundle.json'), 'utf8')) as {
    themes?: { id: string; overrides?: Record<string, unknown> }[];
  };
  const glow = bundle.themes?.find((t) => t.id === 'glow');
  if (glow?.overrides) {
    const tn = glow.overrides.themeName as string | undefined;
    const baseName = tn && presetNames.has(tn) ? tn : presetNames.has(glow.id) ? glow.id : 'light';
    jobs.push({ id: 'glow', baseName, overrides: glow.overrides });
  }

  const bundleJs = (
    await build({
      stdin: { contents: ENTRY, loader: 'ts', resolveDir: HERE },
      bundle: true,
      format: 'iife',
      write: false,
      logLevel: 'error',
      conditions: ['browser', 'import'],
    })
  ).outputFiles[0].text;

  const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/tokens/index.css"><link rel="stylesheet" href="/themes/index.css">
<style>body{margin:0}</style></head><body><script>${bundleJs.replace(/<\/script/g, '<\\/script')}<\/script></body></html>`;

  const DIRS = {
    '/tokens/': join(ROOT, 'packages/design-system/1-tokens/dist/css'),
    '/themes/': join(ROOT, 'packages/design-system/2-themes/dist'),
  };
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      return res.writeHead(200, { 'content-type': 'text/html' }).end(html);
    }
    for (const [prefix, dir] of Object.entries(DIRS)) {
      if (!url.startsWith(prefix)) continue;
      const file = resolve(dir, '.' + url.slice(prefix.length - 1));
      if (!file.startsWith(dir)) break;
      try {
        const body = readFileSync(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
      return;
    }
    res.writeHead(404).end('not found');
  });
  await new Promise<void>((r) => server.listen(PORT, () => r()));

  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => Boolean(window.__tokens), null, { timeout: 15000 });
    mkdirSync(VECTORS, { recursive: true });
    for (const job of jobs) {
      await page.evaluate(([overrides, baseName]) => window.__tokens!.apply(overrides, baseName), [
        job.overrides,
        job.baseName,
      ] as const);
      // Two frames: applyThemeVars reads roles back inside a transition guard — let it settle.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const vars = await page.evaluate(() => window.__tokens!.computed());
      writeFileSync(join(VECTORS, `${job.id}.json`), JSON.stringify({ theme: job.id, vars }, null, 2) + '\n');
      console.info(`wrote vectors/tokens/${job.id}.json (${Object.keys(vars).length} vars)`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
