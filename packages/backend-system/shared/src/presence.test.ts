import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Activity,
  applyFocusDepth,
  callRosters,
  createHeartbeatPresence,
  DEFAULT_THRESHOLDS,
  derivePeers,
  type Peer,
  peersInDataset,
  peersMatching,
  peerTone,
  type PresenceChannel,
  type PresenceState,
  sortByPresence,
} from './presence';

const SPACE = 'neighbourhood://QmSpace';

function state(agentId: string, overrides: Partial<PresenceState> = {}): PresenceState {
  return {
    agentId,
    updatedAt: 0,
    availability: 'available',
    focus: { datasetUri: SPACE, path: '/kanban' },
    ...overrides,
  };
}

/**
 * A fan-out channel with no transport. `deliver` plays a message into every subscriber except the
 * named sender, which is what a real broadcast does (AD4M's `sendBroadcastU` does not loop back).
 */
function createFakeChannel() {
  const subscribers: Array<(from: string, payload: unknown) => void> = [];
  const published: unknown[] = [];
  return {
    published,
    channel: {
      publish: (payload: unknown) => published.push(payload),
      onMessage: (cb) => {
        subscribers.push(cb);
        return () => {
          const i = subscribers.indexOf(cb);
          if (i !== -1) subscribers.splice(i, 1);
        };
      },
    } satisfies PresenceChannel,
    deliver(from: string, payload: unknown) {
      subscribers.forEach((cb) => cb(from, payload));
    },
  };
}

describe('derivePeers', () => {
  it('maps age onto the liveness ladder', () => {
    const now = 100_000;
    const peers = derivePeers(
      [
        state('online', { updatedAt: now - 1_000 }),
        state('idle', { updatedAt: now - 20_000 }),
        state('stale', { updatedAt: now - 45_000 }),
        state('offline', { updatedAt: now - 120_000 }),
      ],
      now,
    );
    expect(peers.map((p) => [p.agentId, p.liveness])).toEqual([
      ['online', 'online'],
      ['idle', 'idle'],
      ['stale', 'stale'],
      ['offline', 'offline'],
    ]);
  });

  it('evicts past evictAfter rather than keeping them forever', () => {
    const now = 1_000_000;
    const peers = derivePeers(
      [state('recent', { updatedAt: now - 1_000 }), state('ancient', { updatedAt: now - 600_000 })],
      now,
    );
    expect(peers.map((p) => p.agentId)).toEqual(['recent']);
  });

  it('is pure — same inputs, same output', () => {
    const input = [state('a', { updatedAt: 90_000 })];
    expect(derivePeers(input, 100_000)).toEqual(derivePeers(input, 100_000));
    expect(input[0].updatedAt).toBe(90_000);
  });

  it('treats boundaries as exclusive-below', () => {
    const now = 0;
    const at = (age: number) => derivePeers([state('a', { updatedAt: -age })], now)[0]?.liveness;
    expect(at(DEFAULT_THRESHOLDS.idleAfter - 1)).toBe('online');
    expect(at(DEFAULT_THRESHOLDS.idleAfter)).toBe('idle');
    expect(at(DEFAULT_THRESHOLDS.staleAfter)).toBe('stale');
    expect(at(DEFAULT_THRESHOLDS.offlineAfter)).toBe('offline');
    expect(at(DEFAULT_THRESHOLDS.evictAfter)).toBeUndefined();
  });
});

describe('applyFocusDepth', () => {
  const focus = { datasetUri: SPACE, path: '/budget', nodeId: 'post-1' };

  it('discloses progressively', () => {
    expect(applyFocusDepth(focus, 'off')).toBeUndefined();
    expect(applyFocusDepth(focus, 'space')).toEqual({ datasetUri: SPACE });
    expect(applyFocusDepth(focus, 'route')).toEqual({ datasetUri: SPACE, path: '/budget' });
    expect(applyFocusDepth(focus, 'precise')).toEqual(focus);
  });

  it('never leaks a deeper field than the depth allows', () => {
    expect(applyFocusDepth(focus, 'space')).not.toHaveProperty('path');
    expect(applyFocusDepth(focus, 'route')).not.toHaveProperty('nodeId');
  });
});

