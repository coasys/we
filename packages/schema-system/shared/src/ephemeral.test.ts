import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInMemoryEphemeralPort,
  type EphemeralCapabilities,
  InMemoryBus,
  inMemoryEphemeralCapabilities,
  planEphemeral,
} from './ephemeral';
import { createHeartbeatPresence, type Peer } from './presence';

/** AD4M today: real unicast exists upstream but `sendSignalU` is broken, so the adapter emulates it. */
const ad4m: EphemeralCapabilities = {
  fanout: true,
  unicast: 'emulated',
  reliability: 'send-acked',
  heartbeatRequired: true,
  authenticatedSender: true,
};

/** A server-backed transport (Socket.io, Supabase Realtime): knows who is connected, routes directly. */
const server: EphemeralCapabilities = {
  fanout: true,
  unicast: 'native',
  reliability: 'at-least-once',
  heartbeatRequired: false,
  authenticatedSender: true,
};

/** Yjs awareness: fan-out only, no addressing at all. */
const awareness: EphemeralCapabilities = {
  fanout: true,
  unicast: 'none',
  reliability: 'best-effort',
  heartbeatRequired: true,
  authenticatedSender: false,
};

describe('planEphemeral', () => {
  it('lets presence run on every transport — it only needs fan-out', () => {
    const req = { consumer: 'presence' };
    for (const cap of [ad4m, server, awareness]) {
      expect(planEphemeral(req, cap).runnable).toBe(true);
    }
  });

  it('runs a call module on AD4M, where emulated addressing is good enough for SDP/ICE', () => {
    const plan = planEphemeral({ consumer: 'call module', unicast: 'emulated' }, ad4m);
    expect(plan).toEqual({ runnable: true, gaps: [] });
  });

  it('refuses a call module on a fan-out-only transport instead of hanging on the handshake', () => {
    const plan = planEphemeral({ consumer: 'call module', unicast: 'emulated' }, awareness);
    expect(plan.runnable).toBe(false);
    expect(plan.gaps[0].feature).toBe('unicast');
    expect(plan.gaps[0].note).toContain('call module');
  });

  it('treats native as satisfying a request for emulated, but not the reverse', () => {
    expect(planEphemeral({ consumer: 'c', unicast: 'emulated' }, server).runnable).toBe(true);
    expect(planEphemeral({ consumer: 'c', unicast: 'native' }, ad4m).runnable).toBe(false);
  });

  it('rejects confidential payloads over emulated addressing — addressing is not privacy', () => {
    const plan = planEphemeral({ consumer: 'private notes', unicast: 'emulated', confidential: true }, ad4m);
    expect(plan.runnable).toBe(false);
    expect(plan.gaps.map((g) => g.feature)).toContain('unicast:confidential');
    expect(plan.gaps.find((g) => g.feature === 'unicast:confidential')?.note).toContain('not privacy');
  });

  it('allows confidential payloads only over native unicast', () => {
    expect(planEphemeral({ consumer: 'private notes', confidential: true }, server).runnable).toBe(true);
  });

  it('refuses to act on sender identity when the sender is self-asserted', () => {
    const req = { consumer: 'work lease', requiresAuthenticatedSender: true };
    expect(planEphemeral(req, ad4m).runnable).toBe(true);
    const plan = planEphemeral(req, awareness);
    expect(plan.runnable).toBe(false);
    expect(plan.gaps[0].feature).toBe('authenticatedSender');
  });

  it('reports every unmet requirement at once, not just the first', () => {
    const plan = planEphemeral(
      { consumer: 'everything', unicast: 'native', confidential: true, requiresAuthenticatedSender: true },
      awareness,
    );
    expect(plan.gaps.map((g) => g.feature).sort()).toEqual(['authenticatedSender', 'unicast', 'unicast:confidential']);
  });
});

