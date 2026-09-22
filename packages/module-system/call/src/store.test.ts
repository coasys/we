/**
 * The stage — what the call asks the host for, and how the tiles pack once it gets it.
 *
 * Tested against `signal` alone, with no transport and no presence, because that is the degradation
 * mode the contract promises and it is also the only part of this file that needs a browser. What is
 * checked here is the arithmetic: how a placement resolves, the three keys the host reads off it, and
 * the packing rule that makes "one participant never scrolls" true by construction rather than by
 * inspection.
 */
import { markAction, markState, storeSurface } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ICE_SERVERS } from './mesh';
import { parseCallMessage } from './protocol';
import { createCallStore, STAGE_GAP_PX, STAGE_PADDING_PX } from './store';

/**
 * The reactivity a host lends a module, reduced to the smallest thing that satisfies it.
 *
 * `state` and `action` are the real markers rather than identity functions, so the surface a
 * template sees can be asserted on the same store the arithmetic is. No kernels: the contract's
 * degradation mode is a host that lends none, and this store must still answer every geometry
 * question below.
 */
function makeStore() {
  const signal = <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => (value = next)];
  };
  return createCallStore({ signal, state: markState, action: markAction, kernels: {} }) as ReturnType<
    typeof createCallStore
  > &
    Record<string, () => unknown>;
}

/**
 * A `MediaStream` a media controller can drive, for a harness whose `media` kernel answers.
 *
 * The test-setup stub covers what the *mesh* constructs; the controller also reads tracks by kind,
 * flips `enabled` and stops them, and the tile logic asks a video track whether it is live.
 */
function fakeMicStream() {
  const tracks = [{ kind: 'audio', enabled: true, readyState: 'live', stop() {} }];
  return {
    getTracks: () => [...tracks],
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    addTrack: () => {},
    removeTrack: () => {},
  } as unknown as MediaStream;
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
    // A call you have just joined must not shrink the app on its own. Openness is the panel's own
    // `open` key — the module owns it, because whether the stage is up is a fact about the call —
    // and the bid it makes when it does open is a floating card, which takes nothing from the content.
    const store = makeStore();
    expect(store.stageOpen()).toBe(false);
    expect(store.stageBid().float).toBe(true);
  });

  it('opens on the panel declaration’s show, and stays open on a second press', () => {
    // `show` is how a template's `meta.panels` entry opens a module-owned panel — the host cannot
    // set a flag it does not hold. Idempotent, like `goToCall`'s use of the same setter.
    const store = makeStore();
    store.openStage();
    expect(store.stageOpen()).toBe(true);
    store.openStage();
    expect(store.stageOpen()).toBe(true);
    store.closeStage();
    expect(store.stageOpen()).toBe(false);
  });

  it('always overlays, and leaves everything else about the panel to the host', () => {
    // The module's whole statement about layout, and it is now one sentence: a card, floating, on
    // the bottom edge, when it opens. Position, size, whether it displaces content and whether it
    // covers the screen are all the host's, on the panel's own titlebar.
    const store = makeStore();
    store.toggleStage();

    expect(store.stageBid()).toMatchObject({ edge: 'bottom', size: 'sm', float: true });
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
    // And the four dock keys folded into one bid — the edge doubling as "is it placed" was the
    // shape that hid the stage from a freshly started call.
    expect(store.dockEdge).toBeUndefined();
    expect(store.dockSize).toBeUndefined();
    expect(store.dockFloat).toBeUndefined();
    expect(store.dockAspect).toBeUndefined();
  });
});

/**
 * What a space template may read and call — the marked members — against what stays the module's.
 *
 * The default is private, so a member left unmarked is invisible to a template rather than exposed
 * to it. What is asserted here is the *boundary*: the call's domain is public, every key an
 * existing template already spells as `modules.call.<key>` is public, and the stage's plumbing is
 * not — a template opens the stage by declaring the panel, never by calling into its geometry.
 */
