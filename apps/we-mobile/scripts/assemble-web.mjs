#!/usr/bin/env node
/**
 * Builds `www/`, the directory Capacitor serves: WE's web build, unchanged, plus the one page of the
 * app's own beside it.
 *
 * 1. Copies `apps/we-web/dist` (build it first: `pnpm build:web` at the repo root). WE's files are
 *    not edited: WE connects to its executor the way it does in a browser.
 * 2. Builds `www/mobile/error.html`, the page Capacitor opens instead of WE when the phone's
 *    Android System WebView is older than WE's build needs (`android.minWebViewVersion`), or when
 *    WE's page fails to load (`server.errorPath`). See src/webViewFloor.ts.
 * 3. Builds `www/mobile/identity.html`, the phone's identity page: the shared identity window
 *    (`@we/identity-window`) over the `DeviceKey` plugin, under the window's own policy. WE opens it
 *    to join an identity and for each identity change. See src/identity/.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { identityWindowConfig } from '@we/identity-window/vite';
import { build } from 'vite';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const weDist = resolve(app, '../we-web/dist');
const www = join(app, 'www');

if (!existsSync(join(weDist, 'index.html'))) {
  console.error(`No WE web build at ${weDist}. Run \`pnpm build:web\` at the repo root first.`);
  process.exit(1);
}

rmSync(www, { recursive: true, force: true });
cpSync(weDist, www, { recursive: true });
// Netlify's files: nothing in a Capacitor app reads them.
for (const f of ['_headers', '_redirects']) rmSync(join(www, f), { force: true });

await build({
  configFile: false,
  root: join(app, 'src/error'),
  base: '/mobile/',
  logLevel: 'warn',
  build: {
    outDir: join(www, 'mobile'),
    emptyOutDir: false,
    // This page is what tells someone whose WebView is too old for WE what to do, so it is built
    // for the oldest one the app installs on: Android 11 (minSdk 30) ships WebView 83. iOS 15 is
    // the oldest Capacitor 8 supports.
    target: ['chrome83', 'safari15'],
    // One file: the page must not depend on anything else loading.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { input: join(app, 'src/error/error.html') },
  },
});

const identity = identityWindowConfig({ root: join(app, 'src/identity'), outDir: join(www, 'mobile') });
await build({
  ...identity,
  configFile: false,
  base: '/mobile/',
  logLevel: 'warn',
  build: {
    ...identity.build,
    // Beside error.html, which the step above wrote.
    emptyOutDir: false,
    rollupOptions: { input: join(app, 'src/identity/identity.html') },
  },
});

console.log(`www/ assembled from ${weDist}, with mobile/error.html and mobile/identity.html`);
