/**
 * Render a fixture and photograph it.
 *
 * ```sh
 * pnpm --filter @we/app-preview shoot                          # every fixture, default viewport
 * pnpm --filter @we/app-preview shoot -- --fixture discord
 * pnpm --filter @we/app-preview shoot -- --fixture discord --width 1280 --clip '[part="base"]'
 * pnpm --filter @we/app-preview shoot -- --target ~/discord.png --fixture discord
 * ```
 *
 * ## Why a script rather than an MCP browser server
 *
 * This is committed, so a render is reproducible by anyone and can grow into a visual-regression
 * suite (Vitest browser mode wraps it, once the templates are worth freezing). A server would be
 * neither. It also runs against the Chrome already on the machine — `channel: 'chrome'`, so
 * `playwright-core` downloads nothing.
 *
 * ## Why there is no similarity score
 *
 * The obvious loop is "diff the render against the target, iterate until the score clears a
 * threshold". That is right for cloning a *page*, where the two should converge to identical pixels.
 * It is wrong here: these templates render arbitrary community content in a platform's *shape*, so
 * the target screenshot has different names, different messages, a different number of rows. A pixel
 * diff against it is dominated by content, sits at some large constant, and barely moves as the
 * layout improves — so it cannot drive anything, and optimising it would push toward matching
 * content, which means nothing.
 *
 * What the target *is* good for is measurement, and `--target` does two things with it that beat
 * looking: it samples the dominant colours to real hex, and it composites target beside render into
 * one image, which is far easier to judge than two files. Both run in the page on a canvas, because
 * the browser is already an image library and the box has neither ImageMagick nor `sharp`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, '../shots');

function parseArgs(argv) {
  const args = { width: 1440, height: 900, scale: 2, wait: 1500 };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inlineValue] = argv[i].split('=');
    const value = inlineValue ?? argv[i + 1];
    const consume = () => {
      if (inlineValue === undefined) i += 1;
      return value;
    };
    if (flag === '--fixture') args.fixture = consume();
    else if (flag === '--width') args.width = Number(consume());
    else if (flag === '--height') args.height = Number(consume());
    else if (flag === '--scale') args.scale = Number(consume());
    else if (flag === '--wait') args.wait = Number(consume());
    else if (flag === '--clip') args.clip = consume();
    else if (flag === '--target') args.target = consume();
    else if (flag === '--base') args.base = consume();
    else if (flag === '--full') args.full = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const base = args.base ?? 'http://localhost:3101';

/**
 * Deviceless pixel ratio 2 by default: text rendered at 1× is too soft to judge letterforms or
 * spacing from, which is most of what a theme is.
 */
const browser = await chromium.launch({ channel: 'chrome' });

async function shoot(fixtureId) {
  const page = await browser.newPage({
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: args.scale,
  });

  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  const url = `${base}/?fixture=${encodeURIComponent(fixtureId)}`;
  await page.goto(url, { waitUntil: 'networkidle' });

  // The host publishes what it applied; waiting on that rather than a bare timeout means a slow
  // boot fails as a timeout here instead of silently photographing a landing page.
  await page.waitForFunction(() => window.__wePreview !== undefined, { timeout: 20_000 });
  const info = await page.evaluate(() => window.__wePreview);

  // `PreviewBootstrap` selects the dataset and navigates after boot; both are async, and presence
  // needs one beat (see the seeded-presence interval) before the roster fills.
  await page.waitForTimeout(args.wait);

  await mkdir(OUT_DIR, { recursive: true });
  const stem = `${fixtureId}-${args.width}`;
  const shotPath = resolve(OUT_DIR, `${stem}.png`);

  const subject = args.clip ? page.locator(args.clip).first() : page;
  await subject.screenshot({ path: shotPath, ...(args.clip ? {} : { fullPage: Boolean(args.full) }) });

  const report = { fixture: fixtureId, url, path: shotPath, template: info?.templateId, route: info?.path };

  if (args.target) {
    const targetPath = resolve(process.cwd(), args.target);
    const analysis = await analyse(page, shotPath, targetPath);
    await writeFile(resolve(OUT_DIR, `${stem}-compare.png`), Buffer.from(analysis.composite, 'base64'));
    report.compare = resolve(OUT_DIR, `${stem}-compare.png`);
    report.targetPalette = analysis.targetPalette;
    report.renderPalette = analysis.renderPalette;
  }

  if (problems.length) report.problems = [...new Set(problems)].slice(0, 15);
  await page.close();
  return report;
}

