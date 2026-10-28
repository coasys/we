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
 *
 * Environment:
 * - `WE_BROWSER_ONLY=<text>` — run only the cases whose file name contains it.
 * - `WE_BROWSER_SHOTS=<dir>` — let a case photograph the page (`screenshot(label)`); off otherwise.
 * - `WE_BROWSER_CPU=1` — profile each case and print where the time went.
 * - `WE_BROWSER_CHAIN`, `WE_BROWSER_MEASURE`, `WE_BROWSER_DUMP` — layout diagnostics; see below.
 * - `WE_CHROME`, `WE_BROWSER_PORT` — which browser, and where to serve.
 *
 * Headless Chrome draws no scrollbars, so nothing here can show a layout moving as one appears.
 */
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { solidPlugin } from 'esbuild-plugin-solid';
import { compile } from 'sass';
import { chromium } from 'playwright-core';
import { buildContentSecurityPolicy } from '@we/csp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const PORT = Number(process.env.WE_BROWSER_PORT ?? 8791);
const CHROME = process.env.WE_CHROME ?? '/usr/bin/google-chrome';

/** The production web policy, as the harness page's header. See the server below. */
const PAGE_POLICY = buildContentSecurityPolicy({ host: 'web', dev: false });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

/*
  Stylesheets a module imported for their effect, collected while bundling so the page can carry
  them — see `/imported.css` below.

  A component whose CSS lives beside it says so with a bare `import './styles.css'`, which Vite
  turns into a stylesheet the app loads and esbuild, bundling to one JS file, refuses outright. The
  reachable set grows on its own: nothing here renders a graph, and `GraphHost`'s stylesheet is in
  this list because a store two imports away now asks the platform a question. Dropping them to
  keep the bundle quiet is the one option ruled out — this harness is believed about pixels, and
  the comments below record two occasions when a missing stylesheet was reported as an app bug.
*/
const imported = new Set();

/** Vite's `?raw`: a stylesheet read as text rather than applied. The theme registry holds themes this way. */
const cssPlugin = {
  name: 'we-stylesheets',
  setup(build) {
    build.onLoad({ filter: /\.css\?raw$/ }, async (args) => ({
      contents: await readFile(args.path.replace(/\?raw$/, ''), 'utf8'),
      loader: 'text',
    }));
    build.onLoad({ filter: /\.css$/ }, (args) => {
      imported.add(args.path);
      return { contents: '', loader: 'js' };
    });
  },
};

