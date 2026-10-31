#!/usr/bin/env node
/**
 * Builds `www/`, the directory Capacitor serves: WE's real web build, unchanged, plus the phone's
 * own pages beside it.
 *
 * 1. Copies `apps/we-web/dist` (build it first: `pnpm build:web` at the repo root).
 * 2. Builds `www/phone/diag.html` (pairing and diagnostics) and `www/phone/boot.js`.
 * 3. Puts one classic `<script src="/phone/boot.js">` into WE's `index.html`, before WE's module
 *    bundle, so the pinned WebSocket is in place before WE opens its executor connection.
 *
 * That script tag is the only change made to WE's files.
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// ad4m-connect keeps its settings under `<version>/<key>`; boot.js has to write the keys this
// build of it reads.
// The phone's own pages are built for old WebViews on purpose: they are what tells someone with a
// stale system WebView what is wrong, so they have to run where WE's `esnext` bundle cannot.
// Android 11's factory WebView is Chrome 83; iOS 15 is the floor Capacitor 8 supports.
const target = ['chrome83', 'safari15'];

const connectPkg = JSON.parse(
  readFileSync(resolve(app, '../we-web/node_modules/@coasys/ad4m-connect/package.json'), 'utf8'),
);

await build({
  configFile: false,
  root: join(app, 'src/diag'),
  base: '/phone/',
  logLevel: 'warn',
  build: {
    outDir: join(www, 'phone'),
    emptyOutDir: false,
    target,
    rollupOptions: { input: join(app, 'src/diag/diag.html') },
  },
});

await build({
  configFile: false,
  logLevel: 'warn',
  define: { __AD4M_CONNECT_VERSION__: JSON.stringify(connectPkg.version) },
  build: {
    outDir: join(www, 'phone'),
    emptyOutDir: false,
    target,
    lib: { entry: join(app, 'src/boot.ts'), formats: ['iife'], name: 'CoasysBoot', fileName: () => 'boot.js' },
  },
});

const indexPath = join(www, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const firstModule = html.indexOf('<script type="module"');
if (firstModule < 0) throw new Error('WE index.html has no module script to put boot.js before');
const tag = '<script src="/phone/boot.js"></script>\n    ';
writeFileSync(indexPath, html.slice(0, firstModule) + tag + html.slice(firstModule));

console.log(`www/ assembled: WE build from ${weDist}, ad4m-connect ${connectPkg.version}`);
