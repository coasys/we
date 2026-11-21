import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  fontFaceProblem,
  parseOverrides,
  resolveDisplay,
  themeParametersToStyle,
  withDisplay,
} from '@we/themes/presets';

/**
 * The identity window's policy: nothing but its own script, style and fonts, images only from itself
 * or `data:` (the app's mark, the offer's QR code), no network but the Tauri bridge (Electron's
 * preload needs none), no frames, no string sinks for script. One line in `csp.txt`, which
 * `src/screens.test.ts` checks.
 */
export const IDENTITY_CSP = readFileSync(resolve(import.meta.dirname, 'csp.txt'), 'utf8').trim();

/** The stylesheet the window imports for the app's theme; see {@link identityThemeCss}. */
export const IDENTITY_THEME_MODULE = 'virtual:we-identity-theme.css';

/** The app's name and mark, as the window's header draws them; see {@link identityBrand}. */
export const IDENTITY_BRAND_MODULE = 'virtual:we-identity-brand';

/**
 * WE's own light and dark presets, as a theme with two sides: what the window wears for a deployment
 * whose app brings no theme, as WE's app does.
 */
const WE_THEME = { overrides: { themeName: 'light', dark: { themeName: 'dark' } } };

/**
 * The operating system's settings the app follows on its own — `prefers-color-scheme`,
 * `prefers-contrast`, `prefers-reduced-motion` — each as the media feature that says it, and the
 * signal `resolveDisplay` reads it as.
 */
const SYSTEM_SIGNALS = [
  { signal: 'dark', media: '(prefers-color-scheme: dark)' },
  { signal: 'moreContrast', media: '(prefers-contrast: more)' },
  { signal: 'reducedMotion', media: '(prefers-reduced-motion: reduce)' },
];

const declarations = (vars) =>
  Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');

const FONT_TYPE = /^data:([^;,]+);base64,/;
const FONT_EXTENSIONS = {
  'font/woff2': 'woff2',
  'application/font-woff2': 'woff2',
  'font/woff': 'woff',
  'application/font-woff': 'woff',
  'font/ttf': 'ttf',
  'application/x-font-ttf': 'ttf',
  'font/otf': 'otf',
  'application/x-font-otf': 'otf',
};
const FONT_WEIGHT = /^\d{1,4}( \d{1,4})?$|^(normal|bold)$/;
const UNICODE_RANGE = /^[\dA-Fa-f?U+, -]+$/;

/** A face the theme carries, as its font file: the bytes and the extension its type names. */
function fontFile(face) {
  const type = FONT_TYPE.exec(face.src)?.[1];
  return {
    extension: FONT_EXTENSIONS[type] ?? 'woff2',
    source: Buffer.from(face.src.slice(face.src.indexOf(',') + 1), 'base64'),
  };
}

/**
 * The theme's own typefaces as `@font-face` rules: the faces the app registers with the FontFace API
 * (`applyFontFaces` in `@we/themes`), passed by the same check. `url` says where each face's file is.
 */
function fontFaceRules(overrides, url) {
  return (overrides.fontFaces ?? [])
    .filter((face) => !fontFaceProblem(face))
    .map((face) => {
      const lines = [`  font-family: '${face.family}';`, `  src: url(${url(face)});`, '  font-display: swap;'];
      if (face.weight && FONT_WEIGHT.test(face.weight)) lines.push(`  font-weight: ${face.weight};`);
      if (face.style === 'italic') lines.push('  font-style: italic;');
      if (face.unicodeRange && UNICODE_RANGE.test(face.unicodeRange))
        lines.push(`  unicode-range: ${face.unicodeRange};`);
      return `@font-face {\n${lines.join('\n')}\n}`;
    });
}

/**
 * The app's theme as one static stylesheet, worn by the rule the app wears it by.
 *
 * `theme` is the theme the app's screens before a session are drawn in — the deployment's app's
 * first (`deploymentBase` in `@we/app-shell`), handed in by the host's build — or WE's light and dark
 * presets where its app brings none. The app lays the computer's settings over whatever theme it
 * applies (`withDisplay` in `@we/themes`): a theme with a light and a dark side follows the
 * computer's colour scheme, one with a single look wears it everywhere, and more contrast and reduced
 * motion follow the computer too. The window takes each combination of those settings through the
 * same functions, as `@media` blocks, so it and the app cannot disagree on any computer.
 *
 * Worked out when the window is built rather than when it runs, so the page that shows the recovery
 * words gains the app's colours and no code of the app's: the theme engine runs here, in Node, and
 * what reaches the window is CSS under its `style-src 'self'`. `fontUrl` says where a face's file is
 * served from; the face's own `data:` URL when not given.
 */
