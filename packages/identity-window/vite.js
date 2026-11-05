import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { themeParametersToStyle } from '@we/themes/presets';

/**
 * The identity window's policy: nothing but its own script and style, images only from itself or
 * `data:` (the offer's QR code), no network but the Tauri bridge (Electron's preload needs none),
 * no frames, no string sinks for script. One line in `csp.txt`, which `src/screens.test.ts` checks.
 */
export const IDENTITY_CSP = readFileSync(resolve(import.meta.dirname, 'csp.txt'), 'utf8').trim();

/** The stylesheet the window imports for WE's light and dark themes; see {@link identityThemeCss}. */
export const IDENTITY_THEME_MODULE = 'virtual:we-identity-theme.css';

const declarations = (vars) =>
  Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');

/**
 * WE's light and dark themes as one static stylesheet, following the computer's own setting.
 *
 * Worked out when the window is built rather than when it runs, so the page that shows the recovery
 * words gains the app's colours and no code of the app's: the theme engine runs here, in Node, and
 * what reaches the window is CSS under its `style-src 'self'`.
 */
export function identityThemeCss() {
  return [
    `:root {\n${declarations(themeParametersToStyle({ themeName: 'light' }))}\n}`,
    `@media (prefers-color-scheme: dark) {\n:root {\n${declarations(themeParametersToStyle({ themeName: 'dark' }))}\n}\n}`,
  ].join('\n');
}

/**
 * The Vite config that builds a host's identity window: the page in `root` (whose script calls
 * `runIdentityWindow` with the host's transport), built into `outDir` with the policy written into
 * the page. A dev server serves the page without it, because Vite's dev client injects inline
 * styles and a websocket the policy forbids.
 */
export function identityWindowConfig({ root, outDir }) {
  return {
    root,
    base: './',
    plugins: [
      {
        name: 'identity-theme',
        resolveId: (id) => (id === IDENTITY_THEME_MODULE ? `\0${IDENTITY_THEME_MODULE}` : null),
        load: (id) => (id === `\0${IDENTITY_THEME_MODULE}` ? identityThemeCss() : null),
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
