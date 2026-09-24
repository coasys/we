/**
 * The store, driven through the fakes: a real transport with a second agent on it, a screen a test
 * moves, and presence as a roster it sets.
 *
 * What is worth testing here is the set of decisions a schema could not make. Whether to publish at
 * all — nobody listening means nothing sent, which is the difference between a feature and a permanent
 * cost. Whose messages to act on. What happens when the person you are following goes away. And that
 * switching off says so rather than leaving everybody to a three-second timeout.
 */
import type { ModuleStoreDeps } from '@we/module-shared';
import { buildStore, fakeDeps, fakeEphemeral, fakePresence, fakeView } from '@we/module-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeDevCursorCount } from './devCursors';
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
function setup(
  options: { settings?: Record<string, boolean>; dataset?: unknown; shared?: boolean; reportsResults?: boolean } = {},
) {
  const wire = fakeEphemeral({ self: ME });
  // Before the store attaches, since a consumer subscribes as it opens the channel.
  if (options.reportsResults) wire.reportsResults();
  const presence = fakePresence({ self: ME });
  const view = fakeView({ frame: { path: '/space/a/canvas', surface: 'route:/space/a/canvas' } });
  const identities = new Map([[ANA, { name: 'Ana', avatar: 'ana.png' }]]);
  const notified: { tone: string; message: string }[] = [];

  const deps = fakeDeps({
    selfId: () => ME,
    dataset: () => (options.dataset === undefined ? (wire.dataset as never) : (options.dataset as never)),
    /*
      A shared space has a global uri and a personal one does not, which is what the module asks to
      decide whether it can be live at all — see `shared` in the store. `false` here is a personal space.
    */
    datasetUri: () => (options.shared === false ? null : 'neighbourhood://test-space'),
    settings: () => options.settings ?? {},
    identities: { get: (did) => identities.get(did), fetch: () => {} },
    notify: (tone, message) => void notified.push({ tone, message }),
    kernels: { presence: presence.kernel, ephemeral: wire.port, view: view.kernel },
  });

  const store = buildStore(liveModule, deps) as unknown as LiveStore;
  return { store, wire, presence, view, notified, identities };
}

/**
 * What the store published, across both tags, as bodies rather than envelopes.
 *
 * Both, because cursors and views ride separate channels — see `CURSOR_CHANNEL` for why. The warm-up
 * message on each carries no `kind` and is filtered out.
 */
const published = (wire: ReturnType<typeof fakeEphemeral>) =>
  wire
    .sent()
    .map((message) => message.payload as Record<string, unknown>)
    .filter((payload) => payload.kind !== undefined);

/** Which tag each message went out on, for the separation the coalescing relies on. */
const tagsOf = (wire: ReturnType<typeof fakeEphemeral>, kind: string) =>
  wire
    .sent()
    .filter((m) => (m.payload as { kind?: string }).kind === kind)
    .map((m) => m.tag);

beforeEach(() => {
  vi.useRealTimers();
  // The harness count is page-global now rather than per store — one page, one set of fake cursors —
  // so a test that summons some has to put them away or the next one inherits them.
  writeDevCursorCount(0);
});

