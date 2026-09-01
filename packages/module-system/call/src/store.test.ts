/**
 * The stage — what the call asks the host for, and how the tiles pack once it gets it.
 *
 * Tested against `signal` alone, with no transport and no presence, because that is the degradation
 * mode the contract promises and it is also the only part of this file that needs a browser. What is
 * checked here is the arithmetic: how a placement resolves, the three keys the host reads off it, and
 * the packing rule that makes "one participant never scrolls" true by construction rather than by
 * inspection.
 */
import { describe, expect, it } from 'vitest';

import { createCallStore, STAGE_GAP_PX, STAGE_PADDING_PX } from './store';

/** The reactivity a host lends a module, reduced to the smallest thing that satisfies it. */
function makeStore() {
  const signal = <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => (value = next)];
  };
  return createCallStore({ signal }) as ReturnType<typeof createCallStore> & Record<string, () => unknown>;
}

describe('what the call still decides about its own video', () => {
  it('separates whether the video shows from how much of the screen it has', () => {
    // One button used to cycle visibility, placement and size together, so it could not have a clear
    // icon and any given state took up to three clicks through states nobody wanted.
    const store = makeStore();
    expect(store.stageOpen()).toBe(false);

    store.toggleStage();
    expect(store.stageOpen()).toBe(true);
    store.toggleStage();
    expect(store.stageOpen()).toBe(false);
  });

  it('asks for no room until it is opened', () => {
    // A call you have just joined must not shrink the app on its own. `null` is how the dock says
    // "not placed", which is the same key the host reads for *where* — one question, one answer.
    expect(makeStore().dockEdge()).toBeNull();
  });

  it('always overlays, and leaves everything else about the panel to the host', () => {
    // The module's whole statement about layout, and it is now one sentence: a card, floating, when
    // it opens. Position, size, whether it displaces content and whether it covers the screen are all
    // the host's, on the panel's own titlebar.
    const store = makeStore();
    store.toggleStage();

    expect(store.dockFloat()).toBe(true);
    expect(store.dockSize()).toBe('sm');
  });

  it('no longer offers a placement, a size, or a full screen', () => {
    // The four edges became eight snap targets any panel can use, the three size presets became a
    // drag, and full screen became a button on the panel's own titlebar. Asserted so that
    // reintroducing any of them here is a deliberate decision rather than a reflex.
    const store = makeStore() as unknown as Record<string, unknown>;
    expect(store.placementOptions).toBeUndefined();
    expect(store.setPlacement).toBeUndefined();
    expect(store.setDockSize).toBeUndefined();
    expect(store.dockSizeOptions).toBeUndefined();
    expect(store.cycleStage).toBeUndefined();
    expect(store.toggleFullscreen).toBeUndefined();
    expect(store.stageFull).toBeUndefined();
    // The bar used to swap ends to dodge a top-docked stage. It cannot know where the stage is now.
    expect(store.barAtBottom).toBeUndefined();
  });
});

describe('tile packing', () => {
  it('no longer decides its own columns', () => {
    // The columns used to come from the head count alone, with the panel's shape — the one thing the
    // user controls directly — not an input at all. `Grid`'s `childAspect` solves it against the
    // measured box and reports back; this module reads the answer rather than guessing it.
    const store = makeStore();

    expect(store.stageStyle).toBeUndefined();
    expect(store.arrangement()).toEqual({ columns: 1, rows: 1 });
  });

  it('takes the arrangement the stage settled on', () => {
    const store = makeStore();
    store.setArrangement({ columns: 3, rows: 2 });
    expect(store.arrangement()).toEqual({ columns: 3, rows: 2 });
  });

  it('fits each picture to its cell by measuring the cell', () => {
    // `container-type: size` on the cell is what `100cqh` measures, and it is unconditional now: the
    // one shape it would have collapsed — a row sized from the column width — is no longer reachable.
    expect(makeStore().pictureStyle().width).toContain('cqh');
  });

  it('places nobody when nobody is in the call', () => {
    expect(makeStore().tileCells()).toEqual([]);
  });

  it('publishes its own padding and gaps with the shape it wants', () => {
    // The host solves `(width - insetX) / ratio + insetY` for "fit to content", so the insets are
    // what stop the answer coming out short — which the tiles then answered by shrinking to the
    // height and leaving a gap down each side, a fit that looked wrong in the other axis.
    const aspect = makeStore().dockAspect() as { ratio: number; insetX: number; insetY: number };

    expect(aspect.ratio).toBeCloseTo(16 / 9);
    expect(aspect.insetX).toBe(STAGE_PADDING_PX * 2);
    expect(aspect.insetY).toBe(STAGE_PADDING_PX * 2);
  });

  it('fits to the arrangement it is in, rather than solving a new one', () => {
    // With the width fixed, any column count can be made to fit perfectly — so a "fit" that
    // re-solved could rearrange the call under a click that only asked to remove the empty band.
    const store = makeStore();
    store.setArrangement({ columns: 3, rows: 2 });
    const aspect = store.dockAspect() as { ratio: number; insetX: number; insetY: number };

    expect(aspect.ratio).toBeCloseTo((3 * 16) / (2 * 9));
    expect(aspect.insetX).toBe(STAGE_PADDING_PX * 2 + 2 * STAGE_GAP_PX);
    expect(aspect.insetY).toBe(STAGE_PADDING_PX * 2 + 1 * STAGE_GAP_PX);
  });
});

