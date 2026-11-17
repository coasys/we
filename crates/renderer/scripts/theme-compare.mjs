#!/usr/bin/env node
/*
  Web capture + scoring half of theme-compare.sh. Drives system Chrome through
  playwright-core against the we-preview dev server's theme-shot page, one
  gallery × theme per full-page screenshot, then composites web|rust
  side-by-side PNGs and writes scores.json.

  All image work happens on an in-page canvas — no image deps in Node.

  Usage: theme-compare.mjs --url http://localhost:3100 --galleries <dir>
         --rust <dir-with-<gallery>-<theme>.png> --out <dir>
*/
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execPath } from 'node:process';

const require = createRequire(join(execPath, '..', '..', 'package.json'));
// playwright-core lives inside openclaw's global install, not this repo.
const {
  chromium,
} = require('/home/data/.nvm/versions/node/v24.20.0/lib/node_modules/openclaw/node_modules/playwright-core');

const CHROME = '/usr/bin/google-chrome';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])),
);
const URL_BASE = args.url ?? 'http://localhost:3100';
const GALLERY_DIR = resolve(args.galleries);
const RUST_DIR = resolve(args.rust);
const OUT = resolve(args.out);
mkdirSync(join(OUT, 'web'), { recursive: true });

/** gallery name → capture width (matches the Rust dump). */
const GALLERIES = { widgets: 820, inputs: 460, style: 760 };
const THEMES = ['light', 'dark', 'black', 'retro', 'cyberpunk', 'glow'];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.error(`[console] ${m.text()}`);
});

const scores = {};
for (const [gallery, width] of Object.entries(GALLERIES)) {
  const templateUrl = `${URL_BASE}/@fs/${join(GALLERY_DIR, `${gallery}.json`)}`;
  for (const theme of THEMES) {
    const key = `${gallery}-${theme}`;
    await page.setViewportSize({ width, height: 800 });
    const errors = [];
    page.removeAllListeners('pageerror');
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${URL_BASE}/theme-shot.html?theme=${theme}&templateUrl=${encodeURIComponent(templateUrl)}`, {
      waitUntil: 'networkidle',
    });
    const status = await page.evaluate(() => window.__themeShot ?? null);
    if (status?.error) throw new Error(`${key}: ${status.error}`);
    if (errors.length) console.error(`${key}: pageerror: ${errors[0]}`);
    // Theme fontFaces (glow's Bricolage) load async; data: images decode fast.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    const webPng = join(OUT, 'web', `${key}.png`);
    await page.screenshot({ path: webPng, fullPage: true });

    const rustPath = join(RUST_DIR, `${key}.png`);
    if (!existsSync(rustPath)) {
      console.error(`${key}: missing rust capture ${rustPath}`);
      continue;
    }
    const result = await page.evaluate(
      async ({ webB64, rustB64 }) => {
        const load = (b64) =>
          new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = () => rej(new Error('img decode'));
            i.src = 'data:image/png;base64,' + b64;
          });
        const [web, rust] = await Promise.all([load(webB64), load(rustB64)]);
        const W = Math.min(web.width, rust.width);
        const H = Math.min(web.height, rust.height);
        const read = (img) => {
          const c = document.createElement('canvas');
          c.width = W;
          c.height = H;
          const x = c.getContext('2d');
          x.drawImage(img, 0, 0, W, H);
          return x.getImageData(0, 0, W, H);
        };
        const a = read(web);
        const b = read(rust);
        const side = document.createElement('canvas');
        side.width = W * 2;
        side.height = H;
        const sx = side.getContext('2d');
        sx.drawImage(web, 0, 0, W, H);
        sx.drawImage(rust, W, 0, W, H);
        // Mean per-pixel RGB difference over the common scaled size.
        let sum = 0;
        for (let k = 0; k < a.data.length; k += 4) {
          sum +=
            (Math.abs(a.data[k] - b.data[k]) +
              Math.abs(a.data[k + 1] - b.data[k + 1]) +
              Math.abs(a.data[k + 2] - b.data[k + 2])) /
            (3 * 255);
        }
        // Structural: same comparison on 8px-block luminance — shape-level,
        // insensitive to single-pixel misalignment and colour-only deltas.
        const bs = 8;
        let bsum = 0;
        let bn = 0;
        for (let y = 0; y < H; y += bs) {
          for (let x = 0; x < W; x += bs) {
            let la = 0;
            let lb = 0;
            let cnt = 0;
            for (let j = y; j < Math.min(y + bs, H); j++) {
              for (let i = x; i < Math.min(x + bs, W); i++) {
                const k = (j * W + i) * 4;
                cnt++;
                la += a.data[k] * 0.299 + a.data[k + 1] * 0.587 + a.data[k + 2] * 0.114;
                lb += b.data[k] * 0.299 + b.data[k + 1] * 0.587 + b.data[k + 2] * 0.114;
              }
            }
            bsum += Math.abs(la / cnt - lb / cnt) / 255;
            bn++;
          }
        }
        return {
          png: side.toDataURL('image/png').split(',')[1],
          pixelDiff: sum / (W * H),
          structural: bsum / bn,
          web: [web.width, web.height],
          rust: [rust.width, rust.height],
        };
      },
      {
        webB64: readFileSync(webPng).toString('base64'),
        rustB64: readFileSync(rustPath).toString('base64'),
      },
    );
    writeFileSync(join(OUT, `${key}-side.png`), Buffer.from(result.png, 'base64'));
    scores[key] = {
      pixelDiff: +result.pixelDiff.toFixed(4),
      structural: +result.structural.toFixed(4),
      web: result.web,
      rust: result.rust,
    };
    console.log(`${key}: pixel=${scores[key].pixelDiff} structural=${scores[key].structural}`);
  }
}
writeFileSync(join(OUT, 'scores.json'), JSON.stringify(scores, null, 2));
await browser.close();
console.log(`\nwrote ${join(OUT, 'scores.json')}`);
