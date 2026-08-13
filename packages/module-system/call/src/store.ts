/**
 * The call store — what a template can read and drive.
 *
 * Written against `ModuleStoreDeps` alone: `signal` and `effect` for reactivity, `ephemeral` for
 * transport, `presence` for membership, `dataset`/`selfId` for scope. It imports no framework and no
 * backend, which is what lets the whole module ship as schema fragments.
 *
 * ## The shape of the thing
 *
 * Three collaborators, each ignorant of the others' failure modes:
 *
 * - **presence** owns *who is in the call* (an activity, expiring on TTL)
 * - **the mesh** owns *connections to them* (reconciled against that roster)
 * - **the media controller** owns *this agent's devices*
 *
 * This file is the only place they meet, and the meeting is deliberately one-directional: presence
 * drives the mesh, and media drives what the mesh sends. Nothing flows back — the mesh never tells
 * presence who is in the call, because a connection failing is not the same as a peer leaving.
 */
import type { MediaSettings } from '@we/module-shared';
import type { Focus, ModuleStoreDeps, Peer } from '@we/module-shared';
import { activitiesOfType } from '@we/module-shared';
import { planEphemeral } from '@we/module-shared';

import { createMediaController, type MediaController } from './media';
import { type CallMesh, createCallMesh } from './mesh';
import { anchoredCallId, spaceCallId } from './protocol';

/**
 * One participant, flattened for a template.
 *
 * Flattened rather than nested so a fragment can reach everything with a plain `$tile.stream` —
 * the same reason `PresentAgent` flattens `tone` onto the peer.
 */
export interface CallTile {
  id: string;
  did: string;
  /** `null` until that peer's media arrives, which is normal for the first second or two. */
  stream: MediaStream | null;
  isSelf: boolean;
}
// No `name` or `avatar` here, and the omission is deliberate rather than an oversight. Both existed,
// both were always undefined, and both were an open invitation to the one mistake this type is
// shaped to prevent: a profile arriving is not a reason to remount somebody's video. They are looked
// up by id instead — see `tileFaces`.

/**
 * A participant's *volatile* state, deliberately kept out of {@link CallTile}.
 *
 * This split is not tidiness, it is the fix for a visible bug. `$each` renders through Solid's
 * `<For>`, which is keyed by reference, so any change to a tile object remounts that row — and a
 * remounted row builds a new `<video>`, which drops and re-attaches `srcObject`. With mute state on
 * the tile, muting your microphone blanked your own video.
 *
 * So the tile carries only what identifies a participant and their stream, and changes rarely. Their
 * flags live here and a fragment reaches them with `$find` over `modules.call.tileStates` — which
 * resolves inside the renderer's prop memo, so it stays reactive while the row itself never remounts.
 */
export interface CallTileState {
  id: string;
  /** Render `contain` rather than `cover` — a cropped desktop is unreadable. From the roster. */
  isScreen: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  /** `undefined` for the self tile, which has no connection to itself. */
  connection?: RTCPeerConnectionState;
  /** This tile is the one the stage is giving most of its room to. */
  focused: boolean;
  /**
   * There is a picture to show right now: a live video track, *and* a sender who says it is on.
   *
   * What decides video-or-avatar, and it has to be this rather than "is there a stream" because the
   * mesh creates a peer's `MediaStream` when the peer appears in the roster, not when media starts
   * flowing. That object is non-null and empty for the whole negotiation, so a check for its
   * existence renders a `<video>` over nothing and paints a black rectangle — the blank tile that
   * outlasted two attempts to explain it, because every explanation assumed the stream was missing
   * when it was present and empty.
   *
   * The roster half matters too: a muted camera keeps its track live and simply stops producing
   * frames, so the track alone cannot tell "off" from "on but silent".
   */
  hasPicture: boolean;
  /**
   * A picture is expected and has not arrived — the honest "wait, this is working" state.
   *
   * Expected, not merely absent: a peer who has turned their camera off is not connecting, and
   * spinning at them forever would be a lie about a state that is never going to change.
   */
  connecting: boolean;
  /** The connection gave up. Not something waiting will fix, so it must not read as progress. */
  failed: boolean;
}

/**
 * Where the call's video sits — one question, six answers.
 *
 * This replaced a four-state mode that one button cycled through, and the collapse is the point.
 * That button was encoding three things at once — whether the video showed, where it was, and how
 * big — so it could not have a clear icon, and reaching any given state took up to three clicks
 * through states you did not want.
 *
 * They are all *placements*, including the two that look like modes. `float` takes no room and
 * overlays, `full` takes all of it; the four edges take some and give the rest back. So the whole
 * arrangement is a radio choice, which is a thing people already know how to read — and visibility
 * becomes an ordinary toggle beside it rather than a stop on a cycle.
 *
 * Size is deliberately absent: it is dragged, and the host owns it. See `dockGeometry`.
 */