describe('focus', () => {
  it('starts unfocused, which is what an even grid means', () => {
    expect(makeStore().focusedId()).toBeNull();
  });

  it('is a no-op for a participant who is not there', () => {
    // Reachable only through a stale click, and the honest result is nothing rather than a stage
    // spotlighting an id no tile matches.
    const store = makeStore();
    store.focusTile('nobody');
    expect(store.tileCells()).toEqual([]);
  });
});

describe('transport and device lifetime', () => {
  /**
   * Two leaks with the same shape: something acquired on join that nothing gave back.
   *
   * `EphemeralScope` is refcounted, so ten joins left ten refs outstanding and the backend's signal
   * handler for that perspective was never removed. And with no teardown in the module contract,
   * unregistering during a call — which a hot reload does — dropped the only reference to the live
   * peer connections and the media stream, leaving the camera on with nothing able to close it.
   */
  function callable(options: { unicast?: string; personal?: boolean } = {}) {
    const signal = <T>(initial: T): [() => T, (next: T) => void] => {
      let value = initial;
      return [() => value, (next: T) => (value = next)];
    };

    let disposed = 0;
    const scope = {
      capabilities: {
        unicast: options.unicast ?? 'emulated',
        broadcast: true,
        coalesce: true,
        confidential: false,
      },
      channel: () => ({ publish: () => {}, onMessage: () => () => {} }),
      dispose: () => (disposed += 1),
    };

    const disposers: Array<() => void> = [];
    let created = 0;
    // The host's removal channel — see `ModuleDatasetAccess.onRemoved`. Held so a test can fire it.
    let notifyRemoved: ((uri: string) => void) | null = null;
    /*
      `signal` here is a plain closure with no subscribers, so nothing re-runs on its own. The
      effects are kept and re-run by hand instead, which is enough for what is being asserted: an
      effect that reads a value and acts on it does the same thing whether a framework or a test
      decided it was time to look again.
    */
    const effects: Array<() => void> = [];
    let me: string | null = 'did:test:me';
    const store = createCallStore({
      signal,
      effect: (fn: () => void) => {
        effects.push(fn);
        fn();
      },
      dataset: () => ({ id: 'ds' }),
      datasetUri: () => 'inmemory://ds',
      datasets: {
        get: () => undefined,
        open: () => {},
        openRef: () => {},
        onRemoved: (cb: (uri: string) => void) => {
          notifyRemoved = cb;
          return () => {
            notifyRemoved = null;
          };
        },
      },
      selfId: () => me,
      ephemeral: () => (options.personal ? null : scope),
      presence: { peers: () => [], setActivity: () => {}, clearActivity: () => {} },
      onDispose: (fn: () => void) => disposers.push(fn),
      createEntity: async () => `rec-${++created}`,
      createPeerConnection: () => ({}) as RTCPeerConnection,
    } as never) as ReturnType<typeof createCallStore> & Record<string, (...args: unknown[]) => unknown>;

    return {
      store,
      scopeDisposals: () => disposed,
      recordsCreated: () => created,
      disposers,
      removeDataset: (uri: string) => notifyRemoved?.(uri),
      signOut: () => {
        me = null;
        for (const run of effects) run();
      },
    };
  }

  it('shows the video when the call starts', async () => {
    // Nothing did this, so pressing the call button produced a control bar and no picture: `dockEdge`
    // is null while the stage is closed and the host renders no dock for a null edge, so the only
    // routes to a visible stage were controls that read as ways to change something already there.
    const { store } = callable();

    await store.startCall();
    await Promise.resolve();

    expect(store.stageOpen()).toBe(true);
    // Floating, so showing it costs the space behind it nothing — the two questions stay separate.
    expect(store.dockFloat()).toBe(true);
    expect(store.dockEdge()).not.toBeNull();
  });

  it('stops showing it when the call ends', async () => {
    // "This call is showing", not a preference that outlives the call it was made in.
    const { store } = callable();

    await store.startCall();
    await Promise.resolve();
    store.leave();

    expect(store.stageOpen()).toBe(false);
    expect(store.dockEdge()).toBeNull();
  });

  it('writes no call record when the call cannot run', async () => {
    /*
      The record used to be created first and `join` called afterwards, so every refused start left
      a `CollectionBlock` behind for a call that never happened — one per press, all `kind: 'call'`,
      all of them appearing wherever calls are listed with no participants, no transcript and
      nothing to tell them apart from a real call nobody spoke in.

      A personal space is the case that made it constant rather than occasional: a call there can
      never work, so pressing the button was purely a way to litter the space.
    */
    const personal = callable({ personal: true });
    await personal.store.startCall();
    await Promise.resolve();

    expect(personal.recordsCreated()).toBe(0);
    expect(personal.store.callId()).toBeNull();
    expect(personal.store.problem()).toMatch(/personal/i);

    // And the other refusal, which is a property of the transport rather than of the space: with no
    // unicast at all every offer reaches everybody, so the call is refused before it is recorded.
    const broadcastOnly = callable({ unicast: 'none' });
    await broadcastOnly.store.startCall();
    await Promise.resolve();

    expect(broadcastOnly.recordsCreated()).toBe(0);
    expect(broadcastOnly.store.callId()).toBeNull();
    // And the scope opened to reach that verdict was given back, rather than leaked once per press.
    expect(broadcastOnly.scopeDisposals()).toBe(1);
  });

  it('gives the transport scope back when the call ends', async () => {
    const { store, scopeDisposals } = callable();

    await store.startCall();
    await Promise.resolve();
    expect(scopeDisposals()).toBe(0);

    store.leave();
    expect(scopeDisposals()).toBe(1);
  });

  it('does not accumulate scopes across repeated joins', async () => {
    const { store, scopeDisposals } = callable();

    await store.startCall();
    store.joinAnchoredCall('node-a');
    store.joinAnchoredCall('node-b');
    await Promise.resolve();
    store.leave();

    // Each join released the previous one's scope; without that, ten joins leak ten refs and the
    // backend's handler for the perspective outlives every one of them.
    expect(scopeDisposals()).toBe(3);
  });

  it('tears the call down when the module is disposed', async () => {
    const { store, scopeDisposals, disposers } = callable();

    await store.startCall();
    await Promise.resolve();
    expect(store.callId()).not.toBeNull();

    for (const dispose of disposers) dispose();

    // The camera-stays-on case: unregistering during a call must close what the call holds.
    expect(scopeDisposals()).toBe(1);
    expect(store.callId()).toBeNull();
  });

  it('tears the call down when the space it is in is deleted', async () => {
    /*
      Nothing did. `removeDataset` tore the perspective down and left this store holding the media
      tracks, the peer connections and a presence lease heartbeating into a perspective that no
      longer existed.
    */
    const { store, scopeDisposals, removeDataset } = callable();

    await store.startCall();
    await Promise.resolve();

    removeDataset('inmemory://ds');

    expect(store.callId()).toBeNull();
    expect(scopeDisposals()).toBe(1);
  });

  it('ignores the removal of a space the call is not in', async () => {
    const { store, scopeDisposals, removeDataset } = callable();

    await store.startCall();
    await Promise.resolve();

    removeDataset('inmemory://somewhere-else');

    expect(store.callId()).not.toBeNull();
    expect(scopeDisposals()).toBe(0);
  });

  it('ends the call when the agent signs out', async () => {
    // `logout` locks the agent and returns to the sign-in screen without unregistering anything, so
    // on desktop — which does not reload — the camera light stayed on through the login screen.
    const { store, scopeDisposals, signOut } = callable();

    await store.startCall();
    await Promise.resolve();

    signOut();

    expect(store.callId()).toBeNull();
    expect(scopeDisposals()).toBe(1);
  });
});