describe('a host whose services arrive after the store is built', () => {
  /**
   * The failure that produced this: nothing on the rail at all.
   *
   * A module store is built before the host publishes its dataset, so `deps.dataset?.()` reads nothing
   * reactive at construction — and an effect whose first run tracks no dependencies is one the
   * framework never runs again. Anything the module derived from that effect having fired was therefore
   * wrong for ever, silently.
   *
   * `moduleHostServices` now bumps a revision every closure reads, which fixes the class of bug for
   * every module. This is the module's own half: availability is asked of the *space*, and the channel
   * is opened on demand as well as from the effect, so the feature works even where the effect is dead.
   */
  const lateHost = (overrides: Partial<ModuleStoreDeps> = {}) =>
    fakeDeps({
      // An effect that runs once and is never re-run — which is precisely what Solid does with a first
      // run that touched no signal.
      effect: (fn) => fn(),
      ...overrides,
    });

  it('offers its controls even though the effect ran before there was a dataset', () => {
    const wire = fakeEphemeral({ self: ME });
    let dataset: unknown = null;
    const store = buildStore(
      liveModule,
      lateHost({
        selfId: () => ME,
        dataset: () => dataset as never,
        datasetUri: () => (dataset ? 'neighbourhood://test-space' : null),
        kernels: { presence: fakePresence({ self: ME }).kernel, ephemeral: wire.port, view: fakeView().kernel },
      }),
    ) as unknown as LiveStore;

    // The dataset arrives after construction, and nothing re-runs the effect.
    dataset = wire.dataset;
    expect(store.canShareCursors()).toBe(true);
    expect(store.canTakeWheel()).toBe(true);
  });

  it('opens the channel on the press, since nothing else will have', () => {
    const wire = fakeEphemeral({ self: ME });
    let dataset: unknown = null;
    const store = buildStore(
      liveModule,
      lateHost({
        selfId: () => ME,
        dataset: () => dataset as never,
        datasetUri: () => (dataset ? 'neighbourhood://test-space' : null),
        kernels: { presence: fakePresence({ self: ME }).kernel, ephemeral: wire.port, view: fakeView().kernel },
      }),
    ) as unknown as LiveStore;

    dataset = wire.dataset;
    expect(wire.sent()).toEqual([]);
    store.toggleCursors();
    // The warm-up publish proves a channel was opened by the press rather than at construction.
    expect(wire.sent().length).toBeGreaterThan(0);
  });
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

  it('never starts an interval at all, because the pointer drives the rate', () => {
    /*
      There used to be one, started by an effect on the watcher count — and that effect read the
      presence kernel, which is late-bound, so its first run tracked nothing and it never ran again.
      The rate stayed at whatever the count was when the switch was thrown: zero, if the other agent
      had not announced their cursors yet. Two people with cursors on and neither ever sending one.

      The kernel is tracked now and the effect would work. This asserts the stronger thing — that there
      is no timer to start, so nothing can fail to start it.
    */
    const started: unknown[] = [];
    const spy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: never, ms: never) => {
      started.push(ms);
      return 0 as never;
    }) as never);

    const { store, presence, view } = setup();
    presence.publish(ANA, { type: 'live', cursors: true });
    store.toggleCursors();
    view.move(WORLD);
    expect(started).toEqual([]);
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

  it('sends the first move at once, and the last one after the window', async () => {
    const { store, view, wire, presence } = setup();
    presence.publish(ANA, { type: 'live', cursors: true });
    store.toggleCursors();

    view.move({ ...WORLD, x: 1 });
    // The leading edge: a cursor appears the instant it moves rather than a ladder-period later, which
    // is the half an interval could not give.
    let sent = published(wire).filter((p) => p.kind === 'cursor');
    expect(sent).toHaveLength(1);
    expect(sent[0].at).toMatchObject({ x: 1 });

    // Three more inside the window collapse into one trailing send, carrying the *last* position — the
    // one that matters, since it is where somebody stopped pointing.
    view.move({ ...WORLD, x: 2 });
    view.move({ ...WORLD, x: 3 });
    view.move({ ...WORLD, x: 4 });
    await new Promise((resolve) => setTimeout(resolve, 150));

    sent = published(wire).filter((p) => p.kind === 'cursor');
    expect(sent).toHaveLength(2);
    expect(sent[1].at).toMatchObject({ x: 4 });

    const before = published(wire).length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    // A still pointer is not news.
    expect(published(wire).length).toBe(before);
  });

  it('slows down when the transport says its sends are expensive', async () => {
    const { store, view, wire, presence } = setup({ reportsResults: true });
    presence.publish(ANA, { type: 'live', cursors: true });
    store.toggleCursors();

    /*
      A stalled executor, reported the way the real port reports one. Nothing about the roster has
      changed, so the watcher ladder still asks for its fastest interval; the only reason to slow down is
      the measurement, which is the whole point — the rate used to be chosen from the roster alone, so a
      stalled node was answered by publishing into a queue this agent shares with everything on it.
    */
    view.move({ ...WORLD, x: 1 });
    wire.report('live', { ok: true, ms: 600 });

    const before = published(wire).filter((p) => p.kind === 'cursor').length;
    view.move({ ...WORLD, x: 2 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Well past the ladder's 80ms and still nothing: the floor is now the cost the transport reported.
    expect(published(wire).filter((p) => p.kind === 'cursor')).toHaveLength(before);
  });

  it('keeps the ladder alone when the transport says nothing about its sends', async () => {
    /*
      Absent results mean "no idea", not "fine", so a transport that cannot report must behave exactly as
      it did before any of this existed. `fakeEphemeral` offers the hook only when asked for precisely so
      this branch is reachable.
    */
    const { store, view, wire, presence } = setup();
    presence.publish(ANA, { type: 'live', cursors: true });
    store.toggleCursors();

    view.move({ ...WORLD, x: 1 });
    view.move({ ...WORLD, x: 2 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(published(wire).filter((p) => p.kind === 'cursor')).toHaveLength(2);
  });

  it('ignores a superseded result, which measures nothing about the transport', async () => {
    /*
      A superseded send is the coalescing channel working as intended: a newer position replaced an older
      one before it went out. Its `ms` is the time until it was dropped, so counting it would speed the
      rate UP on the evidence that the transport is behind.
    */
    const { store, view, wire, presence } = setup({ reportsResults: true });
    presence.publish(ANA, { type: 'live', cursors: true });
    store.toggleCursors();

    view.move({ ...WORLD, x: 1 });
    wire.report('live', { ok: true, ms: 900, superseded: true });

    const before = published(wire).filter((p) => p.kind === 'cursor').length;
    view.move({ ...WORLD, x: 2 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    // Unslowed: the ladder still decides, because nothing has been measured.
    expect(published(wire).filter((p) => p.kind === 'cursor')).toHaveLength(before + 1);
  });

  it('sends nothing at all until somebody is watching, then sends on the next move', async () => {
    const { store, view, wire, presence } = setup();
    store.toggleCursors();
    view.move({ ...WORLD, x: 1 });
    await new Promise((resolve) => setTimeout(resolve, 120));
    // One person in a space costs nothing.
    expect(published(wire).filter((p) => p.kind === 'cursor')).toEqual([]);

    /*
      The peer announces their cursors *after* this agent switched theirs on, which is the ordinary
      order and the case that used to fail for ever: the rate was decided once, at the switch, and
      nothing revisited it. Now the rate is read per move, so the next move simply sends.
    */
    presence.publish(ANA, { type: 'live', cursors: true });
    view.move({ ...WORLD, x: 2 });
    expect(published(wire).filter((p) => p.kind === 'cursor')).toHaveLength(1);
  });
});

describe('keeping cursors off the view channel', () => {
  it('sends each kind on its own tag, so neither can displace the other', () => {
    const { store, view, wire, presence } = setup();
    presence.publish(ANA, { type: 'live', cursors: true });
    store.toggleCursors();
    store.takeWheel();
    view.move(WORLD);

    /*
      The transport holds one pending message per *channel*, whatever its kind — so on a single tag a
      moving pointer displaces the driver's own view frame for as long as it keeps moving, and a
      follower is never framed while learning nothing, since every cursor arrives perfectly.

      coasys/ad4m#1133 measures broadcasts queueing 12–21s behind unrelated zome calls, which is exactly
      the window in which a held message is displaced rather than sent.
    */
    expect(new Set(tagsOf(wire, 'cursor'))).toEqual(new Set(['live']));
    expect(new Set(tagsOf(wire, 'view'))).toEqual(new Set(['live-view']));
  });

  it('receives both, whichever tag they arrive on', () => {
    const { store, presence, wire, view } = setup();
    presence.publish(ANA, { type: 'driving', since: 1 });
    store.toggleCursors();
    store.follow();

    wire.agent(ANA).channel('live').publish({ v: LIVE_PROTOCOL_VERSION, seq: 1, kind: 'cursor', at: WORLD });
    wire
      .agent(ANA)
      .channel('live-view')
      .publish({ v: LIVE_PROTOCOL_VERSION, seq: 2, kind: 'view', frame: { path: '/space/a/kanban' } });

    expect(view.decorations()).toHaveLength(1);
    expect(view.applied.map((f) => f.path)).toEqual(['/space/a/kanban']);
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
  it('stops offering the controls rather than offering ones that do nothing', () => {
    /*
      A personal space is synced with nobody, so there is nobody to be live to — while the ephemeral
      *kernel* is present exactly as it is anywhere else. Asking the kernel rather than the space is
      what put a cursor button on the rail in every personal space, doing nothing when pressed.

      Asked as "does this space have a global uri", which is the same fact the transport would report
      one step later — and answerable on the first read, where anything derived from a lifecycle has a
      window in which it is wrong. The rail reads availability inside that window.
    */
    const { store } = setup({ shared: false, dataset: null });
    expect(store.canShareCursors()).toBe(false);
    expect(store.canDrive()).toBe(false);
    expect(store.canTakeWheel()).toBe(false);
    expect(store.canFollow()).toBe(false);
  });

  it('degrades rather than throwing if something asks anyway', () => {
    const { store } = setup({ shared: false, dataset: null });
    // A module must survive a kernel that answers no — a store is built before boot finishes, and a
    // schema written against another deployment may name an action this one cannot honour.
    expect(() => store.toggleCursors()).not.toThrow();
    expect(() => store.takeWheel()).not.toThrow();
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

describe('which of the two the rail offers', () => {
  it('offers the wheel while it is free, and following once somebody has it', () => {
    const { store, presence } = setup();
    // Nobody driving: taking it is the only sensible act.
    expect(store.canTakeWheel()).toBe(true);
    expect(store.canFollow()).toBe(false);

    presence.publish(ANA, { type: 'driving', since: 1 });
    // Somebody else has it: taking one they are holding is a different act from following them, and a
    // single button that silently did one or the other would be wrong half the time it was shown.
    expect(store.canTakeWheel()).toBe(false);
    expect(store.canFollow()).toBe(true);
  });

  it('keeps offering the wheel to whoever is holding it, so it can be given up', () => {
    const { store } = setup();
    store.takeWheel();
    expect(store.canTakeWheel()).toBe(true);
    expect(store.canFollow()).toBe(false);
  });

  it('never offers both at once', () => {
    const { store, presence } = setup();
    for (const step of [
      () => {},
      () => presence.publish(ANA, { type: 'driving', since: 1 }),
      () => store.takeWheel(),
    ]) {
      step();
      expect(store.canTakeWheel() && store.canFollow()).toBe(false);
    }
  });

  it('follows and stops from one action', () => {
    const { store, presence } = setup();
    presence.publish(ANA, { type: 'driving', since: 1 });
    store.toggleFollow();
    expect(store.following()).toBe(true);
    store.toggleFollow();
    expect(store.following()).toBe(false);
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

  it('says when the driver is looking at something this screen does not have open', () => {
    const { store, presence, wire, view } = setup();
    presence.publish(ANA, { type: 'driving', since: 1 });
    store.follow();

    const send = (frame: Record<string, unknown>, seq: number) =>
      wire.agent(ANA).channel('live').publish({ v: LIVE_PROTOCOL_VERSION, seq, kind: 'view', frame });

    /*
      A frame carries a page, a surface within it, and a position on that surface. The page always
      arrives; the position only means anything if this screen has the same surface to put it on. When it
      does not, the follower is on the right page looking at something else while every control says they
      are following, which reads as following being broken rather than as reaching its limit.
    */
    send({ path: '/space/a/canvas', surface: 'canvas:other', region: { x: 0, y: 0, width: 10, height: 10 } }, 1);
    // Nothing yet: navigation is not instant, so a surface judged on the tick of the apply that will
    // change it is always a mismatch. The next frame is the earliest honest moment.
    expect(store.problem()).toBe('');

    send({ path: '/space/a/canvas', surface: 'canvas:other', region: { x: 0, y: 0, width: 10, height: 10 } }, 2);
    expect(store.problem()).toContain('Ana');
    expect(store.problem()).toContain('does not have open');

    // And it clears itself once the two screens agree, rather than sitting there after the fact.
    view.setFrame({ path: '/space/a/canvas', surface: 'canvas:same' });
    send({ path: '/space/a/canvas', surface: 'canvas:same' }, 3);
    send({ path: '/space/a/canvas', surface: 'canvas:same' }, 4);
    expect(store.problem()).toBe('');
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

describe('the synthetic cursors', () => {
  /** The harness members, present only in a development build — which vitest is. */
  const harness = (store: LiveStore) =>
    store as unknown as { fakeCursorCount: () => number; addFakeCursor: () => void; removeFakeCursor: () => void };

  /**
   * Put this agent in a call, as the call module's own presence activity does.
   *
   * The fakes are drawn only while one is running, because the `−  N  +` that manages them lives in the
   * call bar — marks that outlive the call outlive the only control that removes them.
   */
  const joinCall = (presence: ReturnType<typeof fakePresence>) => presence.publish(ME, { type: 'call', id: 'call:1' });

  it('draws nothing at all outside a call, however many were summoned', () => {
    const { store, view, presence } = setup();
    joinCall(presence);
    harness(store).addFakeCursor();
    expect(view.decorations()).toHaveLength(1);

    /*
      The call ends and they go with it. The control that removes them is in the call bar, so cursors that
      carried on afterwards could not be turned off at all — which is what testing found, twice.
    */
    presence.leave(ME);
    expect(view.decorations()).toEqual([]);
  });

  it('stands still while the clock moves, and moves only when its own tick does', () => {
    /*
      The position is a function of the tick this store counts, not of the wall clock. It used to be
      `Date.now()`, which looked like animation and was really a recompute leak: `fakeMarks` reads the
      surface, the surface reads the content box, and the content box changes on every pointer move while
      a panel is being dragged. So the marks jumped at pointer rate while their 90ms easing restarted from
      wherever it had got to — jitter in place, for as long as the drag lasted.

      Fake timers go up BEFORE the store is built, so the tick's interval is one this test can drive.
    */
    vi.useFakeTimers();
    try {
      const { store, view, presence } = setup();
      joinCall(presence);
      harness(store).addFakeCursor();
      const before = view.decorations()[0].at;

      // Five seconds of wall clock with no tick in it. Nothing moves.
      vi.setSystemTime(Date.now() + 5_000);
      expect(view.decorations()[0].at).toEqual(before);

      // And it is not simply frozen: the tick is what carries it.
      vi.advanceTimersByTime(200);
      expect(view.decorations()[0].at).not.toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('draws nothing until asked', () => {
    const { store, view } = setup();
    expect(harness(store).fakeCursorCount()).toBe(0);
    expect(view.decorations()).toEqual([]);
  });

  it('draws without the live switch, because that is what a harness is for', () => {
    const { store, view, presence } = setup();
    joinCall(presence);
    harness(store).addFakeCursor();
    harness(store).addFakeCursor();

    /*
      Outside the switch, deliberately. These exist to look at cursor *rendering* without finding peers,
      so gating them on the toggle made the harness need a second, undiscoverable step — press `+` and
      nothing happens. A real cursor is somebody else's state and stays behind the switch; a fake one is
      a developer asking to see marks.
    */
    expect(store.cursorsOn()).toBe(false);
    expect(view.decorations()).toHaveLength(2);
    expect(view.decorations()[0].node.type).toBe('we-live-cursor');
  });

  it('sits in the surface this agent is on, or nowhere', () => {
    const { store, view, presence } = setup();
    joinCall(presence);
    harness(store).addFakeCursor();
    expect(view.decorations()[0].at.surface).toBe('route:/space/a/canvas');

    // A frame naming no surface is the boot window, and a mark with nowhere to go is not drawn — which
    // is also what made the harness look broken: the fake frame here had no surface either.
    view.setFrame({ path: '/space/a/canvas' });
    expect(view.decorations()).toEqual([]);
  });

  it('counts down again, and stops drawing at zero', () => {
    const { store, view, presence } = setup();
    joinCall(presence);
    harness(store).addFakeCursor();
    harness(store).removeFakeCursor();
    expect(harness(store).fakeCursorCount()).toBe(0);
    expect(view.decorations()).toEqual([]);
  });

  it('draws alongside real cursors rather than instead of them', () => {
    const { store, view, wire, presence } = setup();
    joinCall(presence);
    store.toggleCursors();
    wire.agent(ANA).channel('live').publish({ v: LIVE_PROTOCOL_VERSION, seq: 1, kind: 'cursor', at: WORLD });
    harness(store).addFakeCursor();

    const drawn = view.decorations();
    expect(drawn).toHaveLength(2);
    expect(drawn.map((mark) => mark.id)).toContain(ANA);
  });
});
