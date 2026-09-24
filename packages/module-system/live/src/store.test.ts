/**
 * The store, driven through the fakes: a real transport with a second agent on it, a screen a test
 * moves, and presence as a roster it sets.
 *
 * What is worth testing here is the set of decisions a schema could not make. Whether to publish at
 * all — nobody listening means nothing sent, which is the difference between a feature and a permanent
 * cost. Whose messages to act on. What happens when the person you are following goes away. And that
 * switching off says so rather than leaving everybody to a three-second timeout.
 */
import { buildStore, fakeDeps, fakeEphemeral, fakePresence, fakeView } from '@we/module-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { liveModule } from './index';
import { LIVE_PROTOCOL_VERSION } from './protocol';
import type { LiveStore } from './store';

const ME = 'did:test:me';
const ANA = 'did:test:ana';

const WORLD = { surface: 'canvas:c1', kind: 'world' as const, x: 10, y: 20 };

/**
 * A live store with every kernel it declares, plus the test's handles on the other side of each.
 *
 * `buildStore` hands the definition only the kernels its manifest names, exactly as the registry does —
 * so a manifest that forgot one fails here rather than passing and degrading in the app.
 */
function setup(options: { settings?: Record<string, boolean>; dataset?: unknown } = {}) {
  const wire = fakeEphemeral({ self: ME });
  const presence = fakePresence({ self: ME });
  const view = fakeView({ frame: { path: '/space/a/canvas' } });
  const identities = new Map([[ANA, { name: 'Ana', avatar: 'ana.png' }]]);
  const notified: { tone: string; message: string }[] = [];

  const deps = fakeDeps({
    selfId: () => ME,
    dataset: () => (options.dataset === undefined ? (wire.dataset as never) : (options.dataset as never)),
    settings: () => options.settings ?? {},
    identities: { get: (did) => identities.get(did), fetch: () => {} },
    notify: (tone, message) => void notified.push({ tone, message }),
    kernels: { presence: presence.kernel, ephemeral: wire.port, view: view.kernel },
  });

  const store = buildStore(liveModule, deps) as unknown as LiveStore;
  return { store, wire, presence, view, notified, identities };
}

/** What the fake store publishes, as parsed bodies rather than envelopes. */
const published = (wire: ReturnType<typeof fakeEphemeral>) =>
  wire
    .sent('live')
    .map((message) => message.payload as Record<string, unknown>)
    .filter((payload) => payload.kind !== undefined);

beforeEach(() => {
  vi.useRealTimers();
});

describe('what a fresh store leaves running', () => {
  it('leaves no timer behind, because most sessions never switch anything on', () => {
    /*
      A store is constructed once per app whether or not anybody uses the feature, so a timer started
      in the constructor is one every session pays for. It is also a live handle that keeps a Node
      process alive — and `generate-context` builds every module's store to catalogue it, so two
      unconditional intervals turned the whole build into a hang with every file already written. That
      is what this pins.

      Asserted through the environment rather than by inspecting the store, because what went wrong was
      a *handle*, and the store has nothing to say about one.
    */
    const started: unknown[] = [];
    const spy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: never, ms: never) => {
      started.push(ms);
      return 0 as never;
    }) as never);

    setup();
    expect(started).toEqual([]);
    spy.mockRestore();
  });

  it('runs the publish timer only once there is somebody to publish to', () => {
    const started: unknown[] = [];
    const spy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: never, ms: never) => {
      started.push(ms);
      return 0 as never;
    }) as never);

    const { store, presence } = setup();
    // Switched on with nobody watching: still nothing to send, so still nothing ticking.
    store.toggleCursors();
    expect(started).toEqual([]);

    presence.publish(ANA, { type: 'live', cursors: true });
    store.toggleCursors();
    store.toggleCursors();
    expect(started.length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});

