/**
 * The oldest Android System WebView that runs WE's web build, and what the app's error page says.
 *
 * Capacitor reads the installed WebView's version before it loads anything
 * (`android.minWebViewVersion` in capacitor.config.ts) and, below it, opens `server.errorPath`
 * instead of WE. Without this, an old WebView shows a blank page: WE's bundle does not parse there.
 * The same page is opened when WE's page fails to load, so the page decides from the user agent
 * which of the two it is.
 *
 * ## Why 121
 *
 * Measured by loading WE's build in Chrome for Testing 113, 117, 118, 119, 120, 121, 122 and 156
 * (README.md, "The WebView floor"). WE's design tokens derive the page and surface colours with
 * CSS relative colour syntax (`oklch(from var(--we-role-chrome) calc(l + 0.03) c h)`):
 *
 * - up to 118 the syntax is unknown, and the page background is transparent;
 * - 119 and 120 read `l` on a 0–100 scale, so every derived surface comes out wrong;
 * - from 121 the colours equal 156's.
 *
 * Nothing in the script is newer: from 113 up WE loads without a page error. (Syntax alone needs
 * Chrome 85, logical assignment — WebView 83 stops at `Unexpected token '='` — and the core
 * schema code calls `structuredClone`, Chrome 98.)
 */
export const MIN_WEBVIEW_MAJOR = 121;

/** Where Capacitor opens the error page, relative to `www/`. scripts/assemble-web.mjs builds it. */
export const ERROR_PAGE_PATH = 'mobile/error.html';

/** Android System WebView in the Play Store: what the "update" button opens. */
export const WEBVIEW_STORE_URL = 'https://play.google.com/store/apps/details?id=com.google.android.webview';

/** The Chrome major version in a user agent, or null when it names none (iOS, a non-Chromium engine). */
export function chromeMajor(userAgent: string): number | null {
  const match = /(?:^|[\s(])Chrome\/(\d+)\./.exec(userAgent);
  return match ? Number(match[1]) : null;
}

export type ErrorPageReason =
  /** The WebView is a Chromium older than WE needs. */
  | { kind: 'webview-too-old'; version: number; floor: number }
  /** Anything else that brought the error page up: WE's page did not load. */
  | { kind: 'load-failed' };

/** Why the error page is showing, from the WebView's own user agent. */
export function errorReason(userAgent: string, floor: number = MIN_WEBVIEW_MAJOR): ErrorPageReason {
  const version = chromeMajor(userAgent);
  return version !== null && version < floor ? { kind: 'webview-too-old', version, floor } : { kind: 'load-failed' };
}