/** Bundle the page entry, resolving the workspace aliases the app itself uses. */
async function bundle() {
  const out = await build({
    /*
      Solid's own compiler for TSX. Without it esbuild compiles JSX for React, and the packages that
      ship as source — the editor, the app shell's own components — render nothing but a reference to
      a `React` that is not there. Everything that already worked here came from built packages.
    */
    plugins: [cssPlugin, solidPlugin()],
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

  /*
    And the components' own stylesheet, for the same reason one step up.

    A layer-4 component carries CSS a schema cannot express — a rating's filled half is an
    absolutely positioned overlay clipped to a fraction — and without it that overlay falls back
    into the flow and stacks. The harness measured a five-star control as twice its height and
    reported it as a control that did not line up with its own name, which is a bug in the harness
    wearing the clothes of a bug in the app.
  */
  const components = await readFile(
    join(ROOT, 'packages/design-system/4-components/dist/styles/index.css'),
    'utf8',
  ).catch(() => '');

  /*
    And every stylesheet the bundle imported for its effect, in the order the modules asked for
    them — which is the order Vite would have emitted them in, and after the two above for the
    same reason a component's own CSS loads after the app's base rules.
  */
  const importedCss = (await Promise.all([...imported].map((file) => readFile(file, 'utf8').catch(() => '')))).join(
    '\n',
  );

  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    const send = (body, type) => res.writeHead(200, { 'content-type': type }).end(body);
    /*
      The page carries the policy a shipped web build serves, so every case is also a check that the
      renderer and the design system still work under it. Chrome reports anything the policy refuses
      as a console error, which the run already collects and fails on — a blocked stylesheet or icon
      cannot pass quietly here as it would in jsdom, which enforces no policy at all.
    */
    if (url === '/' || url === '/index.html') {
      return res.writeHead(200, { 'content-type': MIME['.html'], 'content-security-policy': PAGE_POLICY }).end(html);
    }
    if (url === '/imported.css') return send(importedCss, MIME['.css']);
    if (url === '/shell.css') return send(shell, MIME['.css']);
    if (url === '/components.css') return send(components, MIME['.css']);
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

  // `WE_BROWSER_ONLY=themeLab` runs the cases whose file name contains it, for iterating on one.
  const only = process.env.WE_BROWSER_ONLY;
  const files = (await readdir(join(HERE, 'cases'))).filter((f) => f.endsWith('.mjs') && (!only || f.includes(only)));
  let failures = 0;
  for (const file of files) {
    const mod = await import(join(HERE, 'cases', file));
    /*
      The second sweep axis, beside width.

      Width asks "does this layout hold when the panel is narrow"; scale asks "does this still hold
      when there is a lot of it". They are the two questions a surface fails at, and a case declares
      whichever it is about — a case with no `scales` sweeps `[undefined]`, so every layout case
      written before this axis existed runs exactly as it did.

      Flattened into one list rather than nested, so the body below is unchanged: a perf axis is not
      worth re-indenting every layout assertion in the suite for.
    */
    const combos = [];
    for (const scale of mod.scales ?? [undefined]) for (const w of mod.widths ?? [320]) combos.push([scale, w]);

    for (const [scale, width] of combos) {
      // The pointer parked away from the mount, so a case never inherits a hover from whatever the
      // last one pressed: a soft button under it draws its hover fill, not its own.
      const viewport = page.viewportSize();
      if (viewport) await page.mouse.move(viewport.width - 1, viewport.height - 1);
      await page.evaluate(([s, w, n]) => window.__harness.mount(s, w, n), [mod.scenario, width, scale]);
      // One frame for the primitives to upgrade and lay out.
      await page.waitForTimeout(250);
      /** Lines a case wants printed under its label — a measurement is a report, not a verdict. */
      const notes = [];
      const api = {
        measure: (sel) => page.evaluate((s) => window.__harness.measure(s), sel),
        measureAll: (sel) => page.evaluate((s) => window.__harness.measureAll(s), sel),
        scrollers: (sel) => page.evaluate((s) => window.__harness.scrollers(s), sel),
        measurePart: (sel, part, nth) => page.evaluate((a) => window.__harness.measurePart(...a), [sel, part, nth]),
        measureParts: (sel, part, nth) => page.evaluate((a) => window.__harness.measureParts(...a), [sel, part, nth]),
        prop: (sel, name, nth) => page.evaluate((a) => window.__harness.prop(...a), [sel, name, nth]),
        /** A real press at a point on the page, for a control that answers by where it is pressed. */
        pressAt: async (x, y) => {
          await page.mouse.click(x, y);
          await page.waitForTimeout(120);
        },
        measureControl: (label, sel) => page.evaluate((a) => window.__harness.measureControl(...a), [label, sel]),
        measureText: (text, sel) => page.evaluate((a) => window.__harness.measureText(...a), [text, sel]),
        pageColor: () => page.evaluate(() => window.__harness.pageColor()),
        partStyle: (sel, property, part, nth) =>
          page.evaluate((a) => window.__harness.partStyle(...a), [sel, property, part, nth]),
        roleColor: (role) => page.evaluate((r) => window.__harness.roleColor(r), role),
        probeColor: (value) => page.evaluate((v) => window.__harness.probeColor(v), value),
        focused: () => page.evaluate(() => window.__harness.focused()),
        /*
          A picture of the page, for a case whose subject is how something looks — written only when
          `WE_BROWSER_SHOTS` names a directory, so an ordinary run stays a check rather than a camera.
        */
        screenshot: async (label) => {
          const dir = process.env.WE_BROWSER_SHOTS;
          if (!dir) return;
          // The app's base rules hold the document to the viewport, so a full-page shot stops at the
          // fold. Grow the viewport to the mount for the shot, then put it back.
          const before = page.viewportSize();
          const height = await page.evaluate(() => document.getElementById('mount').scrollHeight);
          await page.setViewportSize({ width: Math.max(before.width, width), height: Math.ceil(height) });
          await page.waitForTimeout(150);
          await page.screenshot({ path: join(dir, `${label}-${width}.png`) });
          await page.setViewportSize(before);
        },
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
        /*
          Put a scroller somewhere, and report where it actually landed.

          Clamping is the point as much as the move: asking for a position past either end and
          reading back what the browser allowed is how a case discovers the scroll RANGE, which is
          not otherwise inspectable — and under `flex-direction: column-reverse` the range does not
          start at zero, which is exactly the sort of thing worth measuring rather than assuming.
        */
        scrollTo: (sel, top) =>
          page.evaluate(
            ([s, t]) => {
              const host = document.querySelector(s);
              const el = host?.shadowRoot?.querySelector("[part='base']") ?? host;
              if (!el) return null;
              el.scrollTop = t;
              return Math.round(el.scrollTop);
            },
            [sel, top],
          ),
        html: () => page.evaluate(() => window.__harness.html()),
        // Some states are only reachable by using the thing — a folded branch, an opened row. A
        // case that cannot press anything can only ever judge a first paint.
        click: async (sel) => {
          // Seconds, not Playwright's default half-minute. A selector that matches nothing is a
          // case's own mistake or the very absence it is testing for, and both want saying quickly.
          await page.click(sel, { timeout: 3000 });
          await page.waitForTimeout(120);
        },
        // Replace what a field holds, as typing would: a form's state follows its input events.
        type: async (sel, text) => {
          await page.locator(sel).first().fill(text, { timeout: 3000 });
          await page.waitForTimeout(120);
        },
        /*
          Drag across something, left to right, as a fraction of its own width.

          The gesture a growing number of these controls ARE: a slider, a rating dragged across its
          stars. A click cannot stand in for it, and the difference is not cosmetic — a real drag is
          `pointerdown > input… > pointerup > change`, and that ORDER is what one of these controls
          committed twice over. A case that can only click can only ever judge a first paint of a
          thing whose whole behaviour is in the moving.
        */
        drag: async (sel, from = 0.1, to = 0.8) => {
          // The VISIBLE one. A compact row keeps its real controls inside closed popovers, so the
          // first match is routinely a thing with no box — and "cannot be dragged" is the correct
          // answer for something nobody can see, not a selector to work around.
          const box = await page.locator(sel).locator('visible=true').first().boundingBox({ timeout: 3000 });
          if (!box) throw new Error(`nothing to drag at ${sel}`);
          const y = box.y + box.height / 2;
          await page.mouse.move(box.x + box.width * from, y);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * to, y, { steps: 6 });
          await page.mouse.up();
          await page.waitForTimeout(150);
        },
        /*
          The same gesture, stopped halfway: pressed and moved, still held.

          What separates "the popover closed when I pressed" from "the popover closed when I let
          go" — one is the bug and the other is the behaviour. A helper that always releases cannot
          tell them apart, and the difference is the whole of what a reader experiences.
        */
        grab: async (sel, from = 0.1, to = 0.8) => {
          const box = await page.locator(sel).locator('visible=true').first().boundingBox({ timeout: 3000 });
          if (!box) throw new Error(`nothing to grab at ${sel}`);
          const y = box.y + box.height / 2;
          await page.mouse.move(box.x + box.width * from, y);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * to, y, { steps: 6 });
          await page.waitForTimeout(80);
        },
        /** Let go of whatever `grab` is holding. */
        release: async () => {
          await page.mouse.up();
          await page.waitForTimeout(150);
        },
        /** What a page-level listener recorded — for counting what a gesture actually emitted. */
        recorded: (key) => page.evaluate((k) => globalThis[k] ?? [], key),
        /*
          A press and a move at an element's middle, by coordinates. Playwright's own click refuses an
          element that takes no pointer — the point, for a case about an editor that makes them so.
        */
        // `hold` is a key held through the press — a modifier, the way a person reaches for one.
        clickAt: async (sel, { hold } = {}) => {
          const b = await page.locator(sel).first().boundingBox();
          if (hold) await page.keyboard.down(hold);
          await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
          if (hold) await page.keyboard.up(hold);
          // Past the editor's 200 ms hold, so a press that wrongly became a drag would show it.
          await page.waitForTimeout(300);
        },
        moveTo: async (sel, { hold } = {}) => {
          const b = await page.locator(sel).first().boundingBox();
          if (hold) await page.keyboard.down(hold);
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
          await page.waitForTimeout(100);
        },
        /** A key pressed and left down, or let go — a modifier changing what the pointer would do. */
        keyDown: async (name) => {
          await page.keyboard.down(name);
          await page.waitForTimeout(50);
        },
        keyUp: async (name) => {
          await page.keyboard.up(name);
          await page.waitForTimeout(50);
        },
        /** A key pressed on whatever has focus, the way a person would. */
        key: async (name) => {
          await page.keyboard.press(name);
          await page.waitForTimeout(50);
        },
        /** The cursor the page shows at an element's middle. */
        cursorAt: (sel) =>
          page.evaluate((s) => {
            const r = document.querySelector(s).getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return hit ? getComputedStyle(hit).cursor : '';
          }, sel),
        /** Run one of the page's own setups by name — for a case whose subject is not a schema. */
        call: (fn, ...args) => page.evaluate(([n, a]) => window.__harness[n](...a), [fn, args]),

        // ── Performance ────────────────────────────────────────────────────
        /*
          What an interaction cost. See `instrument.ts` for what the numbers are and are not.

          The interaction is named rather than passed, because it has to run INSIDE the page: a
          Playwright callback would be a round trip per step and would time the protocol rather than
          the app. So a case says `profile('resize', [320, 520])` and the page does the rest.
        */
        profile: (action, args = []) =>
          page.evaluate(
            ([a, rest]) => {
              const h = window.__harness;
              const run = {
                resize: () => h.resizeMount(...rest),
                addRow: () => h.addRow(...rest),
                addProfile: () => h.addProfile(...rest),
                // Nothing at all, for the same number of frames — the baseline every other figure
                // is read against. See `idleFrames` for why it has to match the shape of what it is
                // compared with rather than being a single frame.
                idle: () => h.idleFrames(...rest),
              }[a];
              if (!run) throw new Error(`no profiled action "${a}"`);
              return h.profile(run);
            },
            [action, args],
          ),
        /**
         * A line printed under the case, whatever the verdict.
         *
         * Measurements are reported and assertions are separate, deliberately: a wall-clock figure
         * from one machine must never decide whether a suite passes, and a suite that prints nothing
         * when it passes cannot be used to watch a number move.
         */
        note: (text) => notes.push(text),
        /** Run a function in the page, for a probe no helper covers. */
        evaluate: (fn, arg) => page.evaluate(fn, arg),
        themePanel: async (overrides) => {
          await page.evaluate((o) => window.__harness.themePanelProbe(o), overrides);
          await page.waitForTimeout(300);
        },
        themeDrag: (steps, roots, live) => page.evaluate((a) => window.__harness.themeDrag(...a), [steps, roots, live]),
        /**
         * Collect an event's `detail` under `key`, listening at the document.
         *
         * At the document rather than on the element, because these events are `composed` and
         * bubble — so this catches them wherever they were raised, including inside a shadow root,
         * and does not have to name the same node the gesture happened to reach.
         */
        record: (type, key) =>
          page.evaluate(
            ([t, k]) => {
              globalThis[k] = [];
              document.addEventListener(t, (e) => globalThis[k].push(e.detail));
            },
            [type, key],
          ),
      };
      const cdp = process.env.WE_BROWSER_CPU ? await page.context().newCDPSession(page) : undefined;
      if (cdp) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.start');
      }
      const problems = (await mod.check(api, width, scale)) ?? [];
      if (cdp) {
        const { profile } = await cdp.send('Profiler.stop');
        const self = new Map();
        const dt = profile.timeDeltas;
        const byId = new Map(profile.nodes.map((n) => [n.id, n]));
        profile.samples.forEach((id, i) => {
          const n = byId.get(id);
          const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
          self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
        });
        const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
        for (const [k, ms] of top) console.log(`      ${Math.round(ms)} ms  ${k}`);
      }
      const label = scale === undefined ? `${mod.name} @ ${width}px` : `${mod.name} @ ${width}px n=${scale}`;
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
      // After the verdict either way: a measurement is worth reading when the case passes, which is
      // most of the time and is exactly when a number quietly drifting would otherwise go unseen.
      for (const n of notes) console.log(`      ${n}`);
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
