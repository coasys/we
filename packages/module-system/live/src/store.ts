/**
 * What the live module holds: this agent's pointer going out, everybody else's coming in, and who has
 * the wheel.
 *
 * ## Why any of this is code
 *
 * Almost all of the module is data — the toggle, the status strip, the cursor itself are fragments.
 * What cannot be data is the middle: a pointer arrives sixty times a second and must leave at twelve,
 * a peer's cursor has to expire when they stop talking, and a follower has to be handed a frame the
 * moment one arrives. Each of those is a rate or a lifetime, and the schema layer has neither.
 *
 * ## What it never does
 *
 * Reach the other modules. Whether a call is running, who is in it, which canvas is on screen: all of
 * it arrives through presence and the `view` kernel, and nothing here names `modules.call`. The
 * capability this cooperates with most closely is the one it knows least about.
 */
import type { Activity, LiveAnchor, LiveDecoration, ModuleStoreDeps, Peer } from '@we/module-shared';

import {
  devCursorAnchors,
  devCursorMarks,
  devCursorsAvailable,
  readDevCursorCount,
  writeDevCursorCount,
} from './devCursors';
import {
  CURSOR_TTL_MS,
  cursorIntervalMs,
  type HeldCursor,
  isNewer,
  LIVE_PROTOCOL_VERSION,
  type LiveBody,
  liveCursors,
  parseLiveMessage,
  sameAnchor,
  trimAnchor,
  VIEW_REPEAT_MS,
} from './protocol';

/** The channel every live message rides. One tag, so one warm-up cost and one subscription. */
const CHANNEL = 'live';

/** A face on a cursor, looked up by did rather than baked into the mark — see `cursorMark`. */
export interface LiveFace {
  did: string;
  name: string;
  image: string;
}

