/**
 * The identity window's bundle, built apart from the app's:`dist/identity/`, from
 * `identity/`, importing nothing of WE but the Tauri bridge — no template, module or store code is in
 * it, so nothing a template or a post can influence is in the window that shows the 12 words.
 *
 * The window's Content-Security-Policy is written into the built page. In `tauri dev`
 * the app's own Vite server serves `identity/index.html` without it, because Vite's dev client
 * injects inline styles and a websocket the policy forbids.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { defineConfig, type Plugin } from 'vite';

/**
 * The window's policy: nothing but its own script and style, images only from itself
 * or `data:` (the offer's QR code), no network but the Tauri bridge, no frames, no string sinks for
 * script. One line in `identity/csp.txt`, which `identity/screens.test.ts` checks.
 */
const IDENTITY_CSP = readFileSync(resolve(import.meta.dirname, 'identity/csp.txt'), 'utf8').trim();

function identityCsp(): Plugin {
  return {
    name: 'identity-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: IDENTITY_CSP },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'identity'),
  base: './',
  plugins: [identityCsp()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist/identity'),
    emptyOutDir: true,
    // One script and one stylesheet: no preload helper, which would want an inline script.
    modulePreload: false,
    assetsInlineLimit: 0,
  },
});