describe('selectors', () => {
  const now = 0;
  const peers: Peer[] = derivePeers(
    [
      state('here', { focus: { datasetUri: SPACE, path: '/kanban', nodeId: 'card-1' } }),
      state('elsewhere-in-space', { focus: { datasetUri: SPACE, path: '/docs' } }),
      state('other-space', { focus: { datasetUri: 'neighbourhood://QmOther', path: '/kanban' } }),
      state('gone', { updatedAt: -90_000, focus: { datasetUri: SPACE, path: '/kanban' } }),
    ],
    now,
  );

  it('slices by dataset, path, and node from one hierarchical focus', () => {
    expect(peersInDataset(peers, SPACE).map((p) => p.agentId)).toEqual(['here', 'elsewhere-in-space']);
    expect(peersMatching(peers, { datasetUri: SPACE, path: '/kanban' }).map((p) => p.agentId)).toEqual(['here']);
    expect(peersMatching(peers, { datasetUri: SPACE, nodeId: 'card-1' }).map((p) => p.agentId)).toEqual(['here']);
  });

  it('does not union the same route path across different spaces', () => {
    // Two spaces can both have a "/kanban" — matching a path without its dataset is a real bug.
    expect(peersMatching(peers, { path: '/kanban' }).map((p) => p.agentId)).toEqual(['here', 'other-space']);
    expect(peersMatching(peers, { datasetUri: SPACE, path: '/kanban' }).map((p) => p.agentId)).toEqual(['here']);
  });

  it('excludes offline peers unless asked', () => {
    const at = (includeOffline?: boolean) =>
      peersMatching(peers, { datasetUri: SPACE, path: '/kanban' }, includeOffline).map((p) => p.agentId);
    expect(at()).not.toContain('gone');
    expect(at(true)).toContain('gone');
  });
});

describe('peerTone', () => {
  const at = (age: number, overrides: Partial<PresenceState> = {}) =>
    peerTone(derivePeers([state('a', { ...overrides, updatedAt: -age })], 0)[0]);

  it('colours by liveness — green active, amber idle, red stale', () => {
    expect(at(0)).toBe('success');
    expect(at(DEFAULT_THRESHOLDS.idleAfter)).toBe('warning');
    expect(at(DEFAULT_THRESHOLDS.staleAfter)).toBe('danger');
  });

  it('does not yet vary with declared availability', () => {
    // Nothing can set availability today, so showing it would be dead weight. Recorded as a test so
    // that when the control lands, deciding how the two axes combine is a deliberate change here
    // rather than an accident.
    for (const availability of ['available', 'away', 'busy'] as const) {
      expect(at(0, { availability })).toBe('success');
    }
  });
});