export function createLiveStore(deps: ModuleStoreDeps) {
  const { signal, effect, state, action, selfId, settings, identities, notify, onDispose } = deps;
  const presence = deps.kernels.presence;
  const ephemeral = deps.kernels.ephemeral;
  const view = deps.kernels.view;

  /** This agent's own switch, per session. Never persisted — see `toggleCursors`. */
  const [cursorsOn, setCursorsOn] = signal(false);
  /**
   * Bumped whenever a peer's cursor moves or expires, so the marks are re-read.
   *
   * `deps.signal`'s setter takes a **value**, not an updater — it is the smallest shape every framework
   * can supply, so there is no `set(n => n + 1)` to reach for. Read-then-write, in one helper.
   */
  const [cursorVersion, setCursorVersion] = signal(0);
  const bumpCursors = () => setCursorVersion(cursorVersion() + 1);
  const [driving, setDriving] = signal(false);
  const [followingDid, setFollowingDid] = signal('');
  /** Why something could not be done, as a sentence to show. */
  const [problem, setProblem] = signal('');
  /** Synthetic cursors, and the clock that moves them. Development only — see `devCursors.ts`. */
  const [fakeCount, setFakeCount] = signal(readDevCursorCount());
  const [fakeTick, setFakeTick] = signal(0);
  let fakeTimer: ReturnType<typeof setInterval> | null = null;

  /** Peers' cursors, by did. A plain map: `cursorVersion` is what makes reading it reactive. */
  const held = new Map<string, HeldCursor>();
  /** Where this agent's pointer was when it was last published, to answer "has it moved?". */
  let publishedAt: LiveAnchor | null = null;
  /** The latest position from the host, waiting for the next publish window. */
  let pendingAt: LiveAnchor | null = null;
  let seq = 0;
  let publishTimer: ReturnType<typeof setInterval> | null = null;
  let expiryTimer: ReturnType<typeof setInterval> | null = null;
  let viewTimer: ReturnType<typeof setInterval> | null = null;
  let channel: { publish: (payload: unknown) => void } | null = null;
  let detach: (() => void) | null = null;
  /** The path this agent was last *sent* to, so their own navigation can be told from a driver's. */
  let appliedPath = '';

  const now = () => Date.now();

  // ── What the settings permit ────────────────────────────────────────────────

  /**
   * Whether cursors are allowed here at all.
   *
   * `restrict`, so a community that has switched them off cannot be overridden by a member and a
   * member who has switched them off cannot be overridden by the community — see the setting's
   * declaration. What is resolved here is only *permission*; the switch below is this agent's own.
   */
  const cursorsAllowed = () => settings?.().cursors !== false;
  const drivingAllowed = () => settings?.().driving !== false;

  // ── Who is here, and who is listening ──────────────────────────────────────

  const others = (): Peer[] => (presence?.peers() ?? []).filter((peer) => peer.agentId !== selfId?.());

  const activityOf = (peer: Peer, type: string) => peer.activities?.find((activity) => activity.type === type);

  /**
   * One field of an activity this module declared.
   *
   * `Activity` is a union with an open escape hatch for exactly these — a module's own types — so
   * narrowing it by a `type` held in a variable is not something the type system can do. What carries
   * the contract instead is `contributes.activities`, which the presence kernel checks published
   * activities against in development; this is the read side of that declaration, in one place rather
   * than a cast per call site.
   */
  const field = (activity: Activity | undefined, key: string): unknown =>
    activity ? (activity as unknown as Record<string, unknown>)[key] : undefined;

  /**
   * Peers whose cursors are on — the ones worth publishing to, and the ones to draw.
   *
   * Both halves come from the same list on purpose: the switch is one switch, so anybody publishing is
   * also watching. A peer who has it off is not sent anything and shows nothing, which is the cheapest
   * possible answer for the common case of one person in a space.
   */
  const watchers = (): Peer[] => others().filter((peer) => field(activityOf(peer, 'live'), 'cursors') === true);

  /** Whoever has the wheel, if anybody. The earliest claim wins — see `takeWheel`. */
  const driverPeer = (): Peer | null => {
    let best: { peer: Peer; since: number } | null = null;
    for (const peer of others()) {
      const activity = activityOf(peer, 'driving');
      if (!activity) continue;
      const claimed = field(activity, 'since');
      const since = typeof claimed === 'number' ? claimed : 0;
      if (!best || since < best.since) best = { peer, since };
    }
    return best?.peer ?? null;
  };

  const nameOf = (did: string) => identities?.get(did)?.name ?? '';

  // ── The transport ──────────────────────────────────────────────────────────

  /**
   * Open the channel for the space on screen, and close whatever was open before.
   *
   * Re-run when the dataset changes rather than kept for every joined space: this traffic is about a
   * page two people are looking at together, and a cursor in a space nobody is in is pure cost. That
   * is a different decision from a call, which pins its space open because presence *is* its roster.
   */
  function attach(handle: unknown): void {
    detach?.();
    detach = null;
    channel = null;
    held.clear();
    bumpCursors();

    const scope = handle && ephemeral ? ephemeral(handle as never) : null;
    if (!scope) return;

    /*
      `coalesce: true` — the one option, and the right one for everything on this channel.

      Every message here is last-write-wins: a cursor position is superseded by the next one and a
      view frame by the next frame, so a send held behind one in flight costs nothing and the
      alternative on a struggling executor is six stuck broadcasts. It is exactly the trade presence
      makes, and exactly the one an SDP offer cannot make — which is why the call's channel sets this
      false and this one does not share it.
    */
    const live = scope.channel(CHANNEL, { coalesce: true });

    /*
      Spend the transport's first-send cost on something that does not matter.

      The AD4M adapter documents it: the first broadcast on a freshly joined neighbourhood has been
      measured at eighteen seconds, and every send after it at tens of milliseconds. Paid by whichever
      message goes first — so a throwaway goes first, rather than the cursor somebody has just switched
      on and is watching for. It parses to nothing on every peer, which is the whole design.
    */
    live.publish({ v: LIVE_PROTOCOL_VERSION, warm: true });

    const stop = live.onMessage((from, payload) => receive(from, payload));
    channel = live;
    detach = () => {
      stop();
      scope.dispose();
    };
  }

  function publish(body: LiveBody): void {
    if (!channel) return;
    seq += 1;
    channel.publish({ v: LIVE_PROTOCOL_VERSION, seq, ...body });
  }

  /**
   * A message from a peer.
   *
   * `from` is the transport's, never the payload's: a self-reported sender would let one peer draw a
   * cursor wearing somebody else's name, and on this backend the executor supplies it.
   */
  function receive(from: string, payload: unknown): void {
    const message = parseLiveMessage(payload);
    if (!message || from === selfId?.()) return;

    if (message.kind === 'cursor') {
      // Only from somebody this agent can see, and only while watching. A peer publishing at an agent
      // who has switched cursors off is a peer whose messages are simply dropped.
      if (!cursorsOn() || !cursorsAllowed()) return;
      const current = held.get(from);
      if (!isNewer(current, message.seq)) return;
      if (!message.at) held.delete(from);
      else held.set(from, { at: message.at, at_ms: now(), seq: message.seq });
      // Started here rather than at construction: there is nothing to expire until somebody's cursor
      // is on screen, and it stops itself once the last one has gone.
      if (held.size) startExpiry();
      else stopExpiry();
      bumpCursors();
      return;
    }

    // A view is worth acting on only from the person this agent chose to follow.
    if (message.kind === 'view' && followingDid() && from === followingDid()) {
      appliedPath = message.frame.path;
      view?.apply(message.frame);
    }
  }

  // ── Publishing this agent's pointer ────────────────────────────────────────

  /**
   * Send the pointer if it has moved and there is somebody to send it to.
   *
   * Called on a timer rather than on every move, and the timer's period is what the rate ladder
   * decides — see `cursorIntervalMs`. Holding the latest position and sending it on the tick is what
   * makes the rate a rate: sending on the move and throttling would drop the *last* position of a
   * gesture, which is the one that matters, since it is where somebody stopped pointing.
   */
  function flushPointer(): void {
    if (!cursorsOn() || !cursorsAllowed()) return;
    if (!watchers().length) return;
    if (sameAnchor(pendingAt, publishedAt)) return;
    publishedAt = pendingAt;
    publish({ kind: 'cursor', at: pendingAt });
  }

  /**
   * Run the publish timer at the rate the ladder picks — and only while there is anything to publish.
   *
   * The gate is the same condition `flushPointer` checks, moved up to the timer, which is strictly
   * better: a store is constructed once per app whether or not anybody switches cursors on, so a timer
   * started regardless is one every session pays for a feature most sessions never use. It is also a
   * live handle that keeps a Node process alive, and `generate-context` builds every module's store —
   * which is how an unconditional interval here turned the build into a hang with every file already
   * written.
   */
  function retime(watching: number): void {
    if (publishTimer) clearInterval(publishTimer);
    publishTimer = null;
    if (!cursorsOn() || !cursorsAllowed() || watching <= 0) return;
    publishTimer = setInterval(flushPointer, cursorIntervalMs(watching));
  }

  // ── What to draw ───────────────────────────────────────────────────────────

  /**
   * One peer's cursor as a mark.
   *
   * The name and the picture are read through an **expression** rather than written in as values, and
   * that is not a style choice. A mark is drawn once while its id is present — the graph and the
   * overlay both say so, because keying by id is what lets a moving cursor be a transform rather than
   * a remount — so a name baked in at the moment a cursor first appears would never update, and a
   * peer's profile routinely arrives after their first message. Reading `faces` keeps the node stable
   * and the face live.
   *
   * The did is interpolated into the expression as a literal, which is safe for the one reason worth
   * checking: a DID has no quotes in it.
   */
  function cursorMark(did: string, cursor: HeldCursor): LiveDecoration {
    const face = (field: string) => ({ $: `find(modules.live.faces, { did: '${did}' }).${field}` });
    return {
      id: did,
      at: cursor.at,
      // Eased: a cursor arrives in steps and is drawn as continuous movement. See the transition.
      ease: true,
      node: {
        type: 'we-live-cursor',
        props: { hash: did, name: face('name'), image: face('image') },
      },
    };
  }

  const marks = (): LiveDecoration[] => {
    cursorVersion();
    if (!cursorsOn() || !cursorsAllowed()) return [];
    const real = [...held].map(([did, cursor]) => cursorMark(did, cursor));
    return [...real, ...fakeMarks()];
  };

  /**
   * Synthetic cursors, appended — development only, and nothing in a production build.
   *
   * Placed in whichever surface this agent is actually on, so they land where real ones would: world
   * units on a canvas, fractions of the content box anywhere else. `fakeTick` is what moves them; see
   * the timer below for why they move at all.
   */
  function fakeMarks(): LiveDecoration[] {
    if (!devCursorsAvailable) return [];
    const count = fakeCount();
    if (count <= 0) return [];
    fakeTick();
    const frame = view?.frame();
    const surface = frame?.surface ?? '';
    if (!surface) return [];
    return devCursorMarks(
      devCursorAnchors(count, surface, surface.startsWith('canvas:') ? 'world' : 'viewport', now()),
    );
  }

  // ── Driving, and following ─────────────────────────────────────────────────

  function setActivity(activity: Activity): void {
    presence?.setActivity(activity);
  }

  const publishView = () => {
    if (!driving() || !view) return;
    publish({ kind: 'view', frame: view.frame() });
  };

  /**
   * Take the wheel, so anybody who opts in follows this screen.
   *
   * `since` is what makes two people pressing it at once resolve the same way on every screen: the
   * earliest claim wins, which is the same shape of tie-break the call's mesh and the tab coordinator
   * use, and it needs no round trip to agree on.
   */
  const takeWheel = () => {
    if (!drivingAllowed()) {
      setProblem('Driving is switched off in this space.');
      return;
    }
    stopFollowing();
    setDriving(true);
    setActivity({ type: 'driving', since: now() });
    publishView();
    startViewRepeat();
  };

  const releaseWheel = () => {
    setDriving(false);
    stopViewRepeat();
    presence?.clearActivity('driving');
  };

  /**
   * Take the wheel or give it up, whichever this press means.
   *
   * One action rather than two, because a schema cannot choose between two handlers: `$action` is a
   * token and an expression resolves to a value, so the obvious ternary typechecks, validates, renders
   * — and always takes the same branch. Only the store can ask which state it is in at the moment of
   * the click, which is the same reason the call module's `goToCall` is one action for four states.
   */
  const toggleWheel = () => (driving() ? releaseWheel() : takeWheel());

  /** Follow whoever has the wheel. Nothing to do where nobody has it. */
  const follow = () => {
    const driver = driverPeer();
    if (!driver) return;
    if (driving()) releaseWheel();
    setFollowingDid(driver.agentId);
    setActivity({ type: 'following', id: driver.agentId });
    appliedPath = '';
  };

  function stopFollowing(): void {
    const was = followingDid();
    if (!was) return;
    setFollowingDid('');
    presence?.clearActivity('following', was);
  }

  const unfollow = () => stopFollowing();

  /**
   * Whether this agent is following somebody, **derived** rather than remembered.
   *
   * `followingDid` is the choice; this is whether the choice still means anything. Deriving it is what
   * makes the answer true the instant a driver's presence expires, rather than one effect later —
   * presence is a heartbeat, so somebody's laptop closing is a fact that arrives by *absence*, and a
   * cached boolean would go on reporting a follow of nobody until something happened to re-run.
   *
   * The effect below still clears the published activity, which is the part that has to be told rather
   * than worked out. This is the read; that is the announcement.
   */
  const following = () => {
    const did = followingDid();
    if (!did) return false;
    return driverPeer()?.agentId === did;
  };

  /**
   * Switch this agent's cursors on or off — both halves of it, since it is one switch.
   *
   * Not persisted, deliberately. Broadcasting where your pointer is, to everybody in a space, is the
   * kind of thing to opt into for a conversation rather than to discover is still on a week later. The
   * session is the right lifetime, and the activity going out is what tells peers to start publishing.
   */
  const toggleCursors = () => {
    if (!cursorsAllowed()) {
      setProblem('Live cursors are switched off in this space.');
      return;
    }
    const next = !cursorsOn();
    setCursorsOn(next);
    setProblem('');
    // The switch is half of what decides whether the publish timer runs at all — see `retime`.
    retime(watchers().length);
    if (next) {
      setActivity({ type: 'live', cursors: true });
    } else {
      presence?.clearActivity('live');
      held.clear();
      stopExpiry();
      publishedAt = null;
      bumpCursors();
      // Say so rather than leaving peers to the TTL: switching off is deliberate, and three seconds
      // of a cursor that is no longer being updated is three seconds of a lie.
      publish({ kind: 'cursor', at: null });
    }
  };

  // ── Wiring ─────────────────────────────────────────────────────────────────

  effect?.(() => attach(deps.dataset?.() ?? null));

  /**
   * Follow the rate ladder as peers come and go.
   *
   * The count is read and passed in rather than read inside `retime`, so the dependency is visible
   * here: this effect exists *because* of the count, and a `retime()` that read it for itself would
   * look like an effect with no reason to re-run.
   */
  effect?.(() => retime(watchers().length));

  /**
   * Drop cursors nobody has heard about — while there are any to drop.
   *
   * On a timer rather than computed at read time, because the read is what draws them: a cursor whose
   * peer went quiet would otherwise stay on screen until something else happened to change, which on a
   * still page is indefinitely.
   *
   * **Started and stopped rather than left running**, and it is worth saying why out loud. A store is
   * constructed once per app whether or not anybody ever switches cursors on, so an interval started
   * here unconditionally is an interval every session pays for a feature most sessions do not use. It
   * is also a live handle, which in Node keeps the process alive: `generate-context` builds every
   * module's store to catalogue it, and two unconditional intervals made the build hang for ever with
   * every file already written. A module's constructor should leave nothing running.
   */
  function sweepCursors(): void {
    const { live, expired } = liveCursors(held, now());
    if (expired.length) {
      held.clear();
      for (const [did, cursor] of live) held.set(did, cursor);
      bumpCursors();
    }
    if (!held.size) stopExpiry();
  }

  function startExpiry(): void {
    if (expiryTimer) return;
    expiryTimer = setInterval(sweepCursors, CURSOR_TTL_MS / 2);
  }

  function stopExpiry(): void {
    if (!expiryTimer) return;
    clearInterval(expiryTimer);
    expiryTimer = null;
  }

  /**
   * Repeat the view for a follower who arrived while the driver was sitting still.
   *
   * Only while this agent is driving, for the reason above: nobody is listening otherwise, and a store
   * that leaves a timer running has made every session pay for it.
   */
  function startViewRepeat(): void {
    if (viewTimer) return;
    viewTimer = setInterval(publishView, VIEW_REPEAT_MS);
  }

  function stopViewRepeat(): void {
    if (!viewTimer) return;
    clearInterval(viewTimer);
    viewTimer = null;
  }

  /** Publish the view the moment it changes, rather than waiting out the repeat. */
  effect?.(() => {
    if (!driving()) return;
    view?.frame();
    publishView();
  });

  const stopPointer = view?.onPointer((at) => {
    pendingAt = at ? trimAnchor(at) : null;
  });

  const stopDecorating = view?.decorate(marks);

  /**
   * Stop following when this agent navigates somewhere themselves.
   *
   * The path, and only the path: a follower is free to pan and look around, and the driver's next
   * frame brings them back, which is what following means. Going to a different *page* is not looking
   * around — it is leaving — so it releases.
   */
  effect?.(() => {
    const frame = view?.frame();
    if (!frame || !followingDid()) return;
    if (!appliedPath || frame.path === appliedPath) return;
    stopFollowing();
    notify?.('success', 'Stopped following.');
  });

  /**
   * Withdraw the published `following` activity once there is nobody to follow.
   *
   * Only the announcement: `following` above already answers no, derived, so nothing on screen is
   * waiting for this. What it stops is this agent telling the space it follows somebody who has gone.
   */
  effect?.(() => {
    if (followingDid() && !following()) stopFollowing();
  });

  /**
   * Move the synthetic cursors, and only while there are some.
   *
   * A timer rather than an animation frame: the marks are read through the decoration accessor, so what
   * is wanted is a signal changing at roughly the rate a real cursor arrives — which is also the rate
   * worth judging the transition against. An animation frame would move them at sixty a second and show
   * a smoothness no real cursor ever has.
   */
  const retimeFakes = (count: number) => {
    if (fakeTimer) clearInterval(fakeTimer);
    fakeTimer = null;
    if (!devCursorsAvailable || count <= 0) return;
    fakeTimer = setInterval(() => setFakeTick(fakeTick() + 1), 100);
  };
  if (devCursorsAvailable) retimeFakes(fakeCount());

  const setFakes = (count: number) => {
    const next = writeDevCursorCount(count);
    setFakeCount(next);
    retimeFakes(next);
    bumpCursors();
  };

  onDispose?.(() => {
    if (fakeTimer) clearInterval(fakeTimer);
    stopPointer?.();
    stopDecorating?.();
    if (publishTimer) clearInterval(publishTimer);
    stopExpiry();
    stopViewRepeat();
    if (cursorsOn()) presence?.clearActivity('live');
    releaseWheel();
    stopFollowing();
    detach?.();
  });

  return {
    /** Whether this agent is publishing and watching cursors. */
    cursorsOn: state(cursorsOn, 'Whether this agent’s pointer is shared, and other people’s shown.'),
    /** Whether cursors can be offered here at all — a space or a member may refuse them. */
    canShareCursors: state(
      () => cursorsAllowed() && Boolean(ephemeral && view),
      'Whether live cursors are possible here — false in a space with no transport, or where they are switched off.',
    ),
    /** How many peers have their cursors on. What a readout counts. */
    watching: state(() => watchers().length, 'How many other people here have live cursors on.'),
    /**
     * The face for each cursor on screen, looked up by did.
     *
     * Read by the cursor marks through an expression rather than baked into them — see `cursorMark`
     * for why a mark's node has to stay stable while the face behind it changes.
     */
    faces: state((): LiveFace[] => {
      cursorVersion();
      return [...held.keys()].map((did) => ({
        did,
        name: nameOf(did),
        image: identities?.get(did)?.avatar ?? '',
      }));
    }, 'One entry per cursor on screen — { did, name, image }.'),

    driving: state(driving, 'Whether this agent has the wheel.'),
    /** Who has the wheel, as a name to show. Empty when nobody does. */
    driverName: state(() => {
      const driver = driverPeer();
      return driver ? nameOf(driver.agentId) || 'Someone' : '';
    }, 'The name of whoever is driving, or empty when nobody is.'),
    canDrive: state(() => drivingAllowed() && Boolean(view && presence), 'Whether taking the wheel is possible here.'),
    following: state(following, 'Whether this agent is following somebody’s screen.'),
    followingName: state(
      () => (following() ? nameOf(followingDid()) || 'Someone' : ''),
      'The name of whoever this agent is following.',
    ),
    problem: state(problem, 'Why something could not be done, as a sentence to show, or empty.'),

    /*
      Synthetic cursors, present only in a development build.

      Spread conditionally at *definition* time rather than gated inside the action, so a production
      bundle has no `addFakeCursor` to call rather than one that does nothing — the same shape the call
      module's fake participants take.
    */
    ...(devCursorsAvailable
      ? {
          fakeCursorCount: state(fakeCount, 'How many synthetic cursors are on screen — development only.'),
          addFakeCursor: action(() => setFakes(fakeCount() + 1), 'One more synthetic cursor.'),
          removeFakeCursor: action(() => setFakes(fakeCount() - 1), 'One fewer synthetic cursor.'),
        }
      : {}),

    toggleCursors: action(toggleCursors, 'Share this agent’s pointer and show other people’s, or stop.'),
    takeWheel: action(takeWheel, 'Take the wheel, so anybody who opts in follows this screen.'),
    releaseWheel: action(releaseWheel, 'Give up the wheel.'),
    toggleWheel: action(toggleWheel, 'Take the wheel, or give it up — whichever this press means.'),
    follow: action(follow, 'Follow whoever has the wheel.'),
    unfollow: action(unfollow, 'Stop following.'),
    dismissProblem: action(() => setProblem(''), 'Dismiss the problem message.'),
  };
}

export type LiveStore = ReturnType<typeof createLiveStore>;
