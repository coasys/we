/**
 * The switch that hides developer affordances in a build that has them.
 *
 * Two properties matter and they pull in opposite directions, which is why both are pinned: the
 * switch must be able to turn the tools *off* in a dev build, and must not be able to turn them
 * *on* in a production one. A flag that could do the second would be a way to ship developer UI to
 * users through a value anyone can set from a console.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEV_TOOLS_KEY, devToolsEnabled, setDevToolsMuted } from './devTools';

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

/** A storage that actually remembers, so a write can be read back through the public reader. */
function stubLiveStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  return store;
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

describe('setDevToolsMuted', () => {
  it('round-trips through the reader, in both directions', () => {
    // The property that matters is not what lands in storage, it is that the switch is *restorable*.
    // A mute that could not be undone would make Settings → Developer a one-way door.
    stubLiveStorage();
    setDevToolsMuted(true);
    expect(devToolsEnabled(true)).toBe(false);
    setDevToolsMuted(false);
    expect(devToolsEnabled(true)).toBe(true);
  });

  it('stores nothing at all when unmuted, rather than a second spelling of the default', () => {
    /*
      Two states, not three. Storing "on" would leave a value that means "the default as it was the
      day this was written" — so a later change to what unset means would silently skip everyone who
      had ever touched the switch.
    */
    const store = stubLiveStorage();
    setDevToolsMuted(true);
    expect(store.get(DEV_TOOLS_KEY)).toBe('off');
    setDevToolsMuted(false);
    expect(store.has(DEV_TOOLS_KEY)).toBe(false);
  });

  it('cannot unmute its way into developer UI in a production build', () => {
    // The ceiling again, from the writing side: the stored preference is not a second vote.
    stubLiveStorage();
    setDevToolsMuted(false);
    expect(devToolsEnabled(false)).toBe(false);
  });

  it('survives storage that throws on write', () => {
    // Same class of failure as a read that throws — the preference does not persist, and that is
    // all. The caller's own signal still flips for the session.
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(() => setDevToolsMuted(true)).not.toThrow();
    expect(() => setDevToolsMuted(false)).not.toThrow();
  });
});
