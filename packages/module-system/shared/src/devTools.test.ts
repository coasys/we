/**
 * The switch that hides developer affordances in a build that has them.
 *
 * Two properties matter and they pull in opposite directions, which is why both are pinned: the
 * switch must be able to turn the tools *off* in a dev build, and must not be able to turn them
 * *on* in a production one. A flag that could do the second would be a way to ship developer UI to
 * users through a value anyone can set from a console.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEV_TOOLS_KEY, devToolsEnabled } from './devTools';

/** Stand in for `localStorage`, including the case where reading it throws. */
function stubStorage(value: string | null | (() => never)) {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => {
      if (key !== DEV_TOOLS_KEY) return null;
      if (typeof value === 'function') return value();
      return value;
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('devToolsEnabled', () => {
  it('is on in a dev build with the switch unset', () => {
    stubStorage(null);
    expect(devToolsEnabled(true)).toBe(true);
  });

  it('is off in a dev build with the switch set', () => {
    stubStorage('off');
    expect(devToolsEnabled(true)).toBe(false);
  });

  it('cannot turn the tools on in a production build', () => {
    // The asymmetry, and the reason the build flag is the ceiling rather than one vote of two.
    for (const value of [null, 'off', 'on', 'true']) {
      stubStorage(value);
      expect(devToolsEnabled(false)).toBe(false);
    }
  });

  it('treats anything other than "off" as unset', () => {
    // So a half-remembered value leaves the default rather than silently meaning something.
    for (const value of ['', 'OFF', 'false', 'no', '0']) {
      stubStorage(value);
      expect(devToolsEnabled(true), `${value} should not mute`).toBe(true);
    }
  });

  it('survives storage that throws rather than merely being absent', () => {
    /*
      `localStorage` does not just go missing — a browser set to block site data, or a document with
      no origin, throws on access. Falling back to "not muted" keeps whatever the build already said,
      which is the answer that cannot surprise anyone.
    */
    stubStorage(() => {
      throw new Error('SecurityError');
    });
    expect(devToolsEnabled(true)).toBe(true);
    expect(devToolsEnabled(false)).toBe(false);
  });

  it('works where there is no storage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(devToolsEnabled(true)).toBe(true);
  });
});
