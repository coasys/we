/**
 * Measure a reference screenshot: palette, and the vertical columns it is built from.
 *
 * ```sh
 * node scripts/measure.mjs ~/ref/discord.png --row 0.5 --calibrate 72
 * ```
 *
 * A screenshot has no intrinsic scale — 5112 pixels wide could be a 2556pt window at 2× or a 5112pt
 * one at 1×, and every measurement means something different depending on which. Two ways out:
 * pass `--window <cssPx>` if you know what the capture was taken at, or `--calibrate <cssPx>` with
 * the known CSS width of the *first* column, which is usually the more reliable of the two because
 * a platform's rail width is a published constant and nobody remembers their window size.
 *
 * Columns are found by scanning one horizontal row for runs of near-constant colour. That is crude
 * and exactly right for this subject: an app chrome is vertical bands of flat fill, and the run
 * boundaries are the rails, gutters and content columns you actually need the widths of.
 */
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node scripts/measure.mjs <image.png> [--row 0.5] [--window 1440] [--calibrate 72]');
  process.exit(1);
}
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const rowFraction = flag('row', 0.5);
const windowWidth = flag('window', 0);
const calibrateFirst = flag('calibrate', 0);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const uri = `data:image/png;base64,${(await readFile(resolve(process.cwd(), file))).toString('base64')}`;

const result = await page.evaluate(
  async ([dataUri, row]) => {
    const bitmap = await createImageBitmap(await (await fetch(dataUri)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

    // ── palette ──
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
    const total = [...bins.values()].reduce((s, b) => s + b.n, 0);
    const palette = [...bins.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 8)
      .map((b) => ({
        hex: hex(Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)),
        share: +(b.n / total).toFixed(3),
      }));

    // ── columns, from the modal colour of each x across many rows ──
    //
    // A single scan line was the obvious approach and is useless: at any given y it crosses server
    // icons, avatars and embedded images, so the "bands" it finds are whatever content happened to
    // sit on that line. Taking the most common colour down each column ignores content — a rail is
    // flat for hundreds of rows and an avatar is not — and leaves the chrome.
    const sampleRows = [];
    const rowCount = Math.min(240, bitmap.height);
    for (let n = 0; n < rowCount; n += 1) sampleRows.push(Math.floor((n / rowCount) * bitmap.height));

    const at = (x) => {
      const counts = new Map();
      for (const y of sampleRows) {
        const i = (y * bitmap.width + x) * 4;
        const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
        const entry = counts.get(key) ?? { n: 0, c: [data[i], data[i + 1], data[i + 2]] };
        entry.n += 1;
        counts.set(key, entry);
      }
      let best = { n: 0, c: [0, 0, 0] };
      for (const entry of counts.values()) if (entry.n > best.n) best = entry;
      return best.c;
    };
    const near = (a, b, tol = 6) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= tol;

    const runs = [];
    let start = 0;
    let colour = at(0);
    for (let x = 1; x < bitmap.width; x += 1) {
      const here = at(x);
      if (near(here, colour)) continue;
      runs.push({ from: start, to: x, width: x - start, hex: hex(...colour) });
      start = x;
      colour = here;
    }
    runs.push({ from: start, to: bitmap.width, width: bitmap.width - start, hex: hex(...colour) });

    // Runs narrower than 8px are borders, dividers and text — real, but not columns.
    return { width: bitmap.width, height: bitmap.height, palette, bands: runs.filter((r) => r.width >= 8) };
  },
  [uri, rowFraction],
);
await browser.close();

const scale = windowWidth ? result.width / windowWidth : calibrateFirst ? result.bands[0].width / calibrateFirst : 1;
const css = (px) => (scale === 1 ? `${px}px?` : `${Math.round(px / scale)}px`);

console.log(`\n${basename(file)}  ${result.width}x${result.height}`);
console.log(
  scale === 1
    ? '  scale unknown — pass --window or --calibrate, every width below is raw image pixels'
    : `  scale ${scale.toFixed(2)}x  →  logical ${Math.round(result.width / scale)}x${Math.round(result.height / scale)}`,
);

console.log('\n  palette');
for (const c of result.palette) console.log(`    ${c.hex}  ${(c.share * 100).toFixed(1)}%`);

console.log('\n  vertical bands (modal colour per column)');
for (const b of result.bands) console.log(`    ${b.hex}  ${String(css(b.width)).padStart(7)}   x ${css(b.from)}`);