export type CallPlacement = 'float' | 'left' | 'right' | 'top' | 'bottom' | 'full';

/** Which edge a docked stage occupies — the subset of {@link CallPlacement} that takes room. */
export type CallDockEdge = 'left' | 'right' | 'top' | 'bottom';

export interface CallStoreDeps extends ModuleStoreDeps {
  /** Overridable for tests; defaults to the browser's WebRTC and media APIs. */
  createPeerConnection?: () => RTCPeerConnection;
}

/**
 * Whether a stream is actually carrying a picture, rather than merely existing.
 *
 * The distinction the tiles turned on and nobody had drawn. `mesh.ts` builds a peer's `MediaStream`
 * at the moment the peer joins the roster and adds tracks to it later, as `ontrack` fires — so the
 * object is non-null and empty for the whole of negotiation, and on a slow transport that is many
 * seconds. Truthiness of the stream answers "do I know about this person", never "is there anything
 * to watch".
 */
function hasLiveVideo(stream: MediaStream | null): boolean {
  return !!stream?.getVideoTracks().some((track) => track.readyState === 'live');
}

export function createCallStore(deps: CallStoreDeps) {
  const { signal, effect, dataset, datasetUri, selfId, ephemeral, presence, identities, onDispose } = deps;

  /**
   * The transport scope this call holds, so leaving can give it back.
   *
   * `EphemeralScope` is refcounted, and every join acquired one and never disposed it. Ten joins
   * left ten refs outstanding, so the backend's signal handler for that perspective was never
   * removed for the life of the app. `PresenceStore` has always done this correctly; this is the
   * same discipline.
   */
  let scopeHandle: { dispose(): void } | null = null;

  /**
   * An agent id, joined to whatever the host knows about them, in the shape an avatar wants.
   *
   * Computed at the point of display rather than stored, and that is the whole trick: a profile that
   * arrives late must change the picture without changing the roster, because changing the roster
   * remounts video elements. Reading `identities.get` inside a derived value is what makes the
   * picture appear on its own when the fetch lands.
   *
   * `hash` is always supplied, never as a fallback for a missing image: it seeds a generated avatar
   * that is stable per agent, so somebody with no profile picture is still visually distinct from
   * everybody else with no profile picture — and stays the same person between renders. `image` wins
   * where a real one exists.
   */
  function faceOf(agentId: string): { image?: string; hash: string; name?: string } {
    const profile = identities?.get(agentId);
    // Asking is idempotent and the host deduplicates in-flight requests, so this is safe on a hot
    // path — and it is the only thing that ever triggers a fetch for a peer nobody has looked up.
    if (!profile) identities?.fetch(agentId);
    return { image: profile?.avatar, hash: agentId, name: profile?.name };
  }

  const [callId, setCallId] = signal<string | null>(null);
  const [tiles, setTiles] = signal<CallTile[]>([]);
  const [tileStates, setTileStates] = signal<CallTileState[]>([]);
  const [visible, setVisible] = signal(false);
  /**
   * Floating by default, because the first press of a button should not reshape the workspace.
   *
   * Docking is a decision to give up room, and the opening move is usually a glance at who is there
   * rather than a commitment to watch. Starting docked meant one click on an unlabelled control
   * shrank the whole app; starting floating means the panel appears over what you were doing and the
   * user docks it when they decide it is worth the space.
   */
  const [placement, setPlacement] = signal<CallPlacement>('float');
  /**
   * Whose video the stage is giving most of its room to, or `null` for an even grid.
   *
   * A signal of its own rather than a field on {@link CallTile}, for the reason the tile cache
   * exists at all: `$each` renders through a reference-keyed `<For>`, so writing focus onto a tile
   * object would remount that row and drop its `srcObject`. Clicking a participant to focus them
   * would have blanked the participant you clicked — the mute bug again, with a worse trigger.
   */
  const [focusedId, setFocusedId] = signal<string | null>(null);
  /**
   * Whether the *user* chose the current focus, as opposed to a screen share claiming it.
   *
   * Without this, auto-focus and the user fight: someone starts sharing, you focus a person
   * instead, and the next roster heartbeat drags you back. A screen share is a strong hint about
   * what matters, but only until somebody says otherwise.
   */
  let focusIsManual = false;
  /** The peers already sharing, so a share that has been running for ten minutes cannot re-claim focus. */
  let sharingPeers = new Set<string>();
  const [media, setMedia] = signal<MediaSettings>({
    audioEnabled: true,
    videoEnabled: true,
    screenShareEnabled: false,
  });
  /** Surfaced rather than logged: "the call cannot start here" is something the user must see. */
  const [problem, setProblem] = signal<string | null>(null);

  /**
   * Named, because it is the one problem that can resolve itself.
   *
   * Every other message here describes something structural — no space, no transport — that stays
   * true until the user does something elsewhere. This one is about a permission, and a permission
   * can be granted a moment later; leaving it on screen after the camera starts working is the
   * app telling the user something it can plainly see is no longer so.
   */
  const MEDIA_BLOCKED = "WE could not reach your camera or microphone. Check this site's permissions in your browser.";

  /**
   * The camera specifically, refused when the user asked for it.
   *
   * Separate from `MEDIA_BLOCKED` because the two clear on different conditions: this one is still
   * true while the microphone works perfectly well, so clearing it on "we have a stream" — which is
   * what the other one wants — would make it flash and vanish in exactly the case it exists for.
   */
  const CAMERA_BLOCKED = "WE could not turn your camera on. Check this site's camera permission in your browser.";
  /**
   * The microphone this agent is sending, as a signal rather than a read through to the controller.
   *
   * It has to be a signal because of *when* the stream appears. `join` sets `callId` and only then
   * builds the controller and awaits `getUserMedia`, so a consumer that derived the stream from
   * `callId` would be woken once — while there is still nothing to hear — and never again. The
   * transcriber sat on `no-audio` for the whole call, and its launcher never appeared.
   *
   * Written from `onStateChanged`, which fires when devices are acquired and on every mute since.
   * The controller returns the same `MediaStream` object each time, so those later writes dedupe on
   * `===` and consumers do not churn — which is what keeps muting from tearing down and rebuilding
   * the transcription pipeline. A muted track stays in the stream and simply goes silent.
   */
  const [localAudio, setLocalAudio] = signal<MediaStream | null>(null);

  let mesh: CallMesh | null = null;
  let controller: MediaController | null = null;
  let remoteStreams = new Map<string, MediaStream>();
  let peerStates = new Map<string, RTCPeerConnectionState>();

  /**
   * The previous tile object per participant, reused when nothing about them changed.
   *
   * `$each` renders through Solid's `<For>`, which is **keyed by reference**. Rebuilding the tile
   * list produces fresh objects, so every row unmounts and remounts — and a remounted row means a
   * brand-new `<video>` element, which drops `srcObject` and re-attaches it. That is the flicker:
   * every heartbeat, every connection-state change and every mute toggle tore down and rebuilt every
   * video in the call.
   *
   * The codebase already hit this exact failure with `$query` results, where AD4M's prototype `id`
   * getter defeated `reconcile({ key: 'id' })` — see the note in `SchemaRenderer`. Same cause, same
   * symptom, and the fix is the same: keep identity stable across updates that change nothing.
   */
  const tileCache = new Map<string, CallTile>();

  const roster = (): Peer[] => {
    const id = callId();
    if (!id || !presence) return [];
    return activitiesOfType(presence.peers(), 'call')
      .filter(({ activity }) => activity.id === id)
      .map(({ peer }) => peer);
  };

  /**
   * Rebuild the tile list from the three sources.
   *
   * Driven by the roster, not by the connections: a peer who has joined but not yet negotiated gets a
   * tile with a null stream. Driving it from connections instead would make joiners invisible until
   * their media arrived, which reads as a broken call during the very seconds it is working.
   */
  /**
   * Reuse the previous object for a participant unless their identity or stream changed.
   *
   * Only two fields can force a remount now, and both genuinely require one: a different person, or a
   * different `MediaStream` to attach.
   */
  function stabilise(tile: CallTile): CallTile {
    const previous = tileCache.get(tile.id);
    if (previous && previous.stream === tile.stream && previous.isSelf === tile.isSelf) return previous;
    tileCache.set(tile.id, tile);
    return tile;
  }

  function rebuildTiles() {
    const id = callId();
    const me = selfId?.() ?? null;
    if (!id) {
      tileCache.clear();
      setTiles([]);
      setTileStates([]);
      return;
    }

    const next: CallTile[] = [];
    const states: Omit<CallTileState, 'focused'>[] = [];

    if (me) {
      const state = controller?.state();
      const own = controller?.displayStream() ?? null;
      const ownWantsPicture = (state?.videoEnabled ?? false) || (state?.screenShareEnabled ?? false);
      const ownPicture = ownWantsPicture && hasLiveVideo(own);
      next.push(stabilise({ id: me, did: me, stream: own, isSelf: true }));
      states.push({
        id: me,
        isScreen: state?.screenShareEnabled ?? false,
        audioEnabled: state?.audioEnabled ?? false,
        videoEnabled: state?.videoEnabled ?? false,
        hasPicture: ownPicture,
        // Your own tile waits on the device rather than on a peer: `join` announces before it calls
        // `getUserMedia`, so this covers the seconds a permission prompt is on screen.
        connecting: ownWantsPicture && !ownPicture,
        failed: false,
      });
    }

    for (const { peer, activity } of activitiesOfType(presence?.peers() ?? [], 'call')) {
      if (activity.id !== id || peer.agentId === me) continue;
      const settings = activity.media;
      const stream = remoteStreams.get(peer.agentId) ?? null;
      next.push(stabilise({ id: peer.agentId, did: peer.agentId, stream, isSelf: false }));
      const connection = peerStates.get(peer.agentId);
      const wantsPicture = (settings?.videoEnabled ?? true) || (settings?.screenShareEnabled ?? false);
      const picture = wantsPicture && hasLiveVideo(stream);
      states.push({
        id: peer.agentId,
        // Read from the roster, never inferred from the track — the sender is the only one who knows
        // whether the video it is sending is a camera or a desktop.
        isScreen: settings?.screenShareEnabled ?? false,
        audioEnabled: settings?.audioEnabled ?? true,
        videoEnabled: settings?.videoEnabled ?? true,
        connection,
        hasPicture: picture,
        // Expected and not yet arrived. Keyed on the track rather than on `peerStates`, which holds
        // nothing until the first negotiation — exactly the window that showed nothing at all.
        connecting: wantsPicture && !picture && connection !== 'failed',
        failed: connection === 'failed',
      });
    }

    // Drop anyone who left, so the cache cannot grow across a long-lived session.
    const present = new Set(next.map((tile) => tile.id));
    for (const key of [...tileCache.keys()]) if (!present.has(key)) tileCache.delete(key);

    const focus = reconcileFocus(states, present);

    setTiles(next);
    setTileStates(states.map((state) => ({ ...state, focused: state.id === focus })));
  }

  /**
   * Decide what the stage should be showing, from what changed rather than from what is true.
   *
   * "Somebody is sharing" is the wrong question — it is true for the whole ten minutes of a demo,
   * so answering it would re-take focus from the user on every heartbeat. The question is *who
   * started sharing since last time*, which is why the set of sharers is remembered here rather than
   * recomputed. Somebody else's screen appearing is the one event worth overriding a default for;
   * your own is not, because you know what you just did and you are usually looking elsewhere.
   */
  function reconcileFocus(states: Omit<CallTileState, 'focused'>[], present: Set<string>): string | null {
    const me = selfId?.() ?? null;
    const sharing = new Set(states.filter((state) => state.isScreen).map((state) => state.id));
    const started = [...sharing].find((peerId) => !sharingPeers.has(peerId) && peerId !== me);
    sharingPeers = sharing;

    let focus = focusedId();
    // A focused participant who left takes the focus with them, back to an even grid.
    if (focus && !present.has(focus)) {
      focus = null;
      focusIsManual = false;
    }
    if (started && !focusIsManual) focus = started;

    if (focus !== focusedId()) setFocusedId(focus);
    return focus;
  }

  /**
   * What this call is *about*, held rather than passed around.
   *
   * It used to be a `join` parameter that every `publishActivity` call had to remember to forward,
   * which was survivable while the anchor was fixed at join time. It no longer is — `attachAnchor`
   * can set one mid-call — and a later republish carrying the stale parameter would silently drop it
   * again on the next mute toggle. One place to read it from, so nothing can disagree.
   */
  let anchor: Focus | undefined;

  /** Republish the call activity so peers see mute/camera/screen changes. */
  function publishActivity() {
    const id = callId();
    if (!id || !presence) return;
    presence.setActivity({ type: 'call', id, media: media(), ...(anchor ? { anchor } : {}) });
  }

  function teardown() {
    const id = callId();
    mesh?.close();
    mesh = null;
    controller?.stop();
    controller = null;
    scopeHandle?.dispose();
    scopeHandle = null;
    setLocalAudio(null);
    remoteStreams = new Map();
    peerStates = new Map();
    if (id) presence?.clearActivity('call', id);
    setCallId(null);
    anchor = undefined;
    setVisible(false);
    setFocusedId(null);
    focusIsManual = false;
    sharingPeers = new Set();
    setTiles([]);
  }

  async function join(id: string, joinAnchor?: Focus) {
    if (callId() === id) return;
    if (callId()) teardown();

    anchor = joinAnchor;

    setProblem(null);

    const handle = dataset?.() ?? null;
    const me = selfId?.() ?? null;
    if (!handle || !me) {
      setProblem('A call needs a space and a signed-in agent.');
      return;
    }
    if (!ephemeral || !presence) {
      setProblem('This host has no transport for calls.');
      return;
    }

    const scope = ephemeral(handle);
    scopeHandle = scope;
    if (!scope) {
      // A personal space has no neighbourhood — there is nobody to call. Say so rather than
      // presenting controls that will never connect.
      setProblem('Calls need a shared space. This one is personal.');
      return;
    }

    // Refuse loudly rather than half-working, the same discipline as `planQuery`. A transport with
    // `unicast: 'none'` would deliver every offer to everyone, and each bystander would negotiate a
    // connection nobody asked for.
    //
    // `confidential` is deliberately *not* requested. It would be the honest flag — an SDP offer
    // names your host candidates — but demanding native unicast would refuse to run on AD4M, whose
    // addressing is emulated. The trade is stated rather than hidden: on an emulated transport,
    // everyone in the space can see the handshake, and the media itself is still DTLS-encrypted
    // end-to-end regardless.
    const plan = planEphemeral({ consumer: 'call', unicast: 'emulated' }, scope.capabilities);
    if (!plan.runnable) {
      setProblem(plan.gaps.map((gap) => gap.note).join(' '));
      return;
    }

    setCallId(id);

    // coalesce: false, emphatically. Presence heartbeats are last-write-wins so a dropped one costs
    // nothing; an SDP offer dropped because the previous send was slow is simply lost, and that peer
    // never connects.
    const channel = scope.channel('rtc', { coalesce: false });

    mesh = createCallMesh({
      callId: id,
      selfId: me,
      channel,
      createPeerConnection: deps.createPeerConnection,
      onRemoteStreamsChanged: (streams) => {
        remoteStreams = streams;
        rebuildTiles();
      },
      onPeerStateChanged: (peerId, state) => {
        peerStates.set(peerId, state);
        rebuildTiles();
      },
      onError: (context, error) => console.error(`call: ${context}`, error),
    });

    controller = createMediaController({
      onTrackChanged: (kind, track) => void mesh?.setOutboundTrack(kind, track),
      onStateChanged: (state) => {
        setMedia({ ...state });
        // Devices arrived after all — most likely the user granted the permission and pressed the
        // camera button. Each message clears on its own condition, and only its own, so neither a
        // structural problem nor the other media one is swallowed.
        const local = controller?.localStream();
        if (problem() === MEDIA_BLOCKED && local) setProblem(null);
        if (problem() === CAMERA_BLOCKED && local?.getVideoTracks().length) setProblem(null);
        // Fires once when devices are acquired, and on every mute after — the first is what tells a
        // listener the microphone exists at all.
        setLocalAudio(controller?.localStream() ?? null);
        publishActivity();
        rebuildTiles();
      },
      onError: (context, error) => console.error(`call: ${context}`, error),
    });

    // Announce before acquiring devices: joining should be visible to peers immediately, and the
    // permission prompt can take as long as the user takes.
    publishActivity();
    rebuildTiles();

    await controller.start();

    /*
      Say why there is no picture, rather than showing an avatar and leaving them to guess.

      `problem` is a dismissible alert over the call, not a replacement for it — which is the right
      shape here: a blocked camera does not stop you watching and hearing everyone else, so the call
      carries on and the reason is stated once. Checked on the stream rather than on an error,
      because a refused camera that fell back to audio is a different outcome from a refused
      *request*, and only the second one leaves nothing at all.
    */
    if (!controller.localStream()) setProblem(MEDIA_BLOCKED);
  }

  // Reconcile the mesh against the roster. This is the whole membership mechanism — see mesh.ts.
  effect?.(() => {
    const peers = roster();
    if (!mesh) return;
    mesh.setRoster(peers.map((peer) => peer.agentId));
    rebuildTiles();
  });

  // Leaving the space leaves the call. Staying connected to a call in a space you have navigated out
  // of is a surprise, and the transport scope is torn down under us anyway.
  effect?.(() => {
    const handle = dataset?.();
    if (!handle && callId()) teardown();
  });

  /**
   * Losing the module leaves the call too.
   *
   * Until the contract had teardown, unregistering this module — or merely re-registering it, which
   * a hot reload does — dropped the only reference to live `RTCPeerConnection`s and a
   * `getUserMedia` stream. Nothing was left able to close them and the camera light stayed on. It is
   * the same `teardown()` a deliberate hangup runs; the only new thing is that somebody now calls it.
   */
  onDispose?.(() => teardown());

  /**
   * How many columns the tiles pack into.
   *
   * The only number the layout needs, because every other dimension is `1fr` of a box whose size the
   * host has already decided. That is what makes "one participant never scrolls" a property of the
   * arrangement rather than something to test for: rows divide the stage, they never exceed it.
   *
   * Three cases, in order of how strongly they determine the answer. A focus wins outright — one
   * fewer column than there are people puts the focused tile across the top and everyone else in
   * exactly one row beneath, at any count. A tall narrow dock wants columns of one or two, because
   * three 16:9 tiles across a 440px panel are thumbnails. Anything wide gets the ordinary grid.
   */
  function stageColumns(count: number, focused: boolean, where: CallPlacement): number {
    if (count <= 1) return 1;
    if (focused) return Math.min(count - 1, 4);
    const vertical = where === 'left' || where === 'right';
    if (vertical) return count <= 3 ? 1 : 2;
    return count <= 4 ? 2 : 3;
  }

  /** The edge a placement occupies. `float` and `full` name one they do not use — see `dockEdge`. */
  const edgeFor = (where: CallPlacement): CallDockEdge => (where === 'float' || where === 'full' ? 'bottom' : where);

  return {
    // ── State ────────────────────────────────────────────────────────────────
    callId,
    tiles,
    tileStates,
    placement,
    focusedId,
    media,
    problem,

    // ── What the host reads to place the stage ────────────────────────────────
    /**
     * Which edge the stage occupies, or `null` when there is nothing to place.
     *
     * The module's entire statement about geometry. It does not know the sidebar's width, the module
     * rail's, or the size of the window — the host owns all of that, which is what lets the same
     * declaration inset on a monitor and overlay on a laptop with nothing here changing.
     *
     * `strip` and `max` still name an edge even though neither uses it, because both float: the
     * value has to stay non-null for the panel to exist at all, and keeping the user's preference
     * live through those modes is what makes cycling back to `dock` return it where they left it.
     */
    dockEdge: () => (!visible() || !callId() ? null : edgeFor(placement())),
    /**
     * How much room to ask for — now only ever the two extremes, or "an ordinary panel".
     *
     * The three named sizes this used to choose between are gone: size is dragged, and the host
     * stores what the user dragged it to. `md` is therefore an opening bid rather than a setting,
     * which is why nothing here can change it any more.
     */
    dockSize: () => (placement() === 'full' ? 'full' : placement() === 'float' ? 'sm' : 'md'),
    /** Overlay rather than inset: a float is too small to be worth shrinking the app for, a full
     *  stage too large to leave anything of it. */
    dockFloat: () => placement() === 'float' || placement() === 'full',

    /**
     * The placement picker, pre-built — a fragment can iterate an array but cannot author one.
     *
     * One list containing what used to be two controls and a cycle. `float` and `full` sit in it as
     * peers of the edges because that is what they are: places to put the video, differing only in
     * how much room they take.
     */
    placementOptions: () => [
      { id: 'float', icon: 'picture-in-picture', label: 'Floating', active: placement() === 'float' },
      { id: 'left', icon: 'arrow-line-left', label: 'Dock left', active: placement() === 'left' },
      { id: 'right', icon: 'arrow-line-right', label: 'Dock right', active: placement() === 'right' },
      { id: 'top', icon: 'arrow-line-up', label: 'Dock top', active: placement() === 'top' },
      { id: 'bottom', icon: 'arrow-line-down', label: 'Dock bottom', active: placement() === 'bottom' },
      { id: 'full', icon: 'arrows-out', label: 'Full screen', active: placement() === 'full' },
    ],

    /** Whether the video is showing at all — what the expand button reflects. */
    stageOpen: visible,

    /**
     * The control bar has to move when the panel is docked along the top.
     *
     * Both are the module's own chrome and both want the top centre, so one of them has to give —
     * and it should be the small one. The host cannot arbitrate this: it places docks and knows
     * nothing about a floating pill some module renders through a slot. This module knows about
     * both, which is exactly why the decision belongs here.
     */
    barAtBottom: () => visible() && placement() === 'top',

    // ── How the tiles pack ────────────────────────────────────────────────────
    /**
     * The tile container's own CSS, computed rather than expressed as nested `$if` in the fragment.
     *
     * Grid, not wrapping flex. A wrapping flex container derives its line height from its content
     * and `align-content` can only *grow* a line — so a declared stage height was a floor rather
     * than a ceiling, and one oversized child pushed the whole stage past it into a scrollbar. Grid
     * tracks of `1fr` divide a definite box instead, which cannot overflow however many people join
     * or whatever resolution they send.
     *
     * A strip is the exception and flows the other way: a single row of fixed-width cells, so the
     * panel is as wide as the number of people in it rather than a band of empty chrome.
     */
    stageStyle: (): Record<string, string> => {
      if (placement() === 'float') {
        return {
          display: 'grid',
          'grid-auto-flow': 'column',
          // 16:9 at the strip's own height. Fixed rather than derived, because deriving it needs
          // the panel's measured height and the whole arrangement exists to avoid measuring.
          'grid-auto-columns': '220px',
          'grid-template-rows': '1fr',
        };
      }

      const columns = stageColumns(tiles().length, focusedId() !== null, placement());
      /**
       * A side dock is constrained by its *width*, so its rows are sized from that and stack at the
       * top.
       *
       * Sharing the height equally is right when height is the scarce dimension — a wide, short
       * panel — and wrong when it is not. A 440×900 side dock gave one participant a 900px row to be
       * centred in, so a 247px picture floated in the middle of the panel with a third of a screen
       * of nothing above and below it. Deriving the row from the column width instead makes the
       * tiles exactly as tall as they need to be, and `start` puts the empty space in one place
       * rather than distributing it between them.
       */
      const vertical = placement() === 'left' || placement() === 'right';
      return vertical
        ? {
            display: 'grid',
            'grid-template-columns': `repeat(${columns}, 1fr)`,
            'grid-auto-rows': 'min-content',
            'align-content': 'start',
            /**
             * The one arrangement here that can genuinely overflow, so the one that scrolls.
             *
             * Everywhere else rows divide a definite height and cannot exceed it — that invariant is
             * why the stage clips rather than scrolls. A side dock is the exception by construction:
             * its rows come from its *width*, so widening it makes every tile taller, and enough
             * participants or a wide enough drag will run past the bottom of the screen. Clipping
             * there hides people who are in the call.
             */
            'overflow-y': 'auto',
          }
        : {
            display: 'grid',
            'grid-template-columns': `repeat(${columns}, 1fr)`,
            'grid-auto-rows': '1fr',
          };
    },

    /**
     * The picture box's own sizing, which differs by which dimension is the scarce one.
     *
     * Where rows divide a definite height, the box has to fit *within* its cell, and the only way to
     * express that is to measure the cell — hence the container query. Where rows are sized from the
     * column width, the width is already known and the aspect ratio derives the height directly,
     * which is both simpler and the reason `container-type` must not be set in that case: size
     * containment on a row whose height comes from its content collapses it to nothing.
     */
    pictureStyle: (): Record<string, string> =>
      placement() === 'left' || placement() === 'right'
        ? { 'aspect-ratio': '16 / 9', width: '100%' }
        : { 'aspect-ratio': '16 / 9', width: 'min(100%, calc(100cqh * 16 / 9))', margin: 'auto' },

    /**
     * Each participant's face, looked up by id exactly as their volatile flags are.
     *
     * Not on the tile, for the reason nothing else is: `$each` renders through a reference-keyed
     * `<For>`, so folding a profile onto the tile object would remount that participant's row the
     * moment their picture arrived — and a remounted row drops `srcObject`. Somebody's video would
     * blink out precisely when their avatar loaded, which is a strange enough symptom to be worth
     * naming twice.
     */
    tileFaces: (): { id: string; image?: string; hash: string; name?: string }[] =>
      tiles().map((entry) => ({ id: entry.id, ...faceOf(entry.did) })),

    tileCells: (): { id: string; style: Record<string, string | number> }[] => {
      const focus = focusedId();
      const strip = placement() === 'float';
      // A focused tile spans the full width and two rows: the classic spotlight, in one declaration,
      // at any participant count. In a strip there is nothing to spotlight — every cell is already
      // the same size and there is only one row.
      const spotlight: Record<string, string | number> = { 'grid-column': '1 / -1', 'grid-row': 'span 2', order: -1 };
      /**
       * Every cell is a size container, which is what lets the picture inside it be the right shape.
       *
       * A cell is whatever the panel's proportions make it — 440×900 for one person in a side dock —
       * and a picture cannot be fitted into an arbitrary box by CSS alone unless something can be
       * measured. `container-type: size` makes the cell measurable, so the tile can ask for "as wide
       * as 16:9 allows at this height" and stop being a full-height box with a band of video in the
       * middle. That band was where the name and the mute badge ended up: anchored to the bottom of
       * the cell, floating in empty space well below the picture they belonged to.
       */
      const vertical = placement() === 'left' || placement() === 'right';
      const cell: Record<string, string | number> = vertical ? {} : { 'container-type': 'size' };
      return tiles().map((entry) => ({
        id: entry.id,
        style: !strip && entry.id === focus ? { ...cell, ...spotlight } : cell,
      }));
    },
    /** True when this agent is in a call — the call bar's visibility condition. */
    active: () => callId() !== null,

    /**
     * The microphone this call is sending, for a module that wants to listen to it.
     *
     * Published via `audioSource` on the definition so the host can route it without the two modules
     * knowing about each other. The live stream rather than a copy, deliberately: muting disables
     * the track rather than removing it, so a listener receives silence and stops producing — which
     * is what makes "mute the call" also mean "stop transcribing", with no coordination between the
     * two and no way for them to disagree.
     */
    localAudio,

    /**
     * True where a call could actually be started.
     *
     * A personal space has no neighbourhood and therefore no transport, so there is nobody to call.
     * Offering the button anyway and explaining the failure afterwards is worse than not offering it:
     * the answer never changes, so it is not a failure, it is a property of the space.
     */
    canCall: () => (datasetUri?.() ?? null) !== null,
    /** Everyone in the space-wide call, whether or not this agent has joined — so the bar can offer
     *  "3 in a call · Join" rather than only appearing once you are already in one. */
    ongoing: () => {
      const uri = datasetUri?.() ?? null;
      if (!uri || !presence) return [];
      const id = spaceCallId(uri);
      return (
        activitiesOfType(presence.peers(), 'call')
          .filter(({ activity }) => activity.id === id)
          // Faces, not peers. This feeds an `AvatarStack`, which reads `image`/`hash`/`initials` and
          // draws a generic person glyph for anything else — so handing it raw presence records, which
          // carry an agent id and no profile at all, drew one grey silhouette per participant.
          // No `tone`: everyone in this list is in the call right now, so a liveness ring would be
          // encoding a distinction that cannot vary here. `initials` rather than `name`, because
          // that is the prop an avatar asks for — it derives the letters from the name it is given.
          .map(({ peer }) => {
            const face = faceOf(peer.agentId);
            return { image: face.image, hash: face.hash, initials: face.name, did: peer.agentId };
          })
      );
    },

    // ── Actions ──────────────────────────────────────────────────────────────
    joinSpaceCall: () => {
      const uri = datasetUri?.() ?? null;
      if (!uri) {
        setProblem('A call needs a space.');
        return;
      }
      void join(spaceCallId(uri));
    },

    /**
     * Point an in-progress call at a node, without rejoining it.
     *
     * For the case where a call starts loose and turns out to be *about* something — someone opens
     * the post they are discussing, and from then on the transcript should belong to it.
     *
     * Emphatically not a re-join, and not a change of call id. The mesh reconciles against the roster
     * keyed by call id, so promoting `space:<uri>` to `node:<uri>:<id>` mid-call would read as every
     * peer leaving one call and joining another: every connection torn down and rebuilt, and the
     * media with it. The id stays; only what the call says it is about changes.
     */
    attachAnchor: (nodeId: string) => {
      const uri = datasetUri?.() ?? null;
      if (!callId() || !uri || !nodeId) return;
      anchor = { datasetUri: uri, nodeId };
      publishActivity();
    },

    /** "Call on this post" — a second call in the same space, which `callRosters` groups for free. */
    joinAnchoredCall: (nodeId: string) => {
      const uri = datasetUri?.() ?? null;
      if (!uri || !nodeId) {
        setProblem('A call needs a space and something to anchor to.');
        return;
      }
      void join(anchoredCallId(uri, nodeId), { datasetUri: uri, nodeId });
    },

    leave: teardown,

    toggleAudio: () => controller?.setAudioEnabled(!media().audioEnabled),
    /**
     * Turn the camera on or off — and say so when it refuses.
     *
     * Asked on the outcome rather than caught from an error, which keeps this free of matching on
     * message text: wanting the camera and not having it afterwards is the whole condition. Until
     * this, a refusal reached the console and nowhere else, so the button appeared to do nothing.
     */
    toggleVideo: async () => {
      const wanted = !media().videoEnabled;
      await controller?.setVideoEnabled(wanted);
      if (wanted && !controller?.state().videoEnabled) setProblem(CAMERA_BLOCKED);
    },
    toggleScreenShare: () => {
      if (media().screenShareEnabled) controller?.stopScreenShare();
      else void controller?.startScreenShare();
    },
    /** Show the video, or put it away. The other half of what one button used to do alone. */
    toggleStage: () => setVisible(!visible()),
    closeStage: () => setVisible(false),

    /**
     * Put the video somewhere — and show it, if it was not showing.
     *
     * Choosing a place is an instruction to look at the thing, so making the user open it first and
     * then place it would be asking twice for one decision.
     */
    setPlacement: (where: CallPlacement) => {
      setPlacement(where);
      if (!visible()) setVisible(true);
    },

    /**
     * Give this participant the stage, or take it back if they already have it.
     *
     * Marks the focus as the user's, which is what stops a running screen share from reclaiming it
     * on the next heartbeat. Clearing focus counts as a choice too — "show me everyone" is an
     * instruction, not an absence of one.
     */
    focusTile: (id: string) => {
      const next = focusedId() === id ? null : id;
      focusIsManual = true;
      setFocusedId(next);
      // The states array carries `focused`, so the change has to reach it for the layout to move.
      rebuildTiles();
    },

    dismissProblem: () => setProblem(null),
  };
}