/**
 * Palette extraction and compositing, in the page.
 *
 * Both images are read through `createImageBitmap` and drawn to a canvas; the palette is a coarse
 * histogram (5-bit per channel) over every 4th pixel, which is plenty to recover a UI's flat
 * surface, text and accent colours and cheap enough to run on a full-page shot.
 */
async function analyse(page, renderPath, targetPath) {
  const [render, target] = await Promise.all([toDataUri(renderPath), toDataUri(targetPath)]);

  return page.evaluate(
    async ([renderUri, targetUri]) => {
      const load = async (uri) => createImageBitmap(await (await fetch(uri)).blob());

      const palette = (bitmap, count = 6) => {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        const bins = new Map();
        for (let i = 0; i < data.length; i += 16) {
          if (data[i + 3] < 128) continue;
          const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
          const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
          bin.n += 1;
          bin.r += data[i];
          bin.g += data[i + 1];
          bin.b += data[i + 2];
          bins.set(key, bin);
        }
        const total = [...bins.values()].reduce((sum, b) => sum + b.n, 0);
        return [...bins.values()]
          .sort((a, b) => b.n - a.n)
          .slice(0, count)
          .map((b) => {
            const hex = (v) => Math.round(v / b.n).toString(16).padStart(2, '0');
            return { hex: `#${hex(b.r)}${hex(b.g)}${hex(b.b)}`, share: +(b.n / total).toFixed(3) };
          });
      };

      const [renderBmp, targetBmp] = await Promise.all([load(renderUri), load(targetUri)]);

      // Scaled to a common height so the two are actually comparable side by side — a target
      // captured on a retina display is otherwise twice the size and reads as a different design.
      const height = Math.max(renderBmp.height, targetBmp.height);
      const widthOf = (b) => Math.round((b.width * height) / b.height);
      const gap = 24;
      const canvas = new OffscreenCanvas(widthOf(targetBmp) + gap + widthOf(renderBmp), height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#888';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(targetBmp, 0, 0, widthOf(targetBmp), height);
      ctx.drawImage(renderBmp, widthOf(targetBmp) + gap, 0, widthOf(renderBmp), height);

      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const buffer = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of buffer) binary += String.fromCharCode(byte);

      return {
        composite: btoa(binary),
        targetPalette: palette(targetBmp),
        renderPalette: palette(renderBmp),
      };
    },
    [render, target],
  );
}

async function toDataUri(path) {
  const { readFile } = await import('node:fs/promises');
  return `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
}

const fixtures = args.fixture ? [args.fixture] : await listFixtures();

async function listFixtures() {
  const page = await browser.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const ids = await page.evaluate(() => Object.keys(window.__weFixtures ?? {}));
  await page.close();
  return ids.length ? ids : ['discord'];
}

const reports = [];
for (const id of fixtures) reports.push(await shoot(id));
await browser.close();

for (const report of reports) {
  console.log(`\n${report.fixture}  →  ${report.path}`);
  console.log(`  template ${report.template}   route ${report.route}`);
  if (report.targetPalette) {
    console.log(`  target  ${report.targetPalette.map((c) => `${c.hex} ${(c.share * 100).toFixed(0)}%`).join('  ')}`);
    console.log(`  render  ${report.renderPalette.map((c) => `${c.hex} ${(c.share * 100).toFixed(0)}%`).join('  ')}`);
    console.log(`  compare ${report.compare}`);
  }
  if (report.problems) {
    console.log('  problems:');
    for (const problem of report.problems) console.log(`    ${problem.slice(0, 160)}`);
  }
}
