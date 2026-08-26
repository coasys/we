/**
 * Which spaces presence beats into, and what happens to the sources already running.
 *
 * The rules exist for one reason: presence *is* a call's roster, so a source that stops takes the
 * call down with it. Every case below is really the same question asked at a different moment —
 * "does the call's space keep its source?"
 */
import type { Peer } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { MAX_LEASES, reconcileLeases, unionPeers, wantedUris } from '../src/shared/presenceScope';

const HOME = 'neighbourhood://home';
const CALL = 'neighbourhood://call-space';
const OTHER = 'neighbourhood://other';

const peer = (agentId: string, updatedAt: number): Peer =>
  ({ agentId, updatedAt, availability: 'available', liveness: 'online' }) as Peer;

describe('wantedUris', () => {
  it('wants the space on screen', () => {
    expect(wantedUris(HOME, [])).toEqual([HOME]);
  });

  it('keeps wanting the space a call is in after navigating elsewhere', () => {
    // The case the whole change exists for. Before it, leaving `CALL` stopped its source, which
    // broadcast a `bye` and emptied the roster the mesh reconciles against.
    expect(wantedUris(OTHER, [CALL])).toEqual([OTHER, CALL]);
  });

  it('does not want the same space twice while standing in the call', () => {
    // Otherwise the ordinary case — being in the space you are calling from — would open two sources
    // for one space, and this agent would be publishing over itself.
    expect(wantedUris(CALL, [CALL])).toEqual([CALL]);
  });

  it('wants nothing in a space with no neighbourhood', () => {
    // A personal space has no uri to scope, and the app has none at all before the first switch.
    expect(wantedUris(undefined, [])).toEqual([]);
  });

  it('puts the space on screen first, so a pinned one is what a ceiling would refuse', () => {
    expect(wantedUris(HOME, [CALL])[0]).toBe(HOME);
  });
});

describe('reconcileLeases', () => {
  it('leaves a source that is still wanted strictly alone', () => {
    // The heart of it: navigating from the call's space to another must not restart the call's
    // source. Restarting it is indistinguishable, to peers, from leaving and rejoining mid-call.
    const { open, close } = reconcileLeases([CALL], [OTHER, CALL]);
    expect(close).toEqual([]);
    expect(open).toEqual([OTHER]);
  });

  it('closes a source nothing wants any more', () => {
    // Hanging up: the activity goes, so the pin goes, so the source goes.
    const { open, close } = reconcileLeases([OTHER, CALL], [OTHER]);
    expect(close).toEqual([CALL]);
    expect(open).toEqual([]);
  });

  it('swaps sources when moving between spaces with nothing live', () => {
    const { open, close } = reconcileLeases([HOME], [OTHER]);
    expect(close).toEqual([HOME]);
    expect(open).toEqual([OTHER]);
  });

  it('asks for nothing when nothing changed', () => {
    const { open, close, refused } = reconcileLeases([HOME, CALL], [HOME, CALL]);
    expect({ open, close, refused }).toEqual({ open: [], close: [], refused: [] });
  });

  it('counts the sources it is about to close against the ceiling', () => {
    // Otherwise a swap at the ceiling refuses the new space while the old one is on its way out,
    // and presence would simply stop following the user at the exact moment it looks broken.
    const running = Array.from({ length: MAX_LEASES }, (_, i) => `neighbourhood://s${i}`);
    const wanted = [OTHER, ...running.slice(1)];
    const { open, refused } = reconcileLeases(running, wanted);
    expect(open).toEqual([OTHER]);
    expect(refused).toEqual([]);
  });

  it('refuses past the ceiling rather than beating into everything', () => {
    const running = Array.from({ length: MAX_LEASES }, (_, i) => `neighbourhood://s${i}`);
    const { open, refused } = reconcileLeases(running, [...running, OTHER]);
    expect(open).toEqual([]);
    expect(refused).toEqual([OTHER]);
  });
});

describe('unionPeers', () => {
  it('combines what every source can see', () => {
    const union = unionPeers({ [HOME]: [peer('a', 1)], [CALL]: [peer('b', 1)] });
    expect(union.map((p) => p.agentId).sort()).toEqual(['a', 'b']);
  });

  it('shows a person once when two sources can both see them', () => {
    // Someone in the call who has also wandered into the space you are looking at. Two reports of
    // one agent's state, not two people.
    const union = unionPeers({ [HOME]: [peer('a', 10)], [CALL]: [peer('a', 20)] });
    expect(union).toHaveLength(1);
    // The later beat wins — the reports are the same state seen through different channels, so the
    // fresher one is simply more current. Picking arbitrarily would flicker their liveness.
    expect(union[0].updatedAt).toBe(20);
  });

  it('is empty when no source is running', () => {
    expect(unionPeers({})).toEqual([]);
  });
});
