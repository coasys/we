/**
 * Seeded peers — other agents' profiles, and other agents being present.
 *
 * Both exist for the same reason: this backend runs one agent, so anything rendering *people*
 * degenerates to a column of one. A feed with a single author and a presence roster containing only
 * yourself both render correctly and show nothing about whether the design holds up, which makes
 * them useless as the subject of a screenshot.
 *
 * The two halves are genuinely different seams. A profile is a *read* the directory serves, and it
 * cannot be published because `publish` writes only `ctx.selfId()` — as the real directory does.
 * Presence is a *message*, so it has to arrive over the bus the way a heartbeat would, and keep
 * arriving, because presence ages itself out on a TTL by design.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getModel } from '@we/models';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const ME = 'did:test:me';
const ADA = 'did:test:ada';
const BO = 'did:test:bo';

const PROFILES = [
  { did: ADA, firstName: 'Ada', lastName: 'Lovelace', handle: 'ada', bio: 'notes', avatar: 'inmemory://ada.png' },
  { did: BO, firstName: 'Bo', lastName: 'Diddley', handle: 'bo', bio: '' },
];

function makePorts(extra: Parameters<typeof createInMemoryBackendPorts>[1] = {}) {
  return createInMemoryBackendPorts(
    { selfId: () => ME },
    { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-main', name: 'Main' }], ...extra },
  );
}

describe('seeded profiles', () => {
  it('serves a seeded peer, and still blanks an unknown one', async () => {
    const ports = makePorts({ profiles: PROFILES });

    expect(await ports.profiles.get(ADA)).toMatchObject({ did: ADA, firstName: 'Ada', handle: 'ada' });
    // Unseeded agents keep the existing behaviour — a blank record, never a throw, because a
    // profile that has not arrived yet is the normal case in a real directory too.
    expect(await ports.profiles.get('did:test:nobody')).toEqual({
      did: 'did:test:nobody',
      firstName: '',
      lastName: '',
      handle: '',
      bio: '',
    });
  });

  it('leaves publish writing only the self profile', async () => {
    const ports = makePorts({ profiles: PROFILES });

    await ports.profiles.publish({ firstName: 'Me' });

    expect(await ports.profiles.get(ME)).toMatchObject({ firstName: 'Me' });
    // The seam exists precisely because this is impossible: publishing must not be able to
    // overwrite somebody else, here or in the real directory.
    expect(await ports.profiles.get(ADA)).toMatchObject({ firstName: 'Ada' });
  });

  it('is absent by default, so nothing changes for callers that do not ask', async () => {
    expect(await makePorts().profiles.get(ADA)).toMatchObject({ firstName: '', handle: '' });
  });
});

describe('seeded presence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const PEERS = [
    { did: ADA, availability: 'available' as const, focus: { datasetUri: 'inmemory://ds-main', path: '/channel/1' } },
    { did: BO, availability: 'available' as const, focus: { datasetUri: 'inmemory://ds-main' } },
  ];

  async function subscribe(ports: ReturnType<typeof makePorts>) {
    const dataset = (await ports.lifecycle.get('ds-main'))!;
    const scope = ports.ephemeral(dataset.handle)!;
    const received: Array<{ from: string; payload: unknown }> = [];
    scope.channel('presence').onMessage((from, payload) => received.push({ from, payload }));
    return { scope, received };
  }

  it('announces each peer as itself, with a stamped heartbeat', async () => {
    const ports = makePorts({ presence: PEERS });
    const { received } = await subscribe(ports);

    // A subscriber always attaches after the scope it subscribes through exists, so the roster is
    // empty for up to one beat. That gap is the reason the interval is 1s rather than the app's 5s.
    expect(received).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(received.map((r) => r.from)).toEqual([ADA, BO]);
    expect(received[0].payload).toMatchObject({
      agentId: ADA,
      availability: 'available',
      focus: { datasetUri: 'inmemory://ds-main', path: '/channel/1' },
    });
    expect((received[0].payload as { updatedAt: number }).updatedAt).toBeTypeOf('number');
  });

  it('keeps beating, because presence ages itself out', async () => {
    const ports = makePorts({ presence: PEERS });
    const { received } = await subscribe(ports);

    await vi.advanceTimersByTimeAsync(3_000);

    // Two peers, three beats. A one-shot announcement would leave the roster emptying itself on the
    // liveness TTL, so a screenshot's contents would depend on when it was taken.
    expect(received).toHaveLength(6);
    expect(new Set(received.map((r) => r.from))).toEqual(new Set([ADA, BO]));
  });

  it('runs one beat per dataset, and stops it only when the last scope goes', async () => {
    const ports = makePorts({ presence: PEERS });
    const dataset = (await ports.lifecycle.get('ds-main'))!;

    const before = vi.getTimerCount();
    const first = ports.ephemeral(dataset.handle)!;
    const second = ports.ephemeral(dataset.handle)!;

    // Two scopes over one dataset share a single heartbeat — peers are a property of the dataset,
    // not of who is watching it.
    expect(vi.getTimerCount()).toBe(before + 1);

    first.dispose();
    expect(vi.getTimerCount()).toBe(before + 1);

    second.dispose();
    // Asserted on the timer rather than on delivery, because the bus's `dispose` unsubscribes by
    // *agent*, not by scope: both scopes here share `ctx.selfId()`, so the first dispose already
    // removed the second's listener. A leaked interval keeps a vitest run alive forever, which is a
    // worse failure than the empty roster this whole seam exists to fix.
    expect(vi.getTimerCount()).toBe(before);
  });

  it('does not touch the bus when no peers are seeded', async () => {
    const ports = makePorts();
    const { received } = await subscribe(ports);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(received).toEqual([]);
  });
});

describe('scope drill-down', () => {
  it('returns one container\'s children, not the whole table', async () => {
    const ports = makePorts();
    const dataset = (await ports.lifecycle.get('ds-main'))!;
    const handle = dataset.handle;

    const CollectionBlock = getModel('CollectionBlock') as unknown as {
      create(h: unknown, d: Record<string, unknown>): Promise<{ id: string; addChildren(x: unknown): Promise<void> }>;
      findAll(h: unknown, q?: Record<string, unknown>): Promise<Array<{ id: string }>>;
    };

    const channelA = await CollectionBlock.create(handle, { id: 'a', kind: 'channel', title: 'a' });
    const channelB = await CollectionBlock.create(handle, { id: 'b', kind: 'channel', title: 'b' });
    const inA = await CollectionBlock.create(handle, { id: 'a1', kind: 'message' });
    const inB = await CollectionBlock.create(handle, { id: 'b1', kind: 'message' });
    await channelA.addChildren(inA);
    await channelB.addChildren(inB);

    const scoped = await CollectionBlock.findAll(handle, {
      where: { kind: 'message' },
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: 'a' },
    });

    // The adapter used to declare `scope: false`, so this query lowered without it and answered a
    // different question — every message in the space, in every channel.
    expect(scoped.map((r) => r.id)).toEqual(['a1']);
  });
});
