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
import type { FollowRelease, FollowWatch } from './protocol';
import {
  blendCost,
  CURSOR_TTL_MS,
  cursorIntervalMs,
  easeMsFor,
  followRelease,
  type HeldCursor,
  isNewer,
  LIVE_PROTOCOL_VERSION,
  type LiveBody,
  liveCursors,
  parseLiveMessage,
  sameAnchor,
  sendFloorMs,
  trimAnchor,
  VIEW_REPEAT_MS,
} from './protocol';

/**
 * Two channels, not one — and the reason is coalescing.
 *
 * Both kinds here are last-write-wins, so both want `coalesce: true`. But the transport holds **one**
 * pending message per channel regardless of kind (see `queued` in the AD4M adapter), so on one tag a
 * moving pointer displaces the driver's own view frame, over and over, for as long as the pointer keeps
 * moving. A follower would then never be framed at all — and never learn why, since every cursor was
 * arriving perfectly.
 *
 * That is not a hypothetical. coasys/ad4m#1133 measures telepresence broadcasts queueing 12–21s behind
 * unrelated zome calls, which is precisely the window in which a held message is displaced rather than
 * sent. Cursors are frequent and views are rare, so on one tag the rare one always loses.
 *
 * Two tags cost a second subscription and a second first-send warm-up. Worth it: the alternative is a
 * feature that works until somebody moves their mouse.
 */
