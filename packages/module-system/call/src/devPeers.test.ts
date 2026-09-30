import { afterEach, describe, expect, it, vi } from 'vitest';

import { devPeers, readDevPeerCount, stopDevPeers, writeDevPeerCount } from './devPeers';

afterEach(() => {
  vi.unstubAllGlobals();
  stopDevPeers();
});

/** A `localStorage` for a Node test run — the only thing standing between this and a real call. */
function stubStorage(value: string | null) {
  const store = new Map<string, string>(value === null ? [] : [['we.call.fakePeers', value]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, next: string) => store.set(key, next),
    removeItem: (key: string) => store.delete(key),
  });
  return store;
}

describe('dev peers', () => {
  it('are off with nothing asking for them', () => {
    // The property that matters most: a developer who has never heard of this must never see it.
    expect(readDevPeerCount()).toBe(0);
    expect(devPeers(0)).toEqual([]);
  });

  it('stay off for a stored value that is not a positive count', () => {
    for (const value of ['0', '-1', 'three', '', null]) {
      stubStorage(value);
      expect(readDevPeerCount()).toBe(0);
    }
  });

  it('are capped, so a stray keypress cannot open a hundred canvases', () => {
    stubStorage('900');
    expect(readDevPeerCount()).toBe(24);
  });

  it('remember the count, and forget it rather than storing a zero', () => {
    // The count survives the reloads a developer does while iterating; turning it off leaves no key
    // behind, so "is this on" has one answer rather than two spellings of off.
    const store = stubStorage(null);
    expect(writeDevPeerCount(3)).toBe(3);
    expect(store.get('we.call.fakePeers')).toBe('3');
    expect(writeDevPeerCount(0)).toBe(0);
    expect(store.has('we.call.fakePeers')).toBe(false);
    // A step below zero clamps rather than going negative — the `−` button is disabled at zero, but
    // the store must not depend on a button to stay sane.
    expect(writeDevPeerCount(-1)).toBe(0);
  });

  it('give each peer a distinct id and alternate the mute badge', () => {
    const peers = devPeers(3);

    expect(peers.map((peer) => peer.id)).toEqual(['fake-peer-0', 'fake-peer-1', 'fake-peer-2']);
    // Alternated so the badge is on screen at any count above one — it is otherwise a state that
    // only appears when a real person happens to be muted.
    expect(peers.map((peer) => peer.audioEnabled)).toEqual([true, false, true]);
    // No canvas in Node, so no stream — and the store renders the avatar fallback, not a black box.
    expect(peers.every((peer) => peer.stream === null)).toBe(true);
  });

  it('stops the canvases it no longer needs when the count drops', () => {
    // Going from five to two must not leave three timers painting for a call nobody can see them
    // in — the `−` button is pressed while watching the stage, so the cost is otherwise invisible.
    stubStorage('5');
    expect(devPeers(5)).toHaveLength(5);
    expect(devPeers(2)).toHaveLength(2);
    expect(devPeers(0)).toEqual([]);
  });
});