describe('switching cursors on', () => {
  it('tells peers, so they know there is somebody to publish to', () => {
    const { store, presence } = setup();
    expect(store.cursorsOn()).toBe(false);

    store.toggleCursors();
    expect(store.cursorsOn()).toBe(true);
    // The activity is the whole handshake: it expires on presence's own TTL, so a laptop that closes
    // stops being published to without anybody sending a leave.
    expect(presence.published.at(-1)).toEqual({ type: 'live', cursors: true });
  });

  it('says so on the way out rather than leaving peers to the timeout', () => {
    const { store, presence, wire } = setup();
    store.toggleCursors();
    store.toggleCursors();

    expect(store.cursorsOn()).toBe(false);
    expect(presence.cleared.at(-1)).toMatchObject({ type: 'live' });
    // Three seconds of a cursor that is no longer being updated is three seconds of a lie.
    expect(published(wire).at(-1)).toMatchObject({ kind: 'cursor', at: null });
  });

  it('refuses where the space has switched them off, and says why', () => {
    const { store } = setup({ settings: { cursors: false } });
    store.toggleCursors();
    expect(store.cursorsOn()).toBe(false);
    expect(store.canShareCursors()).toBe(false);
    expect(store.problem()).toContain('switched off');
  });
});

describe('publishing a pointer', () => {
  it('sends nothing at all while nobody is listening', async () => {
    const { store, view, wire } = setup();
    store.toggleCursors();
    view.move(WORLD);

    await new Promise((resolve) => setTimeout(resolve, 150));
    // The difference between a feature and a permanent cost: one person in a space publishes nothing.
    expect(published(wire)).toEqual([]);
  });

  it('sends the latest position once a peer is watching, and stops when it stops moving', async () => {
    const { store, view, wire, presence } = setup();
    presence.publish(ANA, { type: 'live', cursors: true });
    store.toggleCursors();

    view.move({ ...WORLD, x: 1 });
    view.move({ ...WORLD, x: 2 });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const sent = published(wire).filter((p) => p.kind === 'cursor');
    // One message for two moves inside a window, carrying the *last* position — the one that matters,
    // since it is where somebody stopped pointing.
    expect(sent).toHaveLength(1);
    expect(sent[0].at).toMatchObject({ x: 2 });

    const before = published(wire).length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    // A still pointer is not news.
    expect(published(wire).length).toBe(before);
  });
});

describe('receiving a peer’s cursor', () => {
  it('draws it, with a face read live rather than baked in', () => {
    const { store, wire, presence } = setup();
    presence.publish(ANA, { type: 'live', cursors: true });
    store.toggleCursors();

    wire.agent(ANA).channel('live').publish({ v: LIVE_PROTOCOL_VERSION, seq: 1, kind: 'cursor', at: WORLD });

    expect(store.faces()).toEqual([{ did: ANA, name: 'Ana', image: 'ana.png' }]);
  });

  it('ignores what arrives while this agent has cursors off', () => {
    const { store, wire } = setup();
    wire.agent(ANA).channel('live').publish({ v: LIVE_PROTOCOL_VERSION, seq: 1, kind: 'cursor', at: WORLD });
    // Switching off is not "hide them locally": nothing is held, so nothing is drawn and nothing is
    // remembered to be drawn later.
    expect(store.faces()).toEqual([]);
  });

  it('drops a position that arrives out of order', () => {
    const { store, wire, view } = setup();
    store.toggleCursors();
    const ana = wire.agent(ANA).channel('live');

    ana.publish({ v: LIVE_PROTOCOL_VERSION, seq: 2, kind: 'cursor', at: { ...WORLD, x: 99 } });
    ana.publish({ v: LIVE_PROTOCOL_VERSION, seq: 1, kind: 'cursor', at: { ...WORLD, x: 1 } });

    const mark = view.decorations().find((entry) => entry.id === ANA);
    // The newer one stands. Without this a cursor jitters backwards on an unordered transport, which
    // is what the faster one will be.
    expect(mark?.at).toMatchObject({ x: 99 });
  });

  it('takes a cursor off the screen when its owner says they have left', () => {
    const { store, wire, view } = setup();
    store.toggleCursors();
    const ana = wire.agent(ANA).channel('live');

    ana.publish({ v: LIVE_PROTOCOL_VERSION, seq: 1, kind: 'cursor', at: WORLD });
    expect(view.decorations()).toHaveLength(1);
    ana.publish({ v: LIVE_PROTOCOL_VERSION, seq: 2, kind: 'cursor', at: null });
    expect(view.decorations()).toHaveLength(0);
  });

  it('draws each cursor eased and keyed by the agent it belongs to', () => {
    const { store, wire, view } = setup();
    store.toggleCursors();
    wire.agent(ANA).channel('live').publish({ v: LIVE_PROTOCOL_VERSION, seq: 1, kind: 'cursor', at: WORLD });

    const [mark] = view.decorations();
    expect(mark.id).toBe(ANA);
    // Eased, because a cursor arrives in steps and is drawn as continuous movement; keyed by did, so
    // there is an element for the transition to run on.
    expect(mark.ease).toBe(true);
    expect(mark.node.type).toBe('we-live-cursor');
  });
});

