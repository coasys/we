/**
 * The WebView floor: which WebView gets the "update" page, and that Capacitor is configured with the
 * same floor and the same page. User agents are the ones the emulators in README.md report.
 */
import { describe, expect, it } from 'vitest';

import config from '../capacitor.config';
import { errorMessage } from '../src/error/message';
import { chromeMajor, ERROR_PAGE_PATH, errorReason, MIN_WEBVIEW_MAJOR, WEBVIEW_STORE_URL } from '../src/webViewFloor';

/** Android 11's factory WebView (AVD coasys-api30; build id from its system image). */
const WEBVIEW_83 =
  'Mozilla/5.0 (Linux; Android 11; sdk_gphone_x86_64 Build/RSR1.240422.006; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.106 Mobile Safari/537.36';
/** Android 15's (AVD coasys-api35-webview), as its WebView reported it. */
const WEBVIEW_124 =
  'Mozilla/5.0 (Linux; Android 15; sdk_gphone64_x86_64 Build/AE3A.240806.043; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.219 Mobile Safari/537.36';
const IOS_WKWEBVIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

const at = (major: number) => WEBVIEW_124.replace('Chrome/124.', `Chrome/${major}.`);

describe('chromeMajor', () => {
  it('reads the major version an Android WebView reports', () => {
    expect(chromeMajor(WEBVIEW_83)).toBe(83);
    expect(chromeMajor(WEBVIEW_124)).toBe(124);
  });

  it('is null where the user agent names no Chrome', () => {
    expect(chromeMajor(IOS_WKWEBVIEW)).toBeNull();
    expect(chromeMajor('')).toBeNull();
  });

  it('does not read a Chrome version out of another token', () => {
    expect(chromeMajor('Mozilla/5.0 NotChrome/99.0 Safari/537.36')).toBeNull();
  });
});

describe('errorReason', () => {
  it('sends a WebView below the floor to the update page', () => {
    expect(errorReason(WEBVIEW_83)).toEqual({ kind: 'webview-too-old', version: 83, floor: MIN_WEBVIEW_MAJOR });
    expect(errorReason(at(MIN_WEBVIEW_MAJOR - 1))).toMatchObject({ kind: 'webview-too-old' });
  });

  it('treats the floor itself and anything newer as a failed load, not an old WebView', () => {
    expect(errorReason(at(MIN_WEBVIEW_MAJOR))).toEqual({ kind: 'load-failed' });
    expect(errorReason(WEBVIEW_124)).toEqual({ kind: 'load-failed' });
  });

  it('never tells an iOS phone to update an Android WebView', () => {
    expect(errorReason(IOS_WKWEBVIEW)).toEqual({ kind: 'load-failed' });
  });

  it('compares against the floor it is given', () => {
    expect(errorReason(WEBVIEW_124, 125)).toEqual({ kind: 'webview-too-old', version: 124, floor: 125 });
  });
});

describe('errorMessage', () => {
  it('names the installed version and the one WE needs, and links to the WebView in the Play Store', () => {
    const message = errorMessage(errorReason(WEBVIEW_83));
    expect(message.title).toBe('Update Android System WebView');
    expect(message.paragraphs.join(' ')).toContain('version 83');
    expect(message.paragraphs.join(' ')).toContain(`version ${MIN_WEBVIEW_MAJOR} or newer`);
    expect(message.action.href).toBe(WEBVIEW_STORE_URL);
  });

  it('offers to load WE again when the WebView is new enough', () => {
    const message = errorMessage(errorReason(WEBVIEW_124));
    expect(message.title).toBe('Coasys didn’t load');
    expect(message.action).toEqual({ label: 'Try again', href: '/' });
  });
});

describe('capacitor.config', () => {
  it('holds Capacitor to the same floor, and opens the same page below it', () => {
    expect(config.android?.minWebViewVersion).toBe(MIN_WEBVIEW_MAJOR);
    expect(config.server?.errorPath).toBe(ERROR_PAGE_PATH);
  });

  it('keeps the app id and name', () => {
    expect(config.appId).toBe('org.coasys.app');
    expect(config.appName).toBe('Coasys');
  });
});
