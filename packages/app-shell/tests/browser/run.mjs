#!/usr/bin/env node
/**
 * The runner: bundle, serve, drive Chrome, report.
 *
 * Deliberately not a second test framework. Cases are plain modules exporting a scenario, the
 * widths to sweep and a `check` that returns problems; this mounts each combination and prints what
 * came back. Keeping it small is what keeps it worth having — the jsdom suite stays the place for
 * everything that is not about layout.
 *
 * Drives the browser already on the machine rather than downloading one, so `playwright-core` is
 * the whole dependency.
 */
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'sass';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const PORT = Number(process.env.WE_BROWSER_PORT ?? 8791);
const CHROME = process.env.WE_CHROME ?? '/usr/bin/google-chrome';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

/** Bundle the page entry, resolving the workspace aliases the app itself uses. */
async function bundle() {
  const out = await build({
    entryPoints: [join(HERE, 'entry.ts')],
    bundle: true,
    format: 'esm',
    write: false,
    sourcemap: 'inline',
    logLevel: 'error',
    conditions: ['browser', 'import'],
    // Vite supplies this at build time and esbuild does not; a dev build is what the app runs as.
    define: { 'import.meta.env': JSON.stringify({ DEV: true, PROD: false, MODE: 'development', SSR: false }) },
    // Layout is the subject, so an image or a model is an import to satisfy, not a byte to serve.
    loader: Object.fromEntries(
      ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.glb', '.gltf', '.mp4', '.woff', '.woff2'].map((e) => [
        e,
        'empty',
      ]),
    ),
    alias: {
      '@solid': join(ROOT, 'packages/app-shell/src/frameworks/solid'),
      '@shared': join(ROOT, 'packages/app-shell/src/shared'),
    },
  });
  return out.outputFiles[0].text;
}

