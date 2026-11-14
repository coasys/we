#!/usr/bin/env node
/**
 * Checks the assembled `www/` against the WebView floor (src/webViewFloor.ts). Run after
 * `pnpm build:web`; CI runs it before building the APK.
 *
 * 1. The error page Capacitor opens below the floor is where `server.errorPath` says.
 * 2. Its script parses on WebView 83, Android 11's factory WebView: it is the page an old WebView
 *    has to be able to show.
 * 3. No other script uses syntax newer than the floor: WE's, and the identity page's beside the
 *    error page, which only WE opens, so it never runs below the floor.
 *
 * How: esbuild prints each file once for `esnext` and once for the target. Where they differ, the
 * file uses syntax esbuild had to rewrite for that browser, so the browser cannot parse the
 * original. Unicode property escapes in regular expressions are left alone: esbuild rewrites every
 * one for any target (into `new RegExp(...)`) without the syntax being new.
 *
 * Syntax is what this can see. The floor itself was set by CSS and measured in real browsers
 * (README.md, "The WebView floor"); a new CSS or runtime requirement moves it by hand.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transform } from 'esbuild';

import { ERROR_PAGE_PATH, MIN_WEBVIEW_MAJOR } from '../src/webViewFloor.ts';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(app, 'www');

const supported = { 'regexp-unicode-property-escapes': true };

/** The first line where the file differs when printed for `target`, or null when it does not. */
async function needsNewer(code, target) {
  const print = (t) => transform(code, { target: t, loader: 'js', supported }).then((r) => r.code);
  const esnext = await print('esnext');
  let lowered;
  try {
    lowered = await print(target);
  } catch (error) {
    return String(error.message).split('\n')[0];
  }
  if (lowered === esnext) return null;
  const a = esnext.split('\n');
  const b = lowered.split('\n');
  const line = a.findIndex((l, i) => l !== b[i]);
  return `line ${line + 1}: ${a[line]?.trim().slice(0, 160)}`;
}

function scripts(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.m?js$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

const failures = [];

if (!existsSync(join(www, 'index.html'))) {
  console.error('No www/: run `pnpm build:web` in apps/we-mobile first.');
  process.exit(1);
}
if (!existsSync(join(www, ERROR_PAGE_PATH))) failures.push(`no error page at www/${ERROR_PAGE_PATH}`);

/** The scripts a page loads, by the `src` its own HTML names. */
function pageScripts(page) {
  const html = readFileSync(page, 'utf8');
  return [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(([, src]) =>
    src.startsWith('/') ? join(www, src) : join(dirname(page), src),
  );
}

const errorPage = join(www, ERROR_PAGE_PATH);
const errorScripts = existsSync(errorPage) ? pageScripts(errorPage) : [];
if (existsSync(errorPage) && errorScripts.length === 0) failures.push(`no script loaded by www/${ERROR_PAGE_PATH}`);
for (const file of errorScripts) {
  if (!existsSync(file)) failures.push(`www/${ERROR_PAGE_PATH} loads ${relative(app, file)}, which is not there`);
}
for (const file of errorScripts.filter((f) => existsSync(f))) {
  const why = await needsNewer(readFileSync(file, 'utf8'), 'chrome83');
  if (why) failures.push(`${relative(app, file)} does not parse on WebView 83 (${why})`);
}

const weScripts = scripts(www).filter((f) => !errorScripts.includes(f));
for (const file of weScripts) {
  const why = await needsNewer(readFileSync(file, 'utf8'), `chrome${MIN_WEBVIEW_MAJOR}`);
  if (why) failures.push(`${relative(app, file)} needs a WebView newer than ${MIN_WEBVIEW_MAJOR} (${why})`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(
  `WebView floor ${MIN_WEBVIEW_MAJOR}: ${weScripts.length} WE scripts parse there; ` +
    `the error page (${errorScripts.length} script) parses on WebView 83.`,
);
