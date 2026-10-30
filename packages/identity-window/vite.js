import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The identity window's policy: nothing but its own script and style, images only from itself or
 * `data:` (the offer's QR code), no network but the Tauri bridge (Electron's preload needs none),
 * no frames, no string sinks for script. One line in `csp.txt`, which `src/screens.test.ts` checks.
 */
export const IDENTITY_CSP = readFileSync(resolve(import.meta.dirname, 'csp.txt'), 'utf8').trim();

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