export function identityThemeCss(theme = WE_THEME, fontUrl = (face) => face.src) {
  const overrides = parseOverrides(JSON.stringify(theme.overrides ?? {}));
  const blocks = [];
  // Every combination of the three settings, the computer's defaults first.
  for (let mask = 0; mask < 1 << SYSTEM_SIGNALS.length; mask++) {
    const on = SYSTEM_SIGNALS.filter((_, i) => mask & (1 << i));
    const signals = Object.fromEntries(
      SYSTEM_SIGNALS.map(({ signal }) => [signal, on.some((s) => s.signal === signal)]),
    );
    const worn = withDisplay(overrides, resolveDisplay({}, signals));
    blocks.push({ media: on.map((s) => s.media).join(' and '), vars: themeParametersToStyle(worn) });
  }
  /*
    The defaults whole, then each other combination with what it changes. Blocks come in the order of
    their settings, so on any computer the last block that matches is that computer's own
    combination: it says every variable a narrower block changed, so none keeps the narrower value.
    A variable a combination leaves to the tokens that the defaults or a narrower block set is taken
    back off with `initial`, which leaves it to the fallback its readers give.
  */
  const [defaults, ...others] = blocks;
  const changes = others.map(({ vars }) =>
    Object.keys({ ...vars, ...defaults.vars }).filter((k) => vars[k] !== defaults.vars[k]),
  );
  // A narrower combination's mask is a subset of this one's: block `j` is mask `j + 1`.
  const narrower = (i) => changes.filter((_, j) => j < i && ((j + 1) & (i + 1)) === j + 1).flat();
  const rules = others.flatMap(({ media, vars }, i) => {
    const keys = [...new Set([...changes[i], ...narrower(i)])];
    if (!keys.length) return [];
    const own = Object.fromEntries(keys.map((k) => [k, vars[k] ?? 'initial']));
    return [`@media ${media} {\n:root {\n${declarations(own)}\n}\n}`];
  });
  return [...fontFaceRules(overrides, fontUrl), `:root {\n${declarations(defaults.vars)}\n}`, ...rules].join('\n');
}

/**
 * The app's name and its mark as an image, or `null` where the app brings no brand of its own: then
 * the window names no app, and the host's window title does.
 */
export function identityBrand(brand) {
  if (!brand?.name) return null;
  const mark = brand.mark ? `data:image/svg+xml;base64,${Buffer.from(brand.mark, 'utf8').toString('base64')}` : null;
  return { name: brand.name, mark };
}

/**
 * The Vite config that builds a host's identity window: the page in `root` (whose script calls
 * `runIdentityWindow` with the host's transport), built into `outDir` with the policy written into
 * the page, in the deployment's `theme` and with its `brand` — what the app's screens before a session
 * are drawn with, so the window is the same app. A dev server serves the page without the policy,
 * because Vite's dev client injects inline styles and a websocket the policy forbids.
 */
export function identityWindowConfig({ root, outDir, theme, brand }) {
  let building = false;
  return {
    root,
    base: './',
    plugins: [
      {
        name: 'identity-theme',
        configResolved: (config) => {
          building = config.command === 'build';
        },
        resolveId: (id) => (id === IDENTITY_THEME_MODULE || id === IDENTITY_BRAND_MODULE ? `\0${id}` : null),
        load(id) {
          if (id === `\0${IDENTITY_BRAND_MODULE}`) return `export default ${JSON.stringify(identityBrand(brand))};`;
          if (id !== `\0${IDENTITY_THEME_MODULE}`) return null;
          /*
            A built window serves a face as a file of its own, under `font-src 'self'`: the `data:`
            URL the theme carries would need `font-src data:`. Vite puts the file's path in place of
            the placeholder when it writes the stylesheet.
          */
          const fontUrl = (face) => {
            if (!building) return face.src;
            const { extension, source } = fontFile(face);
            const name = `${face.family.replace(/\s+/g, '-')}.${extension}`;
            return `__VITE_ASSET__${this.emitFile({ type: 'asset', name, source })}__`;
          };
          return identityThemeCss(theme, fontUrl);
        },
      },
      {
        name: 'identity-csp',
        apply: 'build',
        transformIndexHtml: () => [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: IDENTITY_CSP },
            injectTo: 'head-prepend',
          },
        ],
      },
    ],
    build: {
      outDir,
      emptyOutDir: true,
      // One script and one stylesheet: no preload helper, which would want an inline script.
      modulePreload: false,
      assetsInlineLimit: 0,
    },
  };
}