describe('what a template may reach', () => {
  const surface = storeSurface(makeStore());

  it('publishes the call’s state and actions, each with a sentence', () => {
    const states = [
      'callId',
      'callRecordId',
      'liveCalls',
      'tiles',
      'tileStates',
      'media',
      'problem',
      'active',
      'elsewhere',
      'callSpace',
      'canCall',
      'ongoing',
      'focusedId',
      'solo',
      'arrangement',
    ];
    const actions = [
      'returnToCall',
      'goToCall',
      'startCall',
      'continueCall',
      'joinCall',
      'attachAnchor',
      'joinAnchoredCall',
      'leave',
      'toggleAudio',
      'toggleVideo',
      'toggleScreenShare',
      'focusTile',
      'toggleSolo',
      'setArrangement',
      'dismissProblem',
      'reconnectPeer',
    ];
    for (const name of states) expect(surface[name]?.kind, name).toBe('state');
    for (const name of actions) expect(surface[name]?.kind, name).toBe('action');
    for (const [name, member] of Object.entries(surface)) expect(member.doc.length, name).toBeGreaterThan(0);
  });

  it('keeps the stage’s plumbing to itself', () => {
    // Read by the panel declaration and this module's own fragments, which render at chrome tier
    // and see everything; a template has no business with a `MediaStream` or a grid track string.
    for (const name of [
      'stageBid',
      'stageOpen',
      'openStage',
      'closeStage',
      'toggleStage',
      'chromeReserve',
      'setStageBox',
      'stageTemplate',
      'stageRows',
      'pictureStyle',
      'tileCells',
      'tilePins',
      'stageOverflow',
      'tileFaces',
      'localAudio',
    ]) {
      expect(surface[name], name).toBeUndefined();
    }
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
    const aspect = makeStore().stageBid().aspect!;

    expect(aspect.ratio).toBeCloseTo(16 / 9);
    expect(aspect.insetX).toBe(STAGE_PADDING_PX * 2);
    expect(aspect.insetY).toBe(STAGE_PADDING_PX * 2);
  });

  it('fits to the arrangement it is in, rather than solving a new one', () => {
    // With the width fixed, any column count can be made to fit perfectly — so a "fit" that
    // re-solved could rearrange the call under a click that only asked to remove the empty band.
    const store = makeStore();
    store.setArrangement({ columns: 3, rows: 2 });
    const aspect = store.stageBid().aspect!;

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
  function callable(options: { unicast?: string; personal?: boolean; settings?: Record<string, string> } = {}) {
    const signal = <T>(initial: T): [() => T, (next: T) => void] => {
      let value = initial;
      return [() => value, (next: T) => (value = next)];
    };

    let disposed = 0;
    /** Everything the store put on the signalling channel, so the warm-up send can be asserted on. */
    const published: unknown[] = [];
    const scope = {
      capabilities: {
        unicast: options.unicast ?? 'emulated',
        broadcast: true,
        coalesce: true,
        confidential: false,
      },
      channel: () => ({ publish: (payload: unknown) => void published.push(payload), onMessage: () => () => {} }),
      dispose: () => (disposed += 1),
    };

    /** The `RTCConfiguration` each peer connection was built with — where the ICE settings land. */
    const configs: RTCConfiguration[] = [];

    /**
     * Who presence says is in the call.
     *
     * A connection exists per *peer*, so nothing about a peer connection can be asserted on until
     * somebody else is in the room: with an empty roster the mesh is built and then has nothing to
     * build a connection for. `joinedBy` below fills this in and re-runs the reconcile effect, which
     * is what a heartbeat would have done.
     */
    let roster: { agentId: string; activities: { type: string; id: string }[] }[] = [];

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
    /*
      What the store told the `media` kernel it is capturing, in order. The microphone the controller
      acquires is the one stream a listening module ever hears, so a join must publish it and a leave
      must publish `null` — the contract `audioSource` used to meet by string key.
    */
    const publishedMedia: (MediaStream | null)[] = [];
    const mic = fakeMicStream();
    const store = createCallStore({
      signal,
      state: markState,
      action: markAction,
      settings: () => options.settings ?? {},
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
      onDispose: (fn: () => void) => disposers.push(fn),
      // Exactly the kernels the manifest names, as the host would hand them over.
      kernels: {
        ephemeral: () => (options.personal ? null : scope),
        presence: { peers: () => roster, setActivity: () => {}, clearActivity: () => {} },
        records: { create: async () => `rec-${++created}` },
        peerConnection: {
          create: (configuration?: RTCConfiguration) => {
            configs.push(configuration ?? {});
            /*
              Enough of a connection for the mesh to set one up without complaining.

              It used to be `{}`, which was fine only because no test here ever put a second person
              in the call — so nothing was ever built. The mesh reports a failed `addTransceiver`
              rather than throwing, so an empty object does not fail a test; it just fills the run
              with errors about a connection the test never meant to exercise. Negotiation itself is
              `mesh.test.ts`'s subject, against a fake that models the state machine.
            */
            return {
              addTransceiver: () => ({ sender: { replaceTrack: async () => {} } }),
              close: () => {},
              connectionState: 'new',
            } as unknown as RTCPeerConnection;
          },
        },
        media: {
          getUserMedia: async () => mic,
          getDisplayMedia: async () => {
            throw new Error('no screen here');
          },
          publish: (stream: MediaStream | null) => void publishedMedia.push(stream),
          input: () => publishedMedia.at(-1) ?? null,
        },
      },
    } as never) as ReturnType<typeof createCallStore> & Record<string, (...args: unknown[]) => unknown>;

    return {
      store,
      mic,
      configs,
      signalling: published,
      published: publishedMedia,
      scopeDisposals: () => disposed,
      recordsCreated: () => created,
      disposers,
      removeDataset: (uri: string) => notifyRemoved?.(uri),
      /** Somebody else joins the call this store is in, and the roster catches up. */
      joinedBy: (agentId: string) => {
        roster = [...roster, { agentId, activities: [{ type: 'call', id: store.callId() ?? '' }] }];
        for (const run of effects) run();
      },
      signOut: () => {
        me = null;
        for (const run of effects) run();
      },
    };
  }

  it('shows the video when the call starts', async () => {
    // Nothing did this, so pressing the call button produced a control bar and no picture: the panel
    // is placed only while `stageOpen` is true and nothing set it, so the only routes to a visible
    // stage were controls that read as ways to change something already there.
    const { store } = callable();

    await store.startCall();
    await Promise.resolve();

    expect(store.stageOpen()).toBe(true);
    // Floating, so showing it costs the space behind it nothing — the two questions stay separate.
    expect(store.stageBid().float).toBe(true);
  });

  it('stops showing it when the call ends', async () => {
    // "This call is showing", not a preference that outlives the call it was made in.
    const { store } = callable();

    await store.startCall();
    await Promise.resolve();
    store.leave();

    expect(store.stageOpen()).toBe(false);
  });

  it('publishes the microphone it opens, and withdraws it when the call ends', async () => {
    /*
      What replaced `audioSource: 'localAudio'`. The transcriber reads `media.input()` and never
      names this module, so the whole handshake is that this store says what it is capturing — once
      when the device arrives, once more with `null` when it is released. Not on every mute: the
      stream object is the same one and a listener that was torn down and rebuilt per mute is the
      churn the `===` dedupe exists to prevent.
    */
    const { store, mic, published } = callable();

    await store.startCall();
    await Promise.resolve();
    expect(published).toEqual([mic]);

    store.toggleAudio();
    expect(published).toEqual([mic]);

    store.leave();
    expect(published).toEqual([mic, null]);
  });

  it('refuses to join on a host that lends no peer connections, and writes nothing', async () => {
    // The manifest requires the kernel, so registration should refuse first; this is the degradation
    // the contract asks for regardless, and it has to land before the record is written.
    const signal = <T>(initial: T): [() => T, (next: T) => void] => {
      let value = initial;
      return [() => value, (next: T) => (value = next)];
    };
    let created = 0;
    const store = createCallStore({
      signal,
      state: markState,
      action: markAction,
      dataset: () => ({ id: 'ds' }),
      datasetUri: () => 'inmemory://ds',
      selfId: () => 'did:test:me',
      kernels: {
        ephemeral: () => ({
          capabilities: { unicast: 'emulated', broadcast: true, coalesce: true, confidential: false },
          channel: () => ({ publish: () => {}, onMessage: () => () => {} }),
          dispose: () => {},
        }),
        presence: { peers: () => [], setActivity: () => {}, clearActivity: () => {} },
        records: { create: async () => `rec-${++created}` },
      },
    } as never) as ReturnType<typeof createCallStore>;

    await store.startCall();
    await Promise.resolve();

    expect(store.active()).toBe(false);
    expect(created).toBe(0);
    expect(store.problem()).toMatch(/connect/i);
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
  describe('where a call looks for NAT traversal', () => {
    /**
     * The ceiling this removes is real and was invisible: with STUN alone, two peers behind
     * symmetric NAT — ordinary on mobile carriers and corporate networks — cannot reach each other
     * at all, and the failure is indistinguishable from a lost handshake.
     *
     * The module still ships no relay, because a module that requires infrastructure is a module
     * that has stopped being local-first. What it had no business doing was making one unreachable.
     */
    it('uses the servers a deployment configured', async () => {
      const { store, configs, joinedBy } = callable({
        settings: { iceServers: 'turn:alice:s3cret@relay.example.org:3478' },
      });

      await store.startCall();
      await Promise.resolve();
      joinedBy('did:peer');

      expect(configs[0]?.iceServers).toEqual([
        { urls: 'turn:relay.example.org:3478', username: 'alice', credential: 's3cret' },
      ]);
    });

    it('falls back to its own when the setting is empty or unreadable', async () => {
      // Unreadable must degrade to the default and never to "no call can connect" — the value is
      // read on the way into a call, so a typo in a settings box is otherwise a broken app.
      for (const iceServers of ['', 'not a stun server at all']) {
        const { store, configs, joinedBy } = callable({ settings: { iceServers } });
        await store.startCall();
        await Promise.resolve();
        joinedBy('did:peer');
        expect(configs[0]?.iceServers).toEqual(DEFAULT_ICE_SERVERS);
      }
    });

    it('gathers candidates before anybody asks for them', async () => {
      // ICE otherwise starts gathering at `setLocalDescription`, so the STUN round trip is spent
      // inside the handshake rather than while the permission prompt is still on screen.
      const { store, configs, joinedBy } = callable();
      await store.startCall();
      await Promise.resolve();
      joinedBy('did:peer');
      expect(configs[0]?.iceCandidatePoolSize).toBe(1);
    });
  });

  it('warms the signalling channel before the handshake needs it', async () => {
    /*
      The AD4M adapter measures the *first* broadcast on a freshly joined neighbourhood at eighteen
      seconds, and every send after it at tens of milliseconds. Until now the message that paid that
      was the opening SDP offer, so a call's handshake could sit unsent for most of twenty seconds
      while both peers waited on each other — which is why the *start* of a call is the part that
      misbehaves, and why several rounds of leaving and rejoining make it settle down.
    */
    const { store, signalling } = callable();

    await store.startCall();
    await Promise.resolve();

    // Something went first, and it is not signalling: `parseCallMessage` rejects a payload with no
    // `kind`, so every peer drops it. It has to be a real publish to be worth anything, and it has
    // to mean nothing to anybody who receives it.
    expect(signalling.length).toBeGreaterThan(0);
    expect(parseCallMessage(signalling[0])).toBeNull();
  });

  it('reconnects one peer without touching the rest of the call', async () => {
    // The alternative people were left with is leaving and rejoining, which takes everyone's picture
    // down to fix one pair — and, because a roster is presence, briefly tells the room you left.
    const { store } = callable();

    await store.startCall();
    await Promise.resolve();
    const id = store.callId();

    store.reconnectPeer('did:someone');

    expect(store.callId()).toBe(id);
    expect(store.active()).toBe(true);
  });

  it('refuses to reconnect your own tile, which is not a connection', async () => {
    // A no-op in the mesh either way; refused here so `retrying` cannot light up on a tile that
    // nothing is going to repair.
    const { store } = callable();
    await store.startCall();
    await Promise.resolve();

    expect(() => store.reconnectPeer('did:test:me')).not.toThrow();
    expect(store.tileStates().every((tile: { retrying: boolean }) => !tile.retrying)).toBe(true);
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
      state: markState,
      action: markAction,
      effect: (fn: () => void) => effects.push(fn),
      dataset: () => dataset,
      datasetUri: () => uri,
      selfId: () => 'did:test:me',
      onDispose: () => {},
      kernels: {
        ephemeral: () => scope,
        presence: {
          peers: () => [],
          setActivity: (activity: Record<string, unknown>) => activities.push(activity),
          clearActivity: () => {},
        },
        records: { create: async () => `rec-${++created}` },
        peerConnection: { create: () => ({}) as RTCPeerConnection },
      },
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
    let onScreen: string | null = null;
    const activities: Record<string, unknown>[] = [];

    const store = createCallStore({
      signal,
      state: markState,
      action: markAction,
      effect: (fn: () => void) => effects.push(fn),
      dataset: () => dataset,
      datasetUri: () => uri,
      selfId: () => 'did:test:me',
      datasets: { get: () => undefined, open: (target: string) => opened.push(target) },
      onDispose: () => {},
      callOnScreen: () => onScreen,
      kernels: {
        ephemeral: () => scope,
        presence: {
          peers: () => [],
          setActivity: (activity: Record<string, unknown>) => activities.push(activity),
          clearActivity: () => {},
        },
        records: { create: async () => `rec-${++created}` },
        peerConnection: { create: () => ({}) as RTCPeerConnection },
      },
    } as never) as ReturnType<typeof createCallStore> & Record<string, (...args: unknown[]) => unknown>;

    return {
      store,
      opened,
      /** The call activity as peers — and the transcriber — see it. */
      activities,
      /** What the address names, as the host would report it. */
      showing(recordId: string | null) {
        onScreen = recordId;
      },
      goTo(next: { id: string } | null, nextUri: string | null) {
        dataset = next;
        uri = nextUri;
        for (const fn of effects) fn();
      },
      recordsCreated: () => created,
    };
  }

  /**
   * Continuing a past call, which is not the same act as going to one.
   *
   * `goToCall` is a *direction*, so with nothing running it starts a fresh call — right for a
   * launcher, wrong for a row naming the meeting it means. Every "continue this call" button was
   * built out of it, so pressing one wrote a *second* record and joined that: an empty call left in
   * the space, every surface reading `callRecordId` about it, and the transcript going to the record
   * the user had actually chosen. Two calls where one was asked for, disagreeing about which meeting
   * you were in.
   */
  describe('continuing a call that already has a record', () => {
    it('joins the record it is given and writes nothing', async () => {
      const { store, recordsCreated } = railable();

      store.continueCall('rec-from-last-week');
      await Promise.resolve();

      expect(store.active()).toBe(true);
      expect(store.callRecordId()).toBe('rec-from-last-week');
      // The whole bug in one assertion: continuing is not creating.
      expect(recordsCreated()).toBe(0);
    });

    it('lands two people who continue the same record in the same call', async () => {
      // A call *is* its record, so the id is derived rather than minted — which is what makes this
      // safe to press twice, and what makes a second person picking the same meeting up join the
      // first rather than start a parallel one beside it.
      const first = railable();
      const second = railable();

      first.store.continueCall('rec-shared');
      second.store.continueCall('rec-shared');
      await Promise.resolve();

      expect(first.store.callId()).toBe(second.store.callId());
    });

    it('says on its activity that the record was picked back up', async () => {
      /*
        What the transcriber reads to adopt the record before anybody speaks. A started call's record
        is empty and is adopted on the first utterance; a continued one already holds a transcript,
        and without this the two ways into the same call disagreed about whether it had one.
      */
      const { store, activities } = railable();

      store.continueCall('rec-from-last-week');
      await Promise.resolve();

      expect(activities.at(-1)).toMatchObject({ type: 'call', record: 'rec-from-last-week', continued: true });
    });

    it('never says so about a record it just made', async () => {
      const { store, activities } = railable();

      store.goToCall();
      await Promise.resolve();

      expect(activities.at(-1)).toMatchObject({ type: 'call', record: 'rec-1' });
      expect(activities.at(-1)).not.toHaveProperty('continued');
    });

    it('does nothing without a record, rather than starting a call', async () => {
      // The empty-string case a template reaches on a row whose id has not arrived. Starting a fresh
      // call there would be the exact failure this replaced.
      const { store, recordsCreated } = railable();

      store.continueCall('');
      await Promise.resolve();

      expect(store.active()).toBe(false);
      expect(recordsCreated()).toBe(0);
    });
  });

  it('starts the space call when there is not one', async () => {
    const { store } = railable();

    store.goToCall();
    await Promise.resolve();

    expect(store.active()).toBe(true);
    // Getting to a call you have just started means seeing it, and `join` already opens the stage.
    expect(store.stageOpen()).toBe(true);
  });

  it('picks up the call on screen rather than starting one beside it', async () => {
    /*
      The rail's button on a template built around one conversation. Pressing it took the reader
      *out* of the meeting they were plainly in and opened another — the one reading of "start a
      call" nobody wants while a call is on screen.

      A record is continued, not created: the assertion that matters is the count, since starting
      fresh would also leave `active()` true and look right.
    */
    const { store, showing, recordsCreated } = railable();
    showing('rec-from-the-workshop');

    store.goToCall();
    await Promise.resolve();

    expect(store.callRecordId()).toBe('rec-from-the-workshop');
    expect(recordsCreated()).toBe(0);
  });

  it('still starts a fresh call when the address names none', async () => {
    // The ordinary case everywhere but a template built around one call, and the behaviour the
    // launcher had before.
    const { store, recordsCreated } = railable();

    store.goToCall();
    await Promise.resolve();

    expect(store.active()).toBe(true);
    expect(recordsCreated()).toBe(1);
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
    const aspect = store.stageBid().aspect!;

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
    const aspect = store.stageBid().aspect!;
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
      state: markState,
      action: markAction,
      dataset: () => ({ id: 'ds' }),
      datasetUri: () => 'inmemory://ds',
      datasets: { get: () => undefined, open: () => {}, openRef: () => {}, onRemoved: () => () => {} },
      selfId: () => 'did:test:me',
      onDispose: () => {},
      kernels: {
        ephemeral: () => scope,
        presence: { peers: () => [], setActivity: () => {}, clearActivity: () => {} },
        records: { create: async () => `rec-${++created}` },
        peerConnection: { create: () => ({}) as RTCPeerConnection },
      },
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
