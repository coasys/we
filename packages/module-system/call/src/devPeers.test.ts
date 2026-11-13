import { afterEach, describe, expect, it, vi } from 'vitest';

import { devPeers, readDevPeerCount, stopDevPeers, writeDevPeerCount } from './devPeers';

afterEach(() => {
  vi.unstubAllGlobals();
  stopDevPeers();
  writeDevPeerCount(0);
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

  it('read a stored count from an older version as nothing', () => {
    /*
      The trap this file no longer lays: `we.call.fakePeers` used to persist, so a count set while
      debugging one space walked into the next call in any other — existing spaces and new ones
      alike inherited it. In memory, a reload is the way out; the stored key is simply never read.
    */
    for (const value of ['7', '0', '-1', 'three', '', null]) {
      stubStorage(value);
      expect(readDevPeerCount()).toBe(0);
      writeDevPeerCount(0);
    }
  });

  it('are capped, so a stray keypress cannot open a hundred canvases', () => {
    expect(writeDevPeerCount(900)).toBe(24);
  });

  it('hold the count for the session, writing nothing anywhere', () => {
    // The count is a session's, not a machine's — see the test above for why storage is a trap.
    const store = stubStorage(null);
    expect(writeDevPeerCount(3)).toBe(3);
    expect(readDevPeerCount()).toBe(3);
    expect([...store.keys()].filter((key) => key.includes('fakePeers'))).toEqual([]);
    // A step below zero clamps rather than going negative — the `−` button is disabled at zero, but
    // the store must not depend on a button to stay sane.
    expect(writeDevPeerCount(-1)).toBe(0);
  });

  it('stop answering while the developer-tools switch is off', () => {
    /*
      The switch muted mid-call used to hide only the controls: `readDevPeerCount` gated on it once,
      at store creation, so peers already counted stayed on stage with no way to be removed. The
      gate is inside `devPeers` now, where every rebuild re-asks it.
    */
    const store = stubStorage(null);
    store.set('we.devTools', 'off');
    expect(devPeers(3)).toEqual([]);
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
    expect(devPeers(5)).toHaveLength(5);
    expect(devPeers(2)).toHaveLength(2);
    expect(devPeers(0)).toEqual([]);
  });
});