/**
 * What happens to a call when the user goes somewhere else.
 *
 * The call used to end. Presence is the roster the mesh reconciles against, and the host scoped it
 * to the space on screen — so navigating away emptied the roster and closed every connection, and
 * the store had an effect that finished the job whenever the dataset went null. Both halves are
 * gone: the host keeps a source open for any space holding a live activity, and this file no longer
 * ends a call for any reason except somebody ending it.
 */
describe('a call and the space it happens in', () => {
  function navigable() {
    const signal = <T>(initial: T): [() => T, (next: T) => void] => {
      let value = initial;
      return [() => value, (next: T) => (value = next)];
    };

    // Effects are collected rather than run reactively — the deps are plain closures, so re-running
    // them by hand is how a change of space is simulated.
    const effects: Array<() => void> = [];
    const activities: Array<Record<string, unknown>> = [];
    let dataset: { id: string } | null = { id: 'ds' };
    let uri: string | null = 'inmemory://ds';

    const scope = {
      capabilities: { unicast: 'emulated', broadcast: true, coalesce: true, confidential: false },
      channel: () => ({ publish: () => {}, onMessage: () => () => {} }),
      dispose: () => {},
    };
    let created = 0;

    const store = createCallStore({
      signal,
      effect: (fn: () => void) => effects.push(fn),
      dataset: () => dataset,
      datasetUri: () => uri,
      selfId: () => 'did:test:me',
      ephemeral: () => scope,
      presence: {
        peers: () => [],
        setActivity: (activity: Record<string, unknown>) => activities.push(activity),
        clearActivity: () => {},
      },
      onDispose: () => {},
      createEntity: async () => `rec-${++created}`,
      createPeerConnection: () => ({}) as RTCPeerConnection,
    } as never) as ReturnType<typeof createCallStore> & Record<string, (...args: unknown[]) => unknown>;

    return {
      store,
      activities,
      /** Move to another space, or to none, and let everything that watches for it run. */
      goTo(next: { id: string } | null, nextUri: string | null) {
        dataset = next;
        uri = nextUri;
        for (const fn of effects) fn();
      },
    };
  }

  it('says which space it is in, even when it is not about anything', async () => {
    // The host routes a call's activity to that space's own presence source. An unanchored activity
    // was enough only while a call could exist solely in the space you were standing in.
    const { store, activities } = navigable();

    await store.startCall();
    await Promise.resolve();

    const call = activities.find((a) => a.type === 'call');
    expect((call?.anchor as { datasetUri?: string })?.datasetUri).toBe('inmemory://ds');
    // No node — a space-wide call is still space-wide, and `transcribe` reads `anchor?.nodeId`.
    expect((call?.anchor as { nodeId?: string })?.nodeId).toBeUndefined();
  });

  it('stays in the call after moving to another space', async () => {
    const { store, goTo } = navigable();

    await store.startCall();
    await Promise.resolve();
    expect(store.active()).toBe(true);

    goTo({ id: 'elsewhere' }, 'inmemory://elsewhere');

    expect(store.active()).toBe(true);
    expect(store.callId()).not.toBeNull();
  });

  it('stays in the call across a frame with no dataset at all', async () => {
    // The specific shape of the old bug. A null dataset is the boot frame and the gap between two
    // spaces as much as it is anything final, so ending a call on it ended calls for no reason.
    const { store, goTo } = navigable();

    await store.startCall();
    await Promise.resolve();

    goTo(null, null);

    expect(store.active()).toBe(true);
  });

  it('still ends when somebody ends it', async () => {
    // The other half: nothing above should have made a call harder to leave.
    const { store, goTo } = navigable();

    await store.startCall();
    await Promise.resolve();
    goTo({ id: 'elsewhere' }, 'inmemory://elsewhere');

    store.leave();
    expect(store.active()).toBe(false);
  });

  it('replaces the call rather than running two', async () => {
    // Asserted here because the presence work rests on it: the pinned-space set is bounded by there
    // being one call, and a second live call would be a second space pinned indefinitely.
    const { store } = navigable();

    await store.startCall();
    await Promise.resolve();
    const first = store.callId();

    store.joinAnchoredCall('node-1');
    await Promise.resolve();

    expect(store.callId()).not.toBe(first);
    expect(store.active()).toBe(true);
  });
});

