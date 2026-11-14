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
 * Custom properties compute to their own (fully var()-substituted) token stream — `1rem` stays
 * `1rem`, an `oklch(…)` stays an `oklch(…)` — so each var is additionally normalised through the
 * real property its value belongs to, decided by the value itself rather than the name:
 *
 * - `CSS.supports('color', raw)` → a colour: probed through `color: var(--x)`, which computes to
 *   the serialised colour (`oklch(…)`/`rgb(…)`/…) a Rust renderer can compare without a CSS engine.
 * - `CSS.supports('scroll-margin-left', raw)` → a length (that property takes `<length>` only — no
 *   `%`, keywords or numbers): probed to its `"<n>px"` resolution, `rem`/`em`/`calc()` included.
 * - `CSS.supports('scale', raw)` on a `%`-free value → a number: probed so number calcs come out
 *   evaluated (`calc(0.4 * 2)` → `0.6`-style). `%` is excluded first because `scale` accepts it —
 *   `50%` is a ratio, not `0.5`, in every family that uses it.
 * - anything else keeps its computed text: shadows, gradients, font stacks, `150ms`, `ease-out`.
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
  computed() {
    const cs = getComputedStyle(document.documentElement);
    // Every --we-* custom property that applies to the element — iterating the computed style
    // sees inline theme vars, :root rules and @imports alike; a stylesheet walk misses rules that
    // carry a nested cssRules (every style rule does) and vars declared only for other selectors.
    const names = [];
    for (let i = 0; i < cs.length; i++) {
      const p = cs.item(i);
      if (p.startsWith('--we-')) names.push(p);
    }
    names.sort();
    // The probe lives under a wrapper carrying a sentinel colour: a colour-declared var(--x) that
    // is not a colour is invalid at computed-value time, computes to unset, inherits the sentinel.
    const wrap = document.createElement('div');
    wrap.style.setProperty('color', 'rgb(1, 2, 3)');
    const probe = document.createElement('div');
    wrap.appendChild(probe);
    document.body.appendChild(wrap);
    const pcs = getComputedStyle(probe);
    const probeValue = (prop, name) => {
      probe.style.setProperty(prop, 'var(' + name + ')');
      const v = pcs.getPropertyValue(prop).trim();
      probe.style.removeProperty(prop);
      return v;
    };
    const out = {};
    for (const name of names) {
      const raw = cs.getPropertyValue(name).trim();
      if (CSS.supports('color', raw)) {
        const c = probeValue('color', name);
        out[name] = c !== 'rgb(1, 2, 3)' ? c : raw;
      } else if (CSS.supports('scroll-margin-left', raw)) {
        out[name] = probeValue('scroll-margin-left', name);
      } else if (!raw.includes('%') && CSS.supports('scale', raw)) {
        out[name] = probeValue('scale', name);
      } else {
        out[name] = raw;
      }
    }
    wrap.remove();
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
