/**
 * Derives every app icon in the monorepo from one mark and the theme's own numbers.
 *
 * ## Why this exists
 *
 * `we-mark.svg` used to be three byte-identical copies under `apps/*​/public/`, and the app icon a
 * 512px PNG hand-copied from the Tauri icon set into the Electron build directory. Nothing kept any
 * of them in step; they agreed because nobody had edited one. Every drift bug in this repo has the
 * same shape — a copy that fell behind its source and went on looking deliberate — so the mark gets
 * one home and everything else is output.
 *
 * The outputs are committed rather than built on demand, because electron-builder and the Tauri
 * bundler read them off disk at package time. CI's whole-tree `git status --porcelain` check after
 * `pnpm build` is what makes that safe: regenerate without committing and the build fails, exactly
 * as it does for the AI-context outputs.
 *
 * ## Why the colours are computed rather than written down
 *
 * The icon is the sidebar's header, standing on its own: the `page` role behind it and
 * `--we-gradient-primary` through the mark. Both are parametric — hue, saturation and a lightness
 * ramp — so hard-coding `#1f1e2a` would freeze today's theme into a file nothing recomputes, which
 * is the same mistake as naming a scale position where a role belongs. Here the preset is read and
 * the ramp arithmetic reused from `@we/tokens`, so moving `primaryHue` moves the icon.
 *
 * ## Why the Tauri CLI does the rasterising
 *
 * It is the only SVG rasteriser in the tree (no ImageMagick, sharp or resvg), and it is already
 * authoritative for the Tauri icon set — 54 files including `.ico` and `.icns`, which would
 * otherwise have to be re-implemented here. The web favicon is the `.ico` from that same set;
 * Electron's 1024 master is a second `--png` pass over the same SVG, for the reason given at the
 * call site. Every target therefore comes from one source and one rasteriser.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { THEME_PRESETS, type ThemeParameters } from '@we/themes/presets';
// The `color` subpath rather than the index: `colorLightness` (the ramp's step table) is only
// exported there, and taking all five from one place keeps them provably the same source.
import { CHROMA_CEILING, CHROMA_PER_SATURATION, chromaTaper, colorLightness, RAMP } from '@we/tokens/color';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const MARK = join(HERE, 'we-mark.svg');

/**
 * The theme the icon is drawn from.
 *
 * An icon cannot follow the reader's theme — it is a file on disk, chosen by the desktop before the
 * app runs — so one has to be picked. Dark, because the mark is a light gradient and needs the page
 * behind it to be dark to read at 16px.
 */
const ICON_THEME = 'dark' as const;

/** Share of the tile left as margin on each side. The mark is wide, so this is what stops it touching the edges. */
const PADDING = 0.12;

/**
 * Corner radius, as a share of the tile — and with it, transparency outside the corners.
 *
 * A full-bleed square is the odd one out on a Linux desktop: unlike macOS and Windows, nothing masks
 * an icon's shape for you here, so whatever the PNG contains is exactly what the panel draws. Every
 * other app on a stock Mint bar is a rounded tile on transparency, and a hard-edged square beside
 * them reads as unfinished rather than as a choice.
 */
const CORNER_RADIUS = 0.18;

/**
 * `linear-gradient(135deg, …)` runs top-left to bottom-right, which in SVG is (0,0) → (w,h).
 *
 * Written without a double hyphen: XML forbids one inside a comment, and resvg rejects the whole
 * file for it — so naming the CSS custom property here would make the icon unrasterisable.
 */
const GRADIENT_ANGLE_NOTE = '135deg, matching the primary gradient token';

// ─── Colour ─────────────────────────────────────────────────────────────────────