/**
 * The rail's call button — one promise across every state it can be pressed in.
 *
 * It used to be wired straight to a bare join, which made it three different things: a no-op in
 * the space call (`join` returns early on a matching id), and a silent teardown of any *other* call,
 * including one running in a space the user had merely navigated away from. A button in permanent
 * chrome is pressed by accident; neither outcome is one it should be able to produce.
 *
 * These pin the three readings down, because all three are invisible from the declaration — the
 * launcher names a method as a string and the host calls whatever it finds.
 */
describe('going to the call', () => {
  function railable() {
    const signal = <T>(initial: T): [() => T, (next: T) => void] => {
      let value = initial;
      return [() => value, (next: T) => (value = next)];
    };

    const effects: Array<() => void> = [];
    let dataset: { id: string } | null = { id: 'ds' };
    let uri: string | null = 'inmemory://ds';
    const opened: string[] = [];

    const scope = {
      capabilities: { unicast: 'emulated', broadcast: true, coalesce: true, confidential: false },
      channel: () => ({ publish: () => {}, onMessage: () => () => {} }),
      dispose: () => {},
    };
    let created = 0;

    const store = createCallStore({
      signal,
      effect: (fn: () => void) => effects.push(fn),
      dataset: () => dataset,
      datasetUri: () => uri,
      selfId: () => 'did:test:me',
      ephemeral: () => scope,
      presence: { peers: () => [], setActivity: () => {}, clearActivity: () => {} },
      datasets: { get: () => undefined, open: (target: string) => opened.push(target) },
      onDispose: () => {},
      createEntity: async () => `rec-${++created}`,
      createPeerConnection: () => ({}) as RTCPeerConnection,
    } as never) as ReturnType<typeof createCallStore> & Record<string, (...args: unknown[]) => unknown>;

    return {
      store,
      opened,
      goTo(next: { id: string } | null, nextUri: string | null) {
        dataset = next;
        uri = nextUri;
        for (const fn of effects) fn();
      },
    };
  }

  it('starts the space call when there is not one', async () => {
    const { store } = railable();

    store.goToCall();
    await Promise.resolve();

    expect(store.active()).toBe(true);
    // Getting to a call you have just started means seeing it, and `join` already opens the stage.
    expect(store.stageOpen()).toBe(true);
  });

  it('shows the video once you are in the call, and never hides it', async () => {
    /*
      This toggled once, on the reasoning that a rail button is a tab. It made a liar of every
      control that calls it — the button says *go to the call*, and putting the video away is the
      opposite of going to it. Reported from a calls list, where a phone icon beside a finished
      meeting hid the call the user was in.

      Idempotent instead, the way navigation is: pressing Home while on Home does nothing. Hiding
      the video has two controls of its own, neither named after going somewhere.
    */
    const { store } = railable();

    store.goToCall();
    await Promise.resolve();
    expect(store.stageOpen()).toBe(true);

    store.goToCall();
    expect(store.stageOpen()).toBe(true);
    // The controls that *are* for putting it away still do.
    store.closeStage();
    expect(store.stageOpen()).toBe(false);
    // And going back to it brings it up rather than flipping it away again.
    store.goToCall();
    expect(store.stageOpen()).toBe(true);
    // None of it at the cost of the call itself.
    expect(store.active()).toBe(true);
  });

  it('takes you back to a call happening in another space, rather than starting a second one', async () => {
    /*
      The worst of the three old readings. Navigating out of a call's space and pressing the rail
      button tore that call down and started a fresh one where you were standing — every connection
      closed, everyone dropped, no confirmation, from a button whose icon says "call".
    */
    const { store, opened, goTo } = railable();

    store.goToCall();
    await Promise.resolve();
    const original = store.callId();
    store.closeStage();

    goTo({ id: 'elsewhere' }, 'inmemory://elsewhere');
    store.goToCall();
    await Promise.resolve();

    expect(store.callId()).toBe(original);
    expect(opened).toEqual(['inmemory://ds']);
    // Landing in the call's space with only the bar up is arriving at the door. The stage comes back.
    expect(store.stageOpen()).toBe(true);
  });

  it('leaves an anchored call alone', async () => {
    // The same hazard without the navigation: a call *about* a post has a different id from the
    // space call, so the old wiring read the rail's button as "replace it".
    const { store } = railable();

    store.joinAnchoredCall('node-1');
    await Promise.resolve();
    const anchored = store.callId();

    store.goToCall();
    await Promise.resolve();

    expect(store.callId()).toBe(anchored);
    expect(store.active()).toBe(true);
  });

  it('says why rather than throwing when there is no space to call in', async () => {
    const { store, goTo } = railable();
    goTo(null, null);

    expect(() => store.goToCall()).not.toThrow();
    expect(store.problem()).toBeTruthy();
    expect(store.active()).toBe(false);
  });
});