describe('a space with no transport', () => {
  it('offers nothing rather than failing', () => {
    // A personal space is synced with nobody, so `ephemeral` answers null and there is nobody to be
    // live to. A module must degrade rather than throw — this is that path.
    const { store } = setup({ dataset: null });
    expect(store.canShareCursors()).toBe(true);
    store.toggleCursors();
    expect(store.cursorsOn()).toBe(true);
    expect(store.faces()).toEqual([]);
  });
});

describe('the wheel', () => {
  it('publishes a claim and a first view when taken', () => {
    const { store, presence, wire } = setup();
    store.takeWheel();

    expect(store.driving()).toBe(true);
    expect(presence.published.at(-1)).toMatchObject({ type: 'driving' });
    // A view goes out at once rather than waiting for the repeat, so a follower who is already waiting
    // is not left wherever they happened to be.
    expect(published(wire).some((p) => p.kind === 'view')).toBe(true);
  });

  it('gives the wheel to whoever claimed it first, on every screen', () => {
    const { store, presence } = setup();
    presence.publish(ANA, { type: 'driving', since: 1_000 });
    presence.publish('did:test:bo', { type: 'driving', since: 2_000 });
    // Deterministic and needing no round trip, which is what stops two screens disagreeing about who
    // is driving — the same tie-break the mesh and the tab coordinator use.
    expect(store.driverName()).toBe('Ana');
  });

  it('toggles from one action, since a schema cannot choose between two handlers', () => {
    const { store } = setup();
    store.toggleWheel();
    expect(store.driving()).toBe(true);
    store.toggleWheel();
    expect(store.driving()).toBe(false);
  });

  it('refuses where the space has switched driving off', () => {
    const { store } = setup({ settings: { driving: false } });
    store.takeWheel();
    expect(store.driving()).toBe(false);
    expect(store.canDrive()).toBe(false);
    expect(store.problem()).toContain('switched off');
  });
});

describe('following', () => {
  it('applies frames from the driver, and only from the driver', () => {
    const { store, presence, wire, view } = setup();
    presence.publish(ANA, { type: 'driving', since: 1 });
    store.follow();

    expect(store.following()).toBe(true);
    expect(store.followingName()).toBe('Ana');

    const frame = { path: '/space/a/kanban', surface: 'route:/space/a/kanban' };
    wire.agent(ANA).channel('live').publish({ v: LIVE_PROTOCOL_VERSION, seq: 1, kind: 'view', frame });
    expect(view.applied).toHaveLength(1);
    expect(view.applied[0].path).toBe('/space/a/kanban');

    // Somebody else publishing a view is somebody else's business, whatever they claim.
    wire
      .agent('did:test:bo')
      .channel('live')
      .publish({ v: LIVE_PROTOCOL_VERSION, seq: 1, kind: 'view', frame: { path: '/elsewhere' } });
    expect(view.applied).toHaveLength(1);
  });

  it('stops when the person being followed goes away', () => {
    const { store, presence } = setup();
    presence.publish(ANA, { type: 'driving', since: 1 });
    store.follow();
    expect(store.following()).toBe(true);

    // Presence expires on its own TTL, so a driver whose laptop closes releases every follower with
    // nobody sending anything. This is that, from the follower's side.
    presence.leave(ANA);
    expect(store.following()).toBe(false);
  });

  it('gives up the wheel rather than driving and following at once', () => {
    const { store, presence } = setup();
    presence.publish(ANA, { type: 'driving', since: 1 });
    store.takeWheel();
    store.follow();
    expect(store.driving()).toBe(false);
    expect(store.following()).toBe(true);
  });

  it('has nothing to follow when nobody has the wheel', () => {
    const { store } = setup();
    store.follow();
    expect(store.following()).toBe(false);
  });
});