const CURSOR_CHANNEL = 'live';
const VIEW_CHANNEL = 'live-view';

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
  /**
   * A counter kept outside the signal, so bumping never *reads* it.
   *
   * `deps.signal`'s setter takes a value rather than an updater — the smallest shape every framework can
   * supply — so the obvious `setCursorVersion(cursorVersion() + 1)` reads inside whatever scope called
   * it. That froze the app before login: `attach` bumps, `attach` is called from the store's effect, so
   * the effect came to depend on a signal it had just written, re-ran, wrote again, and recursed until
   * the stack went. Nothing here may read a signal it is about to write.
   */
  let cursorSeq = 0;
  const bumpCursors = () => setCursorVersion((cursorSeq += 1));
  const [driving, setDriving] = signal(false);
  const [followingDid, setFollowingDid] = signal('');
  /** Why something could not be done, as a sentence to show. */
  const [problem, setProblem] = signal('');
  /** Synthetic cursors, and the clock that moves them. Development only — see `devCursors.ts`. */
  const [fakeCount, setFakeCount] = signal(readDevCursorCount());
  const [fakeTick, setFakeTick] = signal(0);
  let fakeSeq = 0;
  let fakeTimer: ReturnType<typeof setInterval> | null = null;

  /** Peers' cursors, by did. A plain map: `cursorVersion` is what makes reading it reactive. */
  const held = new Map<string, HeldCursor>();
  /** Where this agent's pointer was when it was last published, to answer "has it moved?". */
  let publishedAt: LiveAnchor | null = null;
  /** The latest position from the host, waiting for the next publish window. */
  let pendingAt: LiveAnchor | null = null;
  let seq = 0;
  /** When a position last went out, for the throttle in {@link schedulePublish}. */
  let lastSentAt = 0;
  /** The one pending send inside a throttle window — never more than one. */
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  let expiryTimer: ReturnType<typeof setInterval> | null = null;
  let viewTimer: ReturnType<typeof setInterval> | null = null;
  let cursorChannel: { publish: (payload: unknown) => void } | null = null;
  let viewChannel: { publish: (payload: unknown) => void } | null = null;
  let detach: (() => void) | null = null;
  /** The handle the channel is open on, so attaching twice for the same space does nothing. */
  let attachedTo: unknown;
  /** The path this agent was last *sent* to, so their own navigation can be told from a driver's. */
  let appliedPath = '';
  /**
   * The running estimate of what one send costs this transport, in milliseconds. Zero until measured.
   *
   * Reset on attach, because it is a property of the medium rather than of this agent: a different space
   * is a different neighbourhood, and carrying a stalled node's estimate into a healthy one would throttle
   * a channel that is coping.
   */
  let publishCost = 0;
  /**
   * Where this agent's surface came to rest after the last frame was applied to it, and when.
   *
   * The pair is what tells a follower's own movement from the movement following put there. The *settled*
   * region rather than the one that was asked for, because applying a region fits it to this screen's box
   * and the rectangle that comes back differs from the request by the aspect ratio — comparing against
   * the request would call every successful apply a movement by the follower.
   */
  let watch: FollowWatch = { anchor: '', at: 0 };
  /** The surface the last applied frame named, so the next one can say whether this screen ever got there. */
  let appliedSurface = '';

  const now = () => Date.now();

  /** What a follower is told when their own movement released them, by which movement it was. */
  const RELEASE_MESSAGE: Record<FollowRelease, string> = {
    navigated: 'Stopped following — you went somewhere else.',
    moved: 'Stopped following — you moved the view.',
    scrolled: 'Stopped following — you scrolled away.',
  };

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

  /**
   * Whether this agent is in a call, read off their own presence.
   *
   * The `call` activity is a shape the call module declares in `contributes.activities`, so this is the
   * medium doing its job rather than a guess — the same way transcription finds the live call. Nothing
   * here names `modules.call`, and a deployment without calls simply never sees one.
   *
   * Self, not peers: `peers()` includes this agent, which is what makes the question answerable at all.
   */
  const inCall = (): boolean => {
    const me = selfId?.();
    if (!me) return false;
    return (presence?.peers() ?? []).some(
      (peer) => peer.agentId === me && Boolean(peer.activities?.some((activity) => activity.type === 'call')),
    );
  };

  // ── The transport ──────────────────────────────────────────────────────────

  /**
   * Open the channel for the space on screen, and close whatever was open before.
   *
   * Re-run when the dataset changes rather than kept for every joined space: this traffic is about a
   * page two people are looking at together, and a cursor in a space nobody is in is pure cost. That
   * is a different decision from a call, which pins its space open because presence *is* its roster.
   */
  /**
   * Whether this space can carry live traffic at all — asked without opening anything.
   *
   * A shared space has a global uri and a personal one does not, which is the same fact the transport
   * would report one step later. Asking it this way rather than reading whether a channel happens to be
   * open is what makes the answer true on the first read: a module store is built before the host
   * publishes its dataset, so anything derived from a *lifecycle* has a window where it is wrong, and
   * the rail reads availability inside that window.
   */
  const shared = () => Boolean(deps.datasetUri?.());

  /**
   * Open the channel for the space on screen if it is not open already.
   *
   * Called from the effect *and* from the two actions, because a module cannot rely on an effect over a
   * late-bound service having ever run — see `moduleHostServices`' revision signal for the failure, of
   * which this is the belt to its braces. Idempotent on the same handle, so calling it on every press
   * costs a comparison.
   */
  function ensureAttached(): void {
    const handle = deps.dataset?.() ?? null;
    /*
      The handle alone decides, and `attachedTo` starts as `undefined` so the first call always attaches
      even for a null one.

      It used to also require a live channel, which meant a null handle — every frame before login — was
      re-attached on every call, and `attach` clears state and bumps. Cheap in itself and not the bug, but
      it is the loop's fuel: nothing should redo work for a space that has not changed.
    */
    if (handle === attachedTo) return;
    attach(handle);
  }

  function attach(handle: unknown): void {
    attachedTo = handle;
    // A property of the medium, not of this agent — see the declaration.
    publishCost = 0;
    appliedSurface = '';
    /*
      A change of space clears the synthetic cursors.

      They are summoned to look at one screen, and carrying them to the next is the same trap the
      persisted count was: the control that removes them is in the call bar, so cursors that follow you
      into a space with no call running cannot be turned off at all.
    */
    if (devCursorsAvailable && fakeCount() > 0) setFakes(0);
    detach?.();
    detach = null;
    cursorChannel = null;
    viewChannel = null;
    held.clear();
    bumpCursors();

    const scope = handle && ephemeral ? ephemeral(handle as never) : null;
    // A personal space has no neighbourhood, so there is nobody to signal. Degrade deliberately: the
    // switch stops being offered rather than being offered and doing nothing.
    if (!scope) return;

    /*
      `coalesce: true` — the one option, and the right one for everything on this channel.

      Every message here is last-write-wins: a cursor position is superseded by the next one and a
      view frame by the next frame, so a send held behind one in flight costs nothing and the
      alternative on a struggling executor is six stuck broadcasts. It is exactly the trade presence
      makes, and exactly the one an SDP offer cannot make — which is why the call's channel sets this
      false and this one does not share it.
    */
    const cursors = scope.channel(CURSOR_CHANNEL, { coalesce: true });
    const views = scope.channel(VIEW_CHANNEL, { coalesce: true });

    /*
      Spend the transport's first-send cost on something that does not matter.

      The AD4M adapter documents it: the first broadcast on a freshly joined neighbourhood has been
      measured at eighteen seconds, and every send after it at tens of milliseconds. Paid by whichever
      message goes first — so a throwaway goes first, rather than the cursor somebody has just switched
      on and is watching for. It parses to nothing on every peer, which is the whole design.
    */
    cursors.publish({ v: LIVE_PROTOCOL_VERSION, warm: true });
    views.publish({ v: LIVE_PROTOCOL_VERSION, warm: true });

    const stopCursors = cursors.onMessage((from, payload) => receive(from, payload));
    const stopViews = views.onMessage((from, payload) => receive(from, payload));

    /*
      What the transport says about its own sends, which is what the rate backs off from.

      Optional on the contract, and absent means "no idea" rather than "fine" — so with no hook the
      estimate stays at zero and the ladder decides alone, exactly as it used to. Present, it is the only
      way this module can tell a healthy node from a stalled one: `publish` is fire-and-forget by design,
      so without this there is nothing to notice.

      A superseded result is skipped on purpose. It means a newer message replaced this one before it went,
      which is the coalescing channel working as intended and says nothing about what a send costs — its
      `ms` is the time until it was dropped, and blending that in would *speed the rate up* on the
      evidence that the transport is behind.
    */
    const stopResults =
      cursors.onPublishResult?.((result) => {
        if (result.superseded) return;
        publishCost = blendCost(publishCost, result);
      }) ?? (() => {});

    cursorChannel = cursors;
    viewChannel = views;
    detach = () => {
      stopCursors();
      stopViews();
      stopResults();
      scope.dispose();
    };
  }

  /**
   * Send one message on the channel its kind belongs to.
   *
   * `seq` is per sender and shared across both, which is what the receiver's ordering check wants: it
   * holds one high-water mark per sender for cursors, and a view frame carries its own. Sharing the
   * counter keeps it monotonic whichever channel a message took.
   */
  function publish(body: LiveBody): void {
    const channel = body.kind === 'view' ? viewChannel : cursorChannel;
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
      else {
        /*
          The gap since this peer's previous position, which is what their cursor is eased over.

          Measured on arrival rather than taken from the sender: what matters is how long this screen
          waited, and congestion between the two of us is exactly the difference. A peer heard from for
          the first time has no gap, and `easeMsFor` gives those a full glide.
        */
        const at_ms = now();
        held.set(from, { at: message.at, at_ms, seq: message.seq, gap_ms: current ? at_ms - current.at_ms : 0 });
      }
      // Started here rather than at construction: there is nothing to expire until somebody's cursor
      // is on screen, and it stops itself once the last one has gone.
      if (held.size) startExpiry();
      else stopExpiry();
      bumpCursors();
      return;
    }

    // A view is worth acting on only from the person this agent chose to follow.
    if (message.kind === 'view' && followingDid() && from === followingDid()) {
      /*
        Say when part of a frame could not be taken up, rather than diverging in silence.

        A frame carries a page, a surface within it and a position on that surface. The page always
        arrives; the position only means something if this screen has the same surface to put it on. When
        it does not — the driver is on a canvas this agent has not opened, or has a different one open —
        the follower ends up on the right page looking at something else, with every control saying they
        are following. That reads as following being broken rather than as reaching its limit.

        Judged against the frame BEFORE this one, which is what makes it sound: applying a frame navigates,
        navigation is not instant, and a surface compared on the same tick as the apply that will change it
        is always a mismatch. A driver republishes every couple of seconds, so the next frame is the
        earliest honest moment to look.
      */
      const mine = view?.frame()?.surface ?? '';
      if (appliedPath && appliedSurface && mine && appliedSurface !== mine) {
        setProblem(`${nameOf(from) || 'They'} are looking at something this screen does not have open.`);
      } else if (appliedSurface) {
        setProblem('');
      }
      appliedSurface = message.frame.surface ?? '';

      appliedPath = message.frame.path;
      // Nothing to compare against until the surface has settled where this put it — see `followRelease`.
      watch = { anchor: '', at: now() };
      view?.apply(message.frame);
    }
  }

  // ── Publishing this agent's pointer ────────────────────────────────────────

  /**
   * Send the pointer if it has moved and there is somebody to send it to.
   *
   * The rate lives in {@link schedulePublish}, not here: this is the send, and it is safe to call as
   * often as anybody likes.
   */
  function flushPointer(): void {
    if (!cursorsOn() || !cursorsAllowed()) return;
    if (!watchers().length) return;
    if (sameAnchor(pendingAt, publishedAt)) return;
    publishedAt = pendingAt;
    lastSentAt = now();
    publish({ kind: 'cursor', at: pendingAt });
  }

  /**
   * Publish at the rate the ladder picks, driven by the pointer itself.
   *
   * ## Why this is not an interval any more
   *
   * It was: a `setInterval` at the ladder's period, started by an effect on the watcher count. That
   * effect read the presence kernel, which is late-bound, so its first run tracked nothing and it never
   * ran again — the rate stayed at whatever the count was when the switch was thrown, and if the other
   * agent had not announced their cursors yet that was **zero, for the rest of the session**. Two people
   * with cursors on, neither ever sending one. The kernel is tracked now and the effect would work; this
   * removes the dependency altogether, which is the better answer to "a timer that must be started or
   * the feature is silently absent".
   *
   * ## Leading edge, then a trailing edge
   *
   * A move with nothing sent recently goes out **immediately**, so a cursor appears the instant it
   * moves rather than up to a ladder-period later. Within the period, one timeout is armed for the
   * remainder — which is what stops a gesture losing its *last* position, the one that matters, since
   * it is where somebody stopped pointing. At most one is ever armed, and it re-reads the latest
   * position when it fires, so a flurry of moves costs one send.
   */
  /**
   * How long to wait between sends: the watcher ladder, or the transport's own cost if that is slower.
   *
   * Two floors, answering different questions. The ladder asks how many people are watching. This asks
   * whether the executor is coping, and it is the one that was missing: the rate was chosen entirely
   * from the roster, so a stalled node was answered by going on publishing at the fastest interval into
   * a queue this agent shares with everything else on it. Cursors were then late *partly because of
   * their own traffic*.
   */
  function sendGapMs(): number {
    return Math.max(cursorIntervalMs(watchers().length), sendFloorMs(publishCost));
  }

  function schedulePublish(): void {
    if (!cursorsOn() || !cursorsAllowed()) return;
    const gap = sendGapMs();
    const since = now() - lastSentAt;
    if (since >= gap) {
      flushPointer();
      return;
    }
    if (trailingTimer) return;
    trailingTimer = setTimeout(() => {
      trailingTimer = null;
      flushPointer();
    }, gap - since);
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
      /*
        Over the gap this peer's messages actually arrived at, not over a fixed duration.

        The easing exists to cover the time until the next position, so its length is a measurement.
        Fixed, it was right while the transport kept up and wrong the moment it did not: a tenth of a
        second of gliding followed by a second of stillness, which reads as the stutter the easing was
        added to remove. Clamped at both ends — see `easeMsFor`.
      */
      easeMs: easeMsFor(cursor.gap_ms),
      node: {
        type: 'we-live-cursor',
        props: { hash: did, name: face('name'), image: face('image') },
      },
    };
  }

  const marks = (): LiveDecoration[] => {
    cursorVersion();
    /*
      The synthetic ones are outside the switch, deliberately.

      They exist to look at cursor *rendering* without finding peers, so gating them on the live toggle
      made the harness need a second, undiscoverable step — press `+` and nothing happens — which is the
      opposite of what a harness is for. A real cursor is somebody else's state and stays behind the
      switch; a fake one is a developer asking to see marks.
    */
    const fakes = fakeMarks();
    if (!cursorsOn() || !cursorsAllowed()) return fakes;
    return [...[...held].map(([did, cursor]) => cursorMark(did, cursor)), ...fakes];
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
    /*
      Only while a call is running.

      The `−  N  +` that manages these lives in the call bar, so marks that outlive the call outlive the
      only control that removes them. Asked of presence rather than of the call module: this agent's own
      `call` activity is a shape that module declares, which is how capabilities are meant to read each
      other, and it means nothing here names `modules.call`.
    */
    if (!inCall()) return [];
    const surface = view?.frame()?.surface ?? '';
    if (!surface) return [];
    // The tick, not the clock — see `devCursorAnchors` for why a recompute must not move anything.
    return devCursorMarks(
      devCursorAnchors(count, surface, surface.startsWith('canvas:') ? 'world' : 'viewport', fakeTick()),
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
    ensureAttached();
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
    ensureAttached();
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
   * Follow, or stop — whichever this press means.
   *
   * The same shape `toggleWheel` has, and for the same reason: a schema cannot choose between two
   * handlers, so the state question is answered where the state is.
   */
  const toggleFollow = () => (following() ? stopFollowing() : follow());

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
    ensureAttached();
    const next = !cursorsOn();
    setCursorsOn(next);
    setProblem('');
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

  /*
    Re-scope as the space changes — and harmless if it never fires, which on a host without the
    services revision signal is exactly what happens. The actions call `ensureAttached` themselves.
  */
  effect?.(() => {
    deps.dataset?.();
    ensureAttached();
  });

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
    // Published from the move rather than from a clock — see `schedulePublish`.
    schedulePublish();
  });

  const stopDecorating = view?.decorate(marks);

  /**
   * Stop following when this agent moves their own view: to another page, or around the one they are on.
   *
   * ## Why panning releases now, where it used to be ignored
   *
   * The rule was "the path, and only the path", on the grounds that a follower is free to pan and look
   * around because the driver's next frame brings them back. That freedom was not real. A driver
   * republishes every couple of seconds, so a follower who panned was dragged back within two seconds
   * and could not examine anything — and being yanked mid-look is worse than a feature that stops
   * politely, because there is nothing to press to make it stop happening. Looking somewhere else is
   * leaving, whether it is a different page or a different corner of this one.
   *
   * ## Why it compares against where the surface settled
   *
   * Applying a region fits it to this screen's box, so the rectangle that comes back is never the one
   * that was asked for. Comparing against the request would read every successful apply as a movement by
   * the follower and release immediately. So the first position seen after an apply is recorded as the
   * settled one, within a short window, and only a change *after* that window counts as this agent.
   *
   * Scrolling releases on a change of *record*, not of offset. A reflow above the viewport moves an
   * offset without anybody touching anything, and a wrongly dropped follow is confusing in a way a
   * slightly sticky one is not.
   */
  effect?.(() => {
    const frame = view?.frame();
    if (!frame || !followingDid()) return;

    const verdict = followRelease(frame, watch, appliedPath, now());
    watch = verdict.watch;
    if (!verdict.release) return;
    stopFollowing();
    notify?.('success', RELEASE_MESSAGE[verdict.release]);
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
    // A counter, not a read — see `cursorSeq`. This one fires from a timer rather than a computation, so
    // it was safe today and would not stay safe.
    fakeTimer = setInterval(() => setFakeTick((fakeSeq += 1)), 100);
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
    if (trailingTimer) clearTimeout(trailingTimer);
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
      () => cursorsAllowed() && shared() && Boolean(view),
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
    canDrive: state(
      // `shared` too: driving publishes view frames over the same channel, so a space with no transport
      // can no more be driven than it can show a cursor.
      () => drivingAllowed() && shared() && Boolean(view && presence),
      'Whether taking the wheel is possible here.',
    ),
    /**
     * Whether the wheel is this agent's to take — free, or already theirs.
     *
     * Paired with `canFollow` below, and the two are mutually exclusive by construction. That is what
     * lets the rail offer exactly one button at a time: taking a wheel somebody else is holding is a
     * different act from following them, and a single control that silently did one or the other
     * would be a control whose label is wrong half the time.
     */
    canTakeWheel: state(
      () => drivingAllowed() && shared() && Boolean(view && presence) && (driving() || !driverPeer()),
      'Whether the wheel is free to take, or already this agent’s.',
    ),
    /** Whether somebody else has the wheel, so following is what is on offer. */
    canFollow: state(
      () => drivingAllowed() && shared() && Boolean(view && presence) && !driving() && Boolean(driverPeer()),
      'Whether somebody else is driving, so this agent could follow them.',
    ),
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
    toggleFollow: action(toggleFollow, 'Follow whoever has the wheel, or stop — whichever this press means.'),
    dismissProblem: action(() => setProblem(''), 'Dismiss the problem message.'),
  };
}

export type LiveStore = ReturnType<typeof createLiveStore>;