async function main() {
  const js = await bundle();
  const html = await readFile(join(HERE, 'index.html'), 'utf8');
  /*
    The tokens package's index.css is an `@import` manifest, so serving its text alone gives a page
    with no tokens at all and a set of 404s to explain it. Its whole directory is mounted instead,
    which also carries the fonts the imports reach for — and a missing space token is a wrong gap,
    which is exactly the kind of measurement this harness exists to make.
  */
  const DIRS = {
    '/tokens/': join(ROOT, 'packages/design-system/1-tokens/dist/css'),
    '/themes/': join(ROOT, 'packages/design-system/2-themes/dist'),
  };

  /*
    The app's own global stylesheet, compiled rather than restated.

    It is three rules and one of them is `* { box-sizing: border-box }`, which decides whether a
    padded box is its stated width or that width plus its padding — so without it every measurement
    of anything with padding is wrong, and wrong in the direction that invents overflow. The
    harness read a composer as 41px wider than the panel it was in until this was loaded, which is
    a bug in the harness reported as a bug in the app: the worst kind for a tool whose whole job is
    to be believed.
  */
  const shell = compile(join(ROOT, 'packages/app-shell/src/shared/index.scss')).css;

  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    const send = (body, type) => res.writeHead(200, { 'content-type': type }).end(body);
    if (url === '/' || url === '/index.html') return send(html, MIME['.html']);
    if (url === '/shell.css') return send(shell, MIME['.css']);
    if (url === '/entry.bundle.js') return send(js, MIME['.js']);
    for (const [prefix, dir] of Object.entries(DIRS)) {
      if (!url.startsWith(prefix)) continue;
      // Resolved under the mount, so a path climbing out of it cannot reach the rest of the repo.
      const file = resolve(dir, '.' + url.slice(prefix.length - 1));
      if (!file.startsWith(dir)) break;
      readFile(file)
        .then((body) => send(body, MIME[extname(file)] ?? 'application/octet-stream'))
        .catch(() => res.writeHead(404).end('not found'));
      return;
    }
    res.writeHead(404).end('not found');
  });
  await new Promise((r) => server.listen(PORT, r));

  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.stack ?? String(e)));
  page.on('console', (m) => {
    // A missing resource is reported by the page as a bare "Failed to load resource"; the URL is on
    // the response, so 404s are collected there instead and this would only duplicate them.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) pageErrors.push(m.text());
  });
  const missing = new Set();
  page.on('response', (r) => {
    if (r.status() === 404) missing.add(new URL(r.url()).pathname);
  });
  await page.goto(`http://localhost:${PORT}/`);
  try {
    await page.waitForFunction(() => Boolean(window.__harness), null, { timeout: 15000 });
  } catch (e) {
    // A page that never installed the harness failed while loading; its own errors say why.
    console.log(pageErrors.join('\n') || String(e));
    await browser.close();
    server.close();
    process.exit(1);
  }

  const files = (await readdir(join(HERE, 'cases'))).filter((f) => f.endsWith('.mjs'));
  let failures = 0;
  for (const file of files) {
    const mod = await import(join(HERE, 'cases', file));
    for (const width of mod.widths ?? [320]) {
      await page.evaluate(([s, w]) => window.__harness.mount(s, w), [mod.scenario, width]);
      // One frame for the primitives to upgrade and lay out.
      await page.waitForTimeout(250);
      const api = {
        measure: (sel) => page.evaluate((s) => window.__harness.measure(s), sel),
        measureAll: (sel) => page.evaluate((s) => window.__harness.measureAll(s), sel),
        measurePart: (sel, part) => page.evaluate((a) => window.__harness.measurePart(...a), [sel, part]),
        measureControl: (label, sel) => page.evaluate((a) => window.__harness.measureControl(...a), [label, sel]),
        measureText: (text, sel) => page.evaluate((a) => window.__harness.measureText(...a), [text, sel]),
        pageColor: () => page.evaluate(() => window.__harness.pageColor()),
        focused: () => page.evaluate(() => window.__harness.focused()),
        // A state a case can put the page into. `hoverProps` is a whole code path — the values move
        // out of the inline style into custom properties for a stylesheet to resolve — so a case
        // that never hovers is not testing it.
        // `nth` because a control can be several elements that share a name — a fold is a caret and
        // a line, and which of them answers the pointer is exactly the sort of thing worth asking.
        hover: (sel, nth = 0) => page.locator(sel).nth(nth).hover({ timeout: 3000 }),
        /*
          How many of something there are, through Playwright's own engine rather than the page's.

          `measureAll` runs `querySelectorAll` inside the document, which does not cross a shadow
          boundary — so it cannot see anything a primitive renders internally, and an `aria-label` is
          exactly that: `we-button` puts it on the inner `<button>` rather than reflecting it to the
          host. Playwright's CSS engine pierces open shadow roots, so a case can count and press the
          thing a screen reader would name.
        */
        count: (sel) => page.locator(sel).count(),
        // Some states are only reachable by using the thing — a folded branch, an opened row. A
        // case that cannot press anything can only ever judge a first paint.
        click: async (sel) => {
          // Seconds, not Playwright's default half-minute. A selector that matches nothing is a
          // case's own mistake or the very absence it is testing for, and both want saying quickly.
          await page.click(sel, { timeout: 3000 });
          await page.waitForTimeout(120);
        },
      };
      const problems = (await mod.check(api, width)) ?? [];
      const label = `${mod.name} @ ${width}px`;
      if (process.env.WE_BROWSER_CHAIN) {
        const rows = await page.evaluate((t) => window.__harness.chain(t), process.env.WE_BROWSER_CHAIN);
        console.log(`  chain above "${process.env.WE_BROWSER_CHAIN}" at ${width}px:`);
        for (const r of rows) console.log(`      ${r.tag} ${r.w}x${r.h} @${r.x},${r.y} — [${r.kids.join(', ')}]`);
      }
      if (process.env.WE_BROWSER_MEASURE) {
        const rows = await api.measureAll(process.env.WE_BROWSER_MEASURE);
        console.log(`  ${process.env.WE_BROWSER_MEASURE} at ${width}px:`);
        for (const r of rows)
          console.log(`      ${r.w}x${r.h} @${r.x},${r.y} ${r.display} font=${r.fontSize}/${r.lineHeight} "${r.text}"`);
      }
      if (process.env.WE_BROWSER_DUMP && problems.length) {
        console.log(await page.evaluate(() => window.__harness.html()));
      }
      if (problems.length) {
        failures += problems.length;
        console.log(`  ✗ ${label}`);
        for (const p of problems) console.log(`      ${p}`);
      } else {
        console.log(`  ✓ ${label}`);
      }
    }
  }

  if (pageErrors.length) {
    failures += pageErrors.length;
    console.log('\n  page errors:');
    for (const e of pageErrors) console.log(`      ${e}`);
  }
  // Not a failure: a font or an icon sprite the page never needed for a layout measurement. Worth
  // printing, because a 404 on the interop stylesheet would explain every assertion at once.
  if (missing.size) console.log(`\n  not served: ${[...missing].join(', ')}`);

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} problem(s)` : '\nall good');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