describe('createInMemoryEphemeralPort', () => {
  const DATASET = { id: 'space-1' };

  function ports(bus: InMemoryBus, ...agentIds: string[]) {
    return agentIds.map((id) => createInMemoryEphemeralPort(bus, id)(DATASET)!);
  }

  it('fans out to every other agent, never back to the sender', () => {
    const bus = new InMemoryBus();
    const [a, b, c] = ports(bus, 'a', 'b', 'c');
    const seen: Array<[string, unknown]> = [];

    a.channel('t').onMessage((from, p) => seen.push(['a', `${from}:${p}`]));
    b.channel('t').onMessage((from, p) => seen.push(['b', `${from}:${p}`]));
    c.channel('t').onMessage((from, p) => seen.push(['c', `${from}:${p}`]));

    a.channel('t').publish('hi');

    expect(seen).toEqual([
      ['b', 'a:hi'],
      ['c', 'a:hi'],
    ]);
  });

  it('delivers a unicast to exactly one peer — the branch AD4M can only emulate', () => {
    const bus = new InMemoryBus();
    const [a, b, c] = ports(bus, 'a', 'b', 'c');
    const seen: string[] = [];
    b.channel('t').onMessage(() => seen.push('b'));
    c.channel('t').onMessage(() => seen.push('c'));

    a.channel('t').publish('secret', { agentId: 'c' });

    expect(seen).toEqual(['c']);
  });

  it('keeps tags isolated, so two protocols cannot see each other', () => {
    const bus = new InMemoryBus();
    const [a, b] = ports(bus, 'a', 'b');
    const presence: unknown[] = [];
    const rtc: unknown[] = [];
    b.channel('presence').onMessage((_f, p) => presence.push(p));
    b.channel('rtc').onMessage((_f, p) => rtc.push(p));

    a.channel('presence').publish('beat');
    a.channel('rtc').publish('offer');

    expect(presence).toEqual(['beat']);
    expect(rtc).toEqual(['offer']);
  });

  it('keeps datasets isolated, so a space cannot hear another space', () => {
    const bus = new InMemoryBus();
    const other = { id: 'space-2' };
    const a = createInMemoryEphemeralPort(bus, 'a')(DATASET)!;
    const bHere = createInMemoryEphemeralPort(bus, 'b')(DATASET)!;
    const bThere = createInMemoryEphemeralPort(bus, 'b')(other)!;
    const here: unknown[] = [];
    const there: unknown[] = [];
    bHere.channel('t').onMessage((_f, p) => here.push(p));
    bThere.channel('t').onMessage((_f, p) => there.push(p));

    a.channel('t').publish('for-space-1');

    expect(here).toEqual(['for-space-1']);
    expect(there).toEqual([]);
  });

  it('returns the same channel for a repeated tag, as the contract promises', () => {
    const bus = new InMemoryBus();
    const [a] = ports(bus, 'a');
    expect(a.channel('t')).toBe(a.channel('t'));
  });

  it('stops delivering after dispose', () => {
    const bus = new InMemoryBus();
    const [a, b] = ports(bus, 'a', 'b');
    const seen: unknown[] = [];
    b.channel('t').onMessage((_f, p) => seen.push(p));

    b.dispose();
    a.channel('t').publish('gone');

    expect(seen).toEqual([]);
  });
});

describe('presence over a second backend', () => {
  // The point of this block: presence is exercised end-to-end against a backend that shares no code
  // and no assumptions with AD4M — native unicast instead of emulated, at-least-once instead of
  // send-acked, no heartbeat requirement. If the seam were in the wrong place, it would show here.
  const DATASET = { id: 'space-1' };

  beforeEach(() => vi.useFakeTimers());

  function agent(bus: InMemoryBus, agentId: string, now: () => number) {
    const scope = createInMemoryEphemeralPort(bus, agentId)(DATASET)!;
    let peers: Peer[] = [];
    const source = createHeartbeatPresence(scope.channel('presence'), {
      now,
      onPeersChanged: (p) => (peers = p),
    });
    return { source, scope, peers: () => peers };
  }

  it('sees a joining peer in one round trip, via the handshake', () => {
    const bus = new InMemoryBus();
    let clock = 0;
    const now = () => clock;

    const a = agent(bus, 'a', now);
    a.source.start({ agentId: 'a', updatedAt: 0, availability: 'available' });

    const b = agent(bus, 'b', now);
    b.source.start({ agentId: 'b', updatedAt: 0, availability: 'available' });

    // No timer advance: b's hello made a re-announce immediately, and both know each other.
    expect(
      b
        .peers()
        .map((p) => p.agentId)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(
      a
        .peers()
        .map((p) => p.agentId)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('drops a departing peer at once via bye', () => {
    const bus = new InMemoryBus();
    let clock = 0;
    const now = () => clock;
    const a = agent(bus, 'a', now);
    const b = agent(bus, 'b', now);
    a.source.start({ agentId: 'a', updatedAt: 0, availability: 'available' });
    b.source.start({ agentId: 'b', updatedAt: 0, availability: 'available' });

    b.source.stop();

    expect(a.peers().map((p) => p.agentId)).toEqual(['a']);
  });

  it('decays a peer that stops beating, with no departure', () => {
    const bus = new InMemoryBus();
    let clock = 0;
    const now = () => clock;
    const a = agent(bus, 'a', now);
    const b = agent(bus, 'b', now);
    a.source.start({ agentId: 'a', updatedAt: 0, availability: 'available' });
    b.source.start({ agentId: 'b', updatedAt: 0, availability: 'available' });

    b.scope.dispose(); // crash: no bye, no further beats
    clock += 45_000;

    expect(a.source.peers().find((p) => p.agentId === 'b')?.liveness).toBe('stale');
  });

  it('admits a consumer needing native unicast that AD4M would refuse', () => {
    // Same requirement, two backends, opposite answers — the capability model doing its job.
    const req = { consumer: 'call module', unicast: 'native' as const, confidential: true };
    expect(planEphemeral(req, inMemoryEphemeralCapabilities).runnable).toBe(true);
    expect(planEphemeral(req, ad4m).runnable).toBe(false);
  });
});