/**
 * The spotlight is a layout, not a bigger cell.
 *
 * It used to be a span in the grid solved for equal tiles, so the focused tile could only ever be
 * two of N — two thirds of the stage at three people and one third at six, which is not a spotlight.
 * These check the two decisions that replaced it: that writing tracks stands the equal-tile solver
 * down, and that the strip lands on the axis with room to spare.
 *
 * Tiles are unreachable without a call, so the strip always holds one here. What varies with the
 * count is inside the track strings, which is why they are asserted as strings.
 */
describe('the spotlight', () => {
  const wide = { width: 1920, height: 900 };
  const tall = { width: 700, height: 1200 };

  const spotlit = (box: { width: number; height: number }) => {
    const store = makeStore();
    store.setStageBox(box);
    store.focusTile('someone');
    return store;
  };

  it('hands the grid back its own solve when nobody is focused', () => {
    // The whole mode switch: `template` takes precedence over `childAspect`, so absent means the
    // equal-tile solver is in charge and present means it stands down. No mode flag to keep in step.
    const store = makeStore();
    expect(store.stageTemplate()).toBeUndefined();
    expect(store.stageRows()).toBeUndefined();
  });

  it('runs the strip down the side of a panel wider than a tile', () => {
    // A 16:9 spotlight in a wider panel is limited by the height, so the spare room is horizontal.
    // The strip is the second *column*; the rows are one per strip tile.
    const store = spotlit(wide);
    expect(store.stageTemplate()).toBe(`1fr ${wide.width * 0.25}px`);
    expect(store.stageRows()).toBe('repeat(1, 1fr)');
  });

  it('runs it underneath a panel that is not', () => {
    const store = spotlit(tall);
    expect(store.stageRows()).toBe(`1fr ${tall.height * 0.25}px`);
    expect(store.stageTemplate()).toBe('repeat(1, 1fr)');
  });

  it('is measured in pixels, not container-query units', () => {
    /*
      A `cq` unit in a container's *own* properties resolves against its ancestor container rather
      than itself — so the stage sizing its own track in `cqw` got a quarter of whatever happened to
      be above it, or of the viewport when nothing was. Verified in Chrome; it is the same
      self-reference the tier sentinel exists for, in the units rather than the queries.
    */
    const store = spotlit(wide);
    expect(store.stageTemplate()).not.toContain('cq');
    expect(store.stageRows()).not.toContain('cq');
  });

  it('leaves a strip that fits alone', () => {
    // The ordinary case is untouched: tiles take a share each, nothing scrolls, and the stage keeps
    // the `overflow: hidden` that makes an overflowing grid a bug to be seen.
    const store = spotlit(wide);
    expect(store.stageOverflow()).toEqual({ overflow: 'hidden' });
    expect(store.stageRows()).toBe('repeat(1, 1fr)');
  });

  it('caps the strip, so one other participant is not half the stage', () => {
    // The natural thickness makes the strip tiles 16:9 along their axis, which for a single tile is
    // most of the panel — the arrangement spotlight exists to get away from.
    const store = spotlit(wide);
    const aspect = store.dockAspect() as { ratio: number; insetX: number; insetY: number };

    expect(aspect.ratio).toBeCloseTo(16 / 9);
    expect(aspect.insetX).toBe(STAGE_PADDING_PX * 2 + wide.width * 0.25 + STAGE_GAP_PX);
    expect(aspect.insetY).toBe(STAGE_PADDING_PX * 2);
  });

  it('gives the whole stage to solo, on the axis the strip was on', () => {
    const store = spotlit(wide);
    store.toggleSolo();

    expect(store.solo()).toBe(true);
    expect(store.stageTemplate()).toBe('1fr');
    expect(store.stageRows()).toBe('1fr');
    // Nothing beside the picture any more, so the fit is the tile's own shape and the padding.
    const aspect = store.dockAspect() as { insetX: number; insetY: number };
    expect(aspect.insetX).toBe(STAGE_PADDING_PX * 2);
  });

  it('ends solo when the spotlight does', () => {
    // It is a property of *having* a spotlight. Left armed, it would take effect on whoever was
    // focused next, which nobody asked for.
    const store = spotlit(wide);
    store.toggleSolo();
    store.focusTile('someone');

    expect(store.solo()).toBe(false);
    expect(store.stageTemplate()).toBeUndefined();
  });

  it('refuses solo with nothing to apply it to', () => {
    // The bar only offers it while something is focused, but a store method is reachable by anything
    // a template can write.
    const store = makeStore();
    store.toggleSolo();
    expect(store.solo()).toBe(false);
  });
});