function oklchToHex(lPercent: number, c: number, hDeg: number): string {
  const L = lPercent / 100;
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${channels
    .map((v) => {
      const clamped = Math.max(0, Math.min(1, v));
      const encoded = clamped > 0.0031308 ? 1.055 * clamped ** (1 / 2.4) - 0.055 : 12.92 * clamped;
      return Math.round(Math.max(0, Math.min(1, encoded)) * 255)
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
}

/** Where a lightness step lands between the theme's floor and ceiling — the same arithmetic the emitted CSS does. */
function rampLightness(step: keyof typeof colorLightness, floor: number, ceiling: number, polarity: 'light' | 'dark') {
  const { offset, direction } = RAMP[polarity];
  const t = (parseFloat(colorLightness[step]) / 100 - offset) * direction;
  return floor + t * (ceiling - floor);
}

function resolvePalette() {
  /*
    Widened to the shared parameter type. Each preset's own type is narrowed to exactly the keys it
    declares, so `primaryHue` is a type error on a preset that leaves it at the default — which is
    most of them, and would make this break on whichever theme was chosen rather than on all of them.
  */
  const p = THEME_PRESETS[ICON_THEME].parameters as ThemeParameters;
  const polarity = (p.polarity ?? 'light') as 'light' | 'dark';
  const floor = parseFloat(String(p.lightnessFloor ?? '0%'));
  const ceiling = parseFloat(String(p.lightnessCeiling ?? '100%'));
  const hue = p.primaryHue ?? 288;
  const saturation = p.saturation ?? 60;
  const neutralSaturation = p.neutralSaturation ?? 10;
  const neutralHue = p.neutralHue ?? hue;

  /*
    `page` is `neutral-50`, and neutrals do NOT scale their chroma the way the accent hues do.
    An accent is `saturation * CHROMA_PER_SATURATION` capped at the ceiling; a neutral is a
    *fraction* of the ceiling — `neutralSaturation / 100 * chromaMax` — which is roughly half as
    much at the same number. Using the accent formula here turns the page from near-grey to a
    visibly purple #1e1c33. Both are tapered at where the step lands.
  */
  const pageL = rampLightness('50', floor, ceiling, polarity);
  const pageC = (neutralSaturation / 100) * CHROMA_CEILING * chromaTaper(pageL / 100);

  // The gradient is two stops either side of the primary hue, both at lightness-500, at a fixed
  // fraction of the saturation ceiling — see GRADIENT_CHROMA in @we/tokens' generate-css.
  const markL = rampLightness('500', floor, ceiling, polarity);
  const markC = Math.min(saturation * CHROMA_PER_SATURATION, CHROMA_CEILING) * 0.8;

  return {
    page: oklchToHex(pageL, pageC, neutralHue),
    from: oklchToHex(markL, markC, hue - 25),
    to: oklchToHex(markL, markC, hue + 25),
  };
}

// ─── Composition ────────────────────────────────────────────────────────────────

function composeIcon(size = 1024): string {
  const svg = readFileSync(MARK, 'utf8');
  const viewBox = /viewBox="([\d.\s-]+)"/.exec(svg);
  if (!viewBox) throw new Error(`[brand] ${MARK} has no viewBox — cannot place the mark in a square.`);
  const [, , vw, vh] = viewBox[1].split(/\s+/).map(Number);

  // The drawing, with its own transforms intact. Lifted rather than re-authored so an Inkscape
  // edit to the mark needs no change here.
  const body = svg.slice(svg.indexOf('<g\n     id="layer1"'), svg.lastIndexOf('</svg>'));
  const { page, from, to } = resolvePalette();
  const inset = Math.round(size * PADDING);
  const box = size - inset * 2;

  /*
    The gradient is painted ONCE, on a single rect, with the mark as a mask.

    Filling the paths with it directly does not work: `userSpaceOnUse` resolves in each referencing
    element's own user space, and the two paths carry different transforms — the second is rotated
    90 degrees — so each letter got its own gradient and one of them was rotated. A mask rather than
    a clipPath because clipPath children are restricted to shapes, and this artwork is nested groups.
  */
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * CORNER_RADIUS)}" fill="${page}"/>
  <svg x="${inset}" y="${inset}" width="${box}" height="${box}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">
    <defs>
      <!-- ${GRADIENT_ANGLE_NOTE} -->
      <linearGradient id="weGradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${vw}" y2="${vh}">
        <stop offset="0" stop-color="${from}"/>
        <stop offset="1" stop-color="${to}"/>
      </linearGradient>
      <mask id="weMark"><g fill="#fff">${body}</g></mask>
    </defs>
    <rect width="${vw}" height="${vh}" fill="url(#weGradient)" mask="url(#weMark)"/>
  </svg>
</svg>
`;
}

// ─── Emit ───────────────────────────────────────────────────────────────────────

/** Apps serve the mark from their own `public/`, because the sidebar names it by URL (`/we-text.svg`). */
const WORDMARK_TARGETS = ['we-web', 'we-electron', 'we-tauri'].map((app) =>
  join(REPO, 'apps', app, 'public', 'we-text.svg'),
);

const TAURI_ICONS = join(REPO, 'apps', 'we-tauri', 'src-tauri', 'icons');
const ELECTRON_ICON = join(REPO, 'apps', 'we-electron', 'build', 'icon.png');
const FAVICON = join(REPO, 'packages', 'app-shell', 'src', 'shared', 'assets', 'favicon.ico');

/**
 * Hash of the composed icon, so `icon.icns` can be left alone when nothing has changed.
 *
 * 53 of the 54 generated files are byte-identical across runs. `icon.icns` is not: two renders of
 * the same source come out the same *length* with 50KB of 55KB differing, so it is the icns
 * compressor that is not reproducible rather than an embedded timestamp — there is no field to
 * normalise. Rewriting it every build would leave the tree dirty every build, and CI's whole-tree
 * `git status --porcelain` check would fail on a PR that changed nothing.
 *
 * So the icns is regenerated only when the source that feeds it changes. Everything else is
 * rewritten unconditionally, because it is deterministic and comparing would only add ways to be
 * subtly wrong.
 */
const SOURCE_STAMP = join(HERE, '..', 'icon-source.hash');

/** A PNG's width, straight out of the IHDR chunk — no decoder needed for two integers. */
function pngWidth(file: string): number {
  return readFileSync(file).readUInt32BE(16);
}

/**
 * Smallest window icon that still looks sharp on a panel, and the largest worth embedding.
 *
 * `tauri-codegen`'s `find_icon` is `config.bundle.icon.iter().find(|i| i.ends_with(".png"))` — the
 * FIRST png, not the largest — so the array is a priority list where it reads like a manifest. The
 * conventional Tauri ordering starts with `icons/32x32.png`, which is why the window icon looked
 * blurred beside Electron's while both came from the same artwork.
 *
 * The ceiling is the less obvious half. Unlike Electron, which hands the toolkit several sizes,
 * Tauri sets one image as `_NET_WM_ICON`, and a very large single icon is not reliably rendered —
 * putting the 512 first made the Mint panel show nothing at all. 256 is comfortably above any panel
 * size in use and well inside what gets drawn.
 *
 * Nothing in `tauri.conf.json` can carry this reasoning: it is plain JSON and takes no comments. So
 * the check lives here, where the icons are made.
 */
const WINDOW_ICON_MIN = 256;
const WINDOW_ICON_MAX = 256;

function assertTauriIconOrder() {
  const confPath = join(REPO, 'apps', 'we-tauri', 'src-tauri', 'tauri.conf.json');
  const icons: string[] = JSON.parse(readFileSync(confPath, 'utf8')).bundle?.icon ?? [];
  const firstPng = icons.find((i) => i.endsWith('.png'));
  if (!firstPng) throw new Error('[brand] tauri.conf.json lists no .png, so Tauri has no window icon to embed.');

  const width = pngWidth(join(REPO, 'apps', 'we-tauri', 'src-tauri', firstPng));
  if (width < WINDOW_ICON_MIN || width > WINDOW_ICON_MAX) {
    throw new Error(
      `[brand] tauri.conf.json lists "${firstPng}" (${width}px) first, and Tauri embeds the first ` +
        `.png as the window icon. Put a ${WINDOW_ICON_MIN}px one first — smaller is upscaled and ` +
        'looks blurred, larger is not reliably drawn. See assertTauriIconOrder.',
    );
  }
}

function main() {
  assertTauriIconOrder();
  const mark = readFileSync(MARK, 'utf8');
  for (const target of WORDMARK_TARGETS) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, mark);
  }
  console.log(`✅ Wordmark written to ${WORDMARK_TARGETS.length} apps`);

  const icon = composeIcon();
  const composed = join(HERE, '..', 'icon.generated.svg');
  writeFileSync(composed, icon);
  const { page, from, to } = resolvePalette();
  console.log(`✅ Icon composed from the "${ICON_THEME}" theme — page ${page}, gradient ${from} → ${to}`);

  const hash = createHash('sha256').update(icon).digest('hex');
  const icns = join(TAURI_ICONS, 'icon.icns');
  const stale = !existsSync(SOURCE_STAMP) || readFileSync(SOURCE_STAMP, 'utf8').trim() !== hash || !existsSync(icns);
  const keptIcns = !stale && existsSync(icns) ? readFileSync(icns) : null;

  mkdirSync(TAURI_ICONS, { recursive: true });
  execFileSync('pnpm', ['exec', 'tauri', 'icon', composed, '-o', TAURI_ICONS], {
    cwd: join(HERE, '..'),
    stdio: 'pipe',
  });
  if (keptIcns) writeFileSync(icns, keptIcns);
  writeFileSync(SOURCE_STAMP, `${hash}\n`);
  console.log(`✅ Tauri icon set regenerated${keptIcns ? ' (icon.icns unchanged — source is the same)' : ''}`);

  /*
    Electron's master is rendered separately at 1024 rather than taken from the set above.

    The only 1024 in that set is `ios/AppIcon-512@2x.png`, and iOS icons are FLATTENED — Apple
    forbids alpha there, so Tauri composites them onto an opaque background. Copying it gave Electron
    a square-cornered tile while every other output had the rounded, transparent corners the artwork
    actually has. `--png` renders the size we want from the same SVG, with alpha intact.
  */
  const master = join(HERE, '..', '.icon-1024');
  execFileSync('pnpm', ['exec', 'tauri', 'icon', composed, '-o', master, '--png', '1024'], {
    cwd: join(HERE, '..'),
    stdio: 'pipe',
  });
  mkdirSync(dirname(ELECTRON_ICON), { recursive: true });
  copyFileSync(join(master, '1024x1024.png'), ELECTRON_ICON);
  rmSync(master, { recursive: true, force: true });

  // The favicon is the multi-size .ico the set above already produced, so nothing is scaled twice.
  copyFileSync(join(TAURI_ICONS, 'icon.ico'), FAVICON);
  console.log(`✅ Electron master (1024, alpha) and web favicon written`);
}

main();