describe('sortByPresence', () => {
  it('puts the most present first', () => {
    const peers = derivePeers(
      [
        state('stale', { updatedAt: -DEFAULT_THRESHOLDS.staleAfter }),
        state('online', { updatedAt: 0 }),
        state('idle', { updatedAt: -DEFAULT_THRESHOLDS.idleAfter }),
      ],
      0,
    );
    expect(sortByPresence(peers).map((p) => p.agentId)).toEqual(['online', 'idle', 'stale']);
  });

  it('orders equal-liveness peers stably, so the row does not reshuffle every heartbeat', () => {
    // Peers arrive from a Map, so without a tiebreak their order follows insertion and a settled
    // group of people appears to churn on each beat.
    const forward = derivePeers([state('c'), state('a'), state('b')], 0);
    const backward = derivePeers([state('b'), state('c'), state('a')], 0);

    expect(sortByPresence(forward).map((p) => p.agentId)).toEqual(['a', 'b', 'c']);
    expect(sortByPresence(backward).map((p) => p.agentId)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate its input', () => {
    const peers = derivePeers([state('b'), state('a')], 0);
    const before = peers.map((p) => p.agentId);
    sortByPresence(peers);
    expect(peers.map((p) => p.agentId)).toEqual(before);
  });
});

describe('callRosters', () => {
  it('groups concurrent calls by id — something a single callRoute field cannot express', () => {
    const call = (id: string): Activity => ({ type: 'call', id });
    const peers = derivePeers(
      [
        state('a', { activities: [call('c1')] }),
        state('b', { activities: [call('c1')] }),
        state('c', { activities: [call('c2')] }),
        state('d', { activities: [] }),
      ],
      0,
    );
    const rosters = callRosters(peers);
    expect(rosters.get('c1')?.map((p) => p.agentId)).toEqual(['a', 'b']);
    expect(rosters.get('c2')?.map((p) => p.agentId)).toEqual(['c']);
    expect(rosters.size).toBe(2);
  });

  it('keeps a peer in a call regardless of where their focus is', () => {
    const peers = derivePeers(
      [
        state('on-kanban', { focus: { datasetUri: SPACE, path: '/kanban' }, activities: [{ type: 'call', id: 'c1' }] }),
        state('on-docs', { focus: { datasetUri: SPACE, path: '/docs' }, activities: [{ type: 'call', id: 'c1' }] }),
      ],
      0,
    );
    // The point of activities-not-routes: navigating away does not leave the call.
    expect(callRosters(peers).get('c1')).toHaveLength(2);
    expect(peersMatching(peers, { datasetUri: SPACE, path: '/kanban' })).toHaveLength(1);
  });
});

describe('createHeartbeatPresence', () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 0;
    vi.useFakeTimers();
  });

  function start(overrides: Partial<PresenceState> = {}) {
    const fake = createFakeChannel();
    const source = createHeartbeatPresence(fake.channel, { now });
    source.start(state('me', overrides));
    return { ...fake, source };
  }

  it('sends a hello on start so peers re-announce', () => {
    const { published } = start();
    expect(published).toEqual([{ v: 1, state: expect.objectContaining({ agentId: 'me' }), hello: true }]);
  });

  it('repeats the handshake while nobody answers', () => {
    // The transport is best-effort: `sendBroadcastU` acks the send, never the delivery, and two
    // peers still discovering each other exchange nothing at all. One lost hello used to cost a full
    // heartbeat interval of looking at an empty space, which is the intermittent, asymmetric,
    // impossible-to-reproduce delay — loss is independent per direction.
    const { published } = start();
    expect(published).toHaveLength(1);

    clock += 1_000;
    vi.advanceTimersByTime(1_000);
    expect(published).toHaveLength(2);
    expect(published.every((message) => (message as { hello?: true }).hello)).toBe(true);

    // Bounded — one repeat, not a poll. The next solicitation is the ordinary heartbeat, which is
    // the mechanism that covers the long tail.
    clock += 3_000;
    vi.advanceTimersByTime(3_000);
    expect(published).toHaveLength(2);
  });

  it('keeps soliciting on the heartbeat while it has no peers', () => {
    // Recovery, not startup. A remote executor's client backs its reconnect off to thirty seconds,
    // and an agent that comes back with an empty peer map would otherwise wait passively for
    // everyone else's next beat. A beat that asks costs exactly what a beat that announces costs.
    const { published } = start();
    // Past the one handshake repeat, so what is left is the heartbeat.
    clock += 1_000;
    vi.advanceTimersByTime(1_000);
    published.length = 0;

    // A full interval from the repeat, not from start: publishing pushes the next tick out, which is
    // the adaptive scheduling that stops a state change and a beat landing on top of each other.
    clock += 5_000;
    vi.advanceTimersByTime(5_000);

    expect(published).toHaveLength(1);
    expect(published[0]).toHaveProperty('hello', true);
  });

  it('goes back to a plain beat once somebody is there', () => {
    const { published, deliver } = start();
    deliver('peer', { v: 1, state: state('peer') });
    published.length = 0;

    clock += 5_000;
    vi.advanceTimersByTime(5_000);

    expect(published).toHaveLength(1);
    expect(published[0]).not.toHaveProperty('hello');
  });

  it('stops repeating the moment a peer is heard from', () => {
    const { published, deliver } = start();
    published.length = 0;

    deliver('peer', { v: 1, state: state('peer') });
    vi.advanceTimersByTime(5_000);

    // The reply to a non-hello is a notify, not a send, so nothing here should be a handshake.
    expect(published.filter((message) => (message as { hello?: true }).hello)).toHaveLength(0);
  });

  it('sends a state change twice, because losing one costs a whole interval', () => {
    // A lost heartbeat costs nothing — the next carries the same state. A lost *change* leaves every
    // peer displaying the opposite of what is true until the next beat: a muted microphone still
    // showing as live, which reads as lag rather than as loss.
    const { published, source, deliver } = start();
    deliver('peer', { v: 1, state: state('peer') });
    published.length = 0;

    source.setActivity({ type: 'call', id: 'call-1' });
    expect(published).toHaveLength(1);

    clock += 700;
    vi.advanceTimersByTime(700);
    expect(published).toHaveLength(2);

    // One repeat, not a stream of them.
    clock += 5_000;
    vi.advanceTimersByTime(5_000);
    expect(published).toHaveLength(3); // the ordinary beat, on schedule from the repeat
  });

  it('keeps only one pending repeat when changes come in quick succession', () => {
    // Toggling twice must not queue two repeats — last-write-wins, the same rule the transport's
    // coalescing follows.
    const { published, source, deliver } = start();
    deliver('peer', { v: 1, state: state('peer') });
    published.length = 0;

    source.setActivity({ type: 'call', id: 'call-1' });
    clock += 100;
    source.clearActivity('call', 'call-1');
    expect(published).toHaveLength(2); // the two changes themselves

    clock += 700;
    vi.advanceTimersByTime(700);
    expect(published).toHaveLength(3); // one repeat, not two
  });

  it('re-runs the handshake on announce, for a host whose first one never left', () => {
    // A host may gate publishing — WE lets one tab per agent do the talking — and a `hello` sent
    // before that gate opens is gone with nothing to notice or retry it. The driver cannot tell, so
    // the host says when it starts publishing and the handshake runs again. A plain heartbeat would
    // not do: peers answer a `hello`, not a state.
    const { published, source } = start();
    published.length = 0;

    source.announce();

    expect(published).toEqual([{ v: 1, state: expect.objectContaining({ agentId: 'me' }), hello: true }]);
  });

  it('ignores announce before start, so a host may register its callback first', () => {
    // `onBecomeLeader` fires immediately when the tab already leads, which happens before `start`.
    // That firing must do nothing and leave the handshake to `start` itself.
    const fake = createFakeChannel();
    const source = createHeartbeatPresence(fake.channel, { now });

    source.announce();

    expect(fake.published).toEqual([]);
  });

  it('answers a peer hello immediately, without itself saying hello', () => {
    const { deliver, published, source } = start();
    published.length = 0;

    deliver('peer', { v: 1, state: state('peer'), hello: true });

    expect(published).toHaveLength(1);
    expect(published[0]).not.toHaveProperty('hello');
    expect(source.peers().map((p) => p.agentId)).toContain('peer');
  });

  it('heartbeats on the interval', () => {
    // Settled first: a lone agent repeats its handshake until somebody answers, and those repeats
    // are publishes too. Hearing from a peer ends them, which is the state this test is about.
    const { published, deliver } = start();
    deliver('peer', { v: 1, state: state('peer') });
    published.length = 0;

    clock += 5_000;
    vi.advanceTimersByTime(5_000);
    expect(published).toHaveLength(1);

    clock += 5_000;
    vi.advanceTimersByTime(5_000);
    expect(published).toHaveLength(2);
  });

  it('does not double-send when a change already published inside the window', () => {
    const { published, source, deliver } = start();
    // As above: end the handshake repeats so the only publishes here are the ones under test.
    deliver('peer', { v: 1, state: state('peer') });
    published.length = 0;

    clock += 4_000;
    source.update({ focus: { datasetUri: SPACE, path: '/docs' } });
    expect(published).toHaveLength(1); // the change itself

    // Its repeat, in case the first was lost — a separate mechanism, see STATE_CHANGE_ECHO.
    clock += 700;
    vi.advanceTimersByTime(700);
    expect(published).toHaveLength(2);

    // The tick that was due at 5s must wait out a full interval from the last publish, not fire at
    // once — which is the behaviour this test is actually about.
    clock += 300;
    vi.advanceTimersByTime(300);
    expect(published).toHaveLength(2);

    clock += 5_000;
    vi.advanceTimersByTime(5_000);
    expect(published).toHaveLength(3);
  });

  it('stops publishing entirely when invisible, rather than filtering on receipt', () => {
    const { published, source } = start();
    published.length = 0;

    source.update({ availability: 'invisible' });
    clock += 5_000;
    vi.advanceTimersByTime(5_000);
    clock += 5_000;
    vi.advanceTimersByTime(5_000);

    expect(published).toHaveLength(0);
  });

  it('keys peer state by the transport-supplied sender, not the payload', () => {
    const { deliver, source } = start();

    // A peer claiming to be someone else must not be able to write into that agent's slot.
    deliver('actual-sender', { v: 1, state: state('claimed-victim') });

    const ids = source.peers().map((p) => p.agentId);
    expect(ids).toContain('actual-sender');
    expect(ids).not.toContain('claimed-victim');
  });

  it('ignores malformed and unversioned payloads', () => {
    const { deliver, source } = start();
    const before = source.peers().length;

    deliver('peer', null);
    deliver('peer', 'not an object');
    deliver('peer', { v: 2, state: state('peer') });
    deliver('peer', { v: 1 });

    expect(source.peers()).toHaveLength(before);
  });

  it('evicts a peer that stops heartbeating', () => {
    const { deliver, source } = start();
    deliver('peer', { v: 1, state: state('peer') });
    expect(source.peers().map((p) => p.agentId)).toContain('peer');

    clock += DEFAULT_THRESHOLDS.offlineAfter + 1;
    expect(source.peers().find((p) => p.agentId === 'peer')?.liveness).toBe('offline');

    clock += DEFAULT_THRESHOLDS.evictAfter;
    expect(source.peers().map((p) => p.agentId)).not.toContain('peer');
  });

  it('replaces an activity of the same type and id, and clears it on demand', () => {
    const { source } = start();

    source.setActivity({
      type: 'call',
      id: 'c1',
      media: { audioEnabled: true, videoEnabled: false, screenShareEnabled: false },
    });
    source.setActivity({
      type: 'call',
      id: 'c1',
      media: { audioEnabled: false, videoEnabled: true, screenShareEnabled: false },
    });

    const me = () => source.peers().find((p) => p.agentId === 'me')!;
    expect(me().activities).toHaveLength(1);
    expect(me().activities?.[0]).toMatchObject({ media: { videoEnabled: true } });

    source.setActivity({ type: 'call', id: 'c2' });
    expect(me().activities).toHaveLength(2);

    source.clearActivity('call', 'c1');
    expect(me().activities?.map((a) => ('id' in a ? a.id : undefined))).toEqual(['c2']);

    source.clearActivity('call');
    expect(me().activities).toHaveLength(0);
  });

  it('an activity survives a focus change — a call is not a location', () => {
    const { source } = start();
    source.setActivity({ type: 'call', id: 'c1' });
    source.update({ focus: { datasetUri: SPACE, path: '/docs' } });

    const me = source.peers().find((p) => p.agentId === 'me')!;
    expect(me.focus?.path).toBe('/docs');
    expect(me.activities).toHaveLength(1);
  });

  it('announces a departure on stop, so leaving does not look like a crash', () => {
    const { published, source } = start();
    published.length = 0;

    source.stop();

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ v: 1, bye: true });
  });

  it('drops a departing peer at once rather than letting it decay', () => {
    const { deliver, source } = start();
    deliver('peer', { v: 1, state: state('peer') });
    expect(source.peers().map((p) => p.agentId)).toContain('peer');

    deliver('peer', { v: 1, state: state('peer'), bye: true });

    // Not merely 'offline' — gone. Decay is the backstop for a lost bye, not the normal path.
    expect(source.peers().map((p) => p.agentId)).not.toContain('peer');
  });

  it('stays silent on departure when invisible', () => {
    // An invisible agent published nothing, so peers hold no state to retract — and a bye would
    // disclose the departure, and therefore the presence.
    const { published, source } = start({ availability: 'invisible' });
    published.length = 0;

    source.stop();

    expect(published).toHaveLength(0);
  });

  it('stops cleanly and publishes nothing afterwards', () => {
    const { published, source } = start();
    source.stop();
    published.length = 0;

    clock += 60_000;
    vi.advanceTimersByTime(60_000);

    expect(published).toHaveLength(0);
    expect(source.peers()).toEqual([]);
  });
});