/**
 * Which call this is, published so a surface can follow it.
 *
 * The record is written by `startCall` before anyone joins and republished on every participant's
 * activity, so "which call is this" is answerable from the first second. It was held in a plain
 * `let`, though — a closure over it returns the right value whenever it is *called*, and tells the
 * reactive graph nothing. So anything binding to `callRecordId` was evaluated once, against the
 * frame before the call existed, and never re-evaluated: a board, a transcript feed and an
 * extraction readout sat empty beside a call that was plainly running.
 *
 * Pinned against a **tracking** primitive rather than the closure the harness above injects,
 * because a plain `let` passes every assertion a non-tracking signal can make — which is the whole
 * bug. Written out here rather than imported: a module depends on no framework, so the test that
 * proves it uses the host's reactivity cannot reach for one either.
 */
describe('the call record a surface follows', () => {
  /** The smallest thing that is actually reactive: a read inside an effect re-runs on a write. */
  function tracking() {
    let listener: (() => void) | null = null;
    return {
      signal: <T>(initial: T): [() => T, (next: T) => void] => {
        let value = initial;
        const readers = new Set<() => void>();
        return [
          () => {
            if (listener) readers.add(listener);
            return value;
          },
          (next: T) => {
            value = next;
            for (const run of [...readers]) run();
          },
        ];
      },
      effect: (fn: () => void) => {
        const run = () => {
          const outer = listener;
          listener = run;
          try {
            fn();
          } finally {
            listener = outer;
          }
        };
        run();
      },
    };
  }

  it('notifies a reader when the call gets its record', async () => {
    let created = 0;
    const scope = {
      capabilities: { unicast: 'emulated', broadcast: true, coalesce: true, confidential: false },
      channel: () => ({ publish: () => {}, onMessage: () => () => {} }),
      dispose: () => {},
    };

    const { signal, effect } = tracking();
    const store = createCallStore({
      signal,
      effect,
      dataset: () => ({ id: 'ds' }),
      datasetUri: () => 'inmemory://ds',
      datasets: { get: () => undefined, open: () => {}, openRef: () => {}, onRemoved: () => () => {} },
      selfId: () => 'did:test:me',
      ephemeral: () => scope,
      presence: { peers: () => [], setActivity: () => {}, clearActivity: () => {} },
      onDispose: () => {},
      createEntity: async () => `rec-${++created}`,
      createPeerConnection: () => ({}) as RTCPeerConnection,
    } as never) as ReturnType<typeof createCallStore>;

    const seen: string[] = [];
    effect(() => seen.push(store.callRecordId()));

    // Nothing to follow yet, and the reader has run once against that.
    expect(seen).toEqual(['']);

    await store.startCall();
    await Promise.resolve();

    expect(store.callRecordId()).toBe('rec-1');
    // The half a plain `let` fails: the reader heard about it.
    expect(seen).toContain('rec-1');
  });
});
