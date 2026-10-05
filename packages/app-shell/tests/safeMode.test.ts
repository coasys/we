/**
 * Safe mode's three doors, and that only a page which died mid-render opens the third.
 *
 * Each case decides afresh, as a new page would: the decision is taken once per page, so the test
 * forgets it between cases and sets up the address and storage the next "page" would find.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginRender,
  installRenderSettleOnExit,
  installSafeModeShortcut,
  resetSafeModeForTests,
  safeMode,
  settleRender,
} from '../src/shared/safeMode';

/** What the next page load would find: an address, and whatever storage this one left. */
function nextPage(path = '/space/abc/posts') {
  resetSafeModeForTests();
  window.history.replaceState({}, '', path);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  nextPage();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the address', () => {
  it('turns safe mode on before anything renders, and takes itself out of the address', () => {
    nextPage('/space/abc/posts?safe&call=1');
    expect(safeMode()).toEqual({ on: true, reason: 'asked', template: '' });
    expect(window.location.pathname + window.location.search).toBe('/space/abc/posts?call=1');
  });

  it('is remembered for the tab, so a reload stays safe', () => {
    nextPage('/?safe');
    expect(safeMode().on).toBe(true);
    nextPage('/space/abc');
    expect(safeMode().on).toBe(true);
  });

  it('is off otherwise', () => {
    expect(safeMode().on).toBe(false);
  });
});

describe('a render that never finished', () => {
  it('starts the next page in safe mode, naming the template', () => {
    beginRender('strangers-template');
    // The page hangs here: no timer fires, nothing is replaced, no pagehide runs.
    nextPage();
    expect(safeMode()).toEqual({ on: true, reason: 'unfinished-render', template: 'strangers-template' });
  });

  it('does not, once the app has stayed responsive with it', () => {
    vi.useFakeTimers();
    beginRender('strangers-template', 1000);
    vi.advanceTimersByTime(1000);
    nextPage();
    expect(safeMode().on).toBe(false);
  });

  it('does not, once it has been replaced — which also takes a live page', () => {
    const settle = beginRender('first');
    settle();
    nextPage();
    expect(safeMode().on).toBe(false);
  });

  it('does not, when the page was left with JavaScript still running', () => {
    const uninstall = installRenderSettleOnExit(window);
    beginRender('strangers-template');
    window.dispatchEvent(new Event('pagehide'));
    uninstall();
    nextPage();
    expect(safeMode().on).toBe(false);
  });

  it('remembers each template on its own, so a quick switch does not hide a hang', () => {
    beginRender('launcher');
    beginRender('strangers-template');
    settleRender('launcher');
    nextPage();
    expect(safeMode().template).toBe('strangers-template');
  });

  it('is a fresh start once safe mode has been entered for it', () => {
    beginRender('strangers-template');
    nextPage();
    expect(safeMode().on).toBe(true);
    sessionStorage.clear();
    nextPage();
    expect(safeMode().on).toBe(false);
  });
});

describe('the key', () => {
  it('is heard on the window before anything below it, and reloads into safe mode', () => {
    const pressed = vi.fn();
    const uninstall = installSafeModeShortcut(window, pressed);
    const field = document.createElement('input');
    document.body.append(field);
    // A component swallowing keys for itself — the case the capture phase exists for.
    field.addEventListener('keydown', (event) => event.stopPropagation());

    field.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 'S', bubbles: true }));
    expect(pressed).not.toHaveBeenCalled();

    field.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'KeyS',
        key: 'Í',
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(pressed).toHaveBeenCalledTimes(1);

    uninstall();
    field.remove();
  });
});
