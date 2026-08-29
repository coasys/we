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

import { devPeers, devPeersAvailable, readDevPeerCount, stopDevPeers, writeDevPeerCount } from './devPeers';
import { createMediaController, type MediaController } from './media';
import { type CallMesh, createCallMesh } from './mesh';
import { anchoredCallId, spaceCallId } from './protocol';
import { solveStrip } from './strip';

// ── Session backend ──────────────────────────────────────────────────
//
// Structural interface satisfied by `Session` from `@coasys/ad4m`.
// The call module carries no import-time dependency on that package —
// the host constructs a Session and passes it through `CallStoreDeps`.

/** Quality layer the backend can forward (SFU simulcast). */
export type BackendQuality = 'high' | 'medium' | 'low';

/** A remote participant as reported by the backend. */
export interface BackendParticipant {
  agentDid: string;
  stream: MediaStream;
  hasAudio: boolean;
  hasVideo: boolean;
  isActiveSpeaker: boolean;
}

/** A data channel message from another participant, relayed through the session. */
export interface BackendDataMessage {
  senderDid: string;
  channelLabel: string;
  data: string;
  binary: boolean;
}

/**
 * Structural interface for a WebRTC session backend — topology-agnostic.
 *
 * Satisfied by `Session` from `@coasys/ad4m/neighbourhood`. The host constructs the session (with
 * neighbourhood proxy, room id, topology, etc.) and passes it here. This module never touches
 * `NeighbourhoodProxy` or any AD4M type directly.
 */
export interface CallBackend {
  join(localStream: MediaStream): Promise<void>;
  leave(): Promise<void>;
  destroy(): Promise<void>;
  replaceTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null): Promise<void>;
  setQualityPreference(pref: BackendQuality): Promise<void>;
  readonly participants: ReadonlyArray<BackendParticipant>;
  getState(): string;
  on(event: string, cb: (...args: unknown[]) => void): void;
  off(event: string, cb?: (...args: unknown[]) => void): void;
  /** Send data to all other participants via the session's relay (SFU or mesh signalling). */
  sendData(label: string, data: string, binary?: boolean): Promise<void>;
  /** Subscribe to data channel messages. Returns an unsubscribe function. */
  onData(cb: (message: BackendDataMessage) => void): () => void;
}

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
 * The stage's own padding and the gap between tiles, in pixels — `300` on the space scale.
 *
 * Named because two places have to agree about them and they are far apart: the stage node in
 * `index.ts` sets them as design tokens, and `dockAspect` below subtracts them so "fit to content"
 * solves for the right height. They drifted apart once already — the aspect ignored them entirely,
 * and the fit came out short by exactly their sum.
 */
export const STAGE_PADDING_PX = 12;
export const STAGE_GAP_PX = 12;

/** The tile aspect the whole stage is laid out from. */
const TILE_ASPECT = 16 / 9;

/**
 * How much of the bottom of the window the call bar occupies, for panels to keep clear of.
 *
 * `CALL_BAR_INSET` (10px) plus a row of `md` controls (40px) in a surface padded by `200` a side
 * (8px twice), plus a little air so a panel snapped above it does not touch. Derived rather than
 * chosen, like `CHROME_RAIL_WIDTH`: change the bar's size or padding and this has to follow, or
 * panels start landing underneath it again.
 *
 * The bottom, since the bar moved there. Lived in the shell as `TOP_CHROME_PX` until the bar
 * stopped being the only thing up there; see `chromeReserve` below.
 */
export const CALL_BAR_RESERVE_PX = 74;

/**
 * How wide the bar gets, at its widest — what lets the host tell "the module rail has slid left far
 * enough to hit the call controls" from "the rail is nowhere near them".
 *
 * Measured at about 440 with the standard controls and one contributed button, plus room for the
 * participant roster to grow. The bar is content-sized, so this cannot be exact — and the two errors
 * are not symmetrical: too wide moves the rail slightly earlier than it had to, too narrow puts the
 * rail across the controls. So it rounds up.
 */
export const CALL_BAR_WIDTH_PX = 480;

/** Which edge a stage occupies while it takes room. The host decides; this names the vocabulary. */
export type CallDockEdge = 'left' | 'right' | 'top' | 'bottom';

/** The call topology in use — mesh (peer-to-peer) or sfu (relay server). */
export type CallTopology = 'mesh' | 'sfu';

/**
 * Summary of relay (SFU) availability for the current call.
 *
 * Surfaced to the UI so it can show relevant hints without
 * exposing any technical terminology to end users.
 */
export interface RelayInfo {
  /** Whether a relay server handled this call's media. */
  relayActive: boolean;
  /** Total participants (including self). */
  participantCount: number;
  /**
   * True when the call runs peer-to-peer and the participant count
   * exceeds the comfortable mesh limit (6).  The UI can surface a
   * hint like "Call quality may degrade with more participants."
   */
  meshLimitReached: boolean;
}

/** Participant thresholds for auto-quality and mesh warnings. */
const MESH_LIMIT = 6;
const AUTO_QUALITY_MEDIUM = 5;
const AUTO_QUALITY_LOW = 9;

export interface CallStoreDeps extends ModuleStoreDeps {
  /** Overridable for tests; defaults to the browser's WebRTC and media APIs. */
  createPeerConnection?: () => RTCPeerConnection;
  /**
   * A Session backend that manages the WebRTC topology (mesh or SFU).
   *
   * When provided, the store delegates join / leave / track replacement / quality to the backend
   * instead of building its own peer-to-peer mesh. The backend must already hold the room id,
   * topology config, signalling channel, and agent identity — this module only drives its lifecycle.
   *
   * Pass `Session` from `@coasys/ad4m` directly — it satisfies the {@link CallBackend} interface.
   * The Session resolves topology automatically (mesh, SFU, or auto).
   */
  backend?: CallBackend;
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
  const { signal, effect, dataset, datasetUri, selfId, ephemeral, presence, identities, datasets, onDispose } = deps;

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
  /**
   * Whether the stage is on screen. False between calls, and set by `join` — see there.
   *
   * The initial value is the state of a module that is not in a call, which is the only state this
   * is ever read in before one starts: `dockEdge` is null while `callId` is, so nothing is placed
   * either way.
   */
  const [visible, setVisible] = signal(false);
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
  /** Whether this call runs through the SFU relay or the peer-to-peer mesh. */
  const [topology, setTopology] = signal<CallTopology>('mesh');
  /** The SFU quality layer this agent prefers. Only meaningful when `topology() === 'sfu'`. */
  const [qualityPreference, setQualityPreferenceSignal] = signal<BackendQuality>('high');
  /** Whether the user explicitly chose a quality preference, disabling auto. */
  let qualityIsManual = false;

  /**
   * Named, because it is the one problem that can resolve itself.
   *
   * Every other message here describes something structural — no space, no transport — that stays
   * true until the user does something elsewhere. This one is about a permission, and a permission
   * can be granted a moment later; leaving it on screen after the camera starts working is the
   * app telling the user something it can plainly see is no longer so.
   */
  /*
    Worded for every host, which the first version was not.

    "Check this site's permissions in your browser" is good advice in `we-web` and nonsense in
    Electron and Tauri, where there is no browser and no site — so on two of the three hosts it told
    the user to do something impossible. It also named only one of the two common causes: a device
    another application already has open fails the same way, and is at least as frequent.
  */
  const MEDIA_BLOCKED =
    'WE could not reach your camera or microphone. Check that WE has permission to use them, and that no other app has them open.';

  /**
   * The camera specifically, refused when the user asked for it.
   *
   * Separate from `MEDIA_BLOCKED` because the two clear on different conditions: this one is still
   * true while the microphone works perfectly well, so clearing it on "we have a stream" — which is
   * what the other one wants — would make it flash and vanish in exactly the case it exists for.
   */
  const CAMERA_BLOCKED =
    'WE could not turn your camera on. Check that WE has permission to use it, and that no other app has it open.';

  /**
   * The machine cannot capture a screen — as distinct from the user closing the picker.
   *
   * Worth its own message because the remedy is not "try again": on Linux this is usually a desktop
   * with no `org.freedesktop.portal.ScreenCast` interface, which is a missing portal backend rather
   * than anything the user did in WE.
   */
  const SCREEN_UNAVAILABLE =
    'WE could not capture a screen. This computer does not appear to offer screen sharing to apps.';
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
  let backend: CallBackend | null = null;
  let controller: MediaController | null = null;
  let remoteStreams = new Map<string, MediaStream>();
  let peerStates = new Map<string, RTCPeerConnectionState>();
  let dataUnsubscribe: (() => void) | null = null;
  const dataListeners: Set<(msg: BackendDataMessage) => void> = new Set();

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

  /*
    How many synthetic participants the call bar's dev controls have asked for — see `devPeers`.

    A signal rather than a read of `localStorage` per rebuild, so pressing `+` re-solves the stage on
    the click instead of waiting for whatever roster event happens next. Seeded from storage, which
    is what makes the count survive the reloads a developer does while iterating.
  */
  const [fakePeerCount, setFakePeerCountSignal] = signal(readDevPeerCount());

  function stepFakePeers(by: number) {
    setFakePeerCountSignal(writeDevPeerCount(fakePeerCount() + by));
    rebuildTiles();
  }

  function rebuildTiles() {
    const id = callId();
    const me = selfId?.() ?? null;
    if (!id) {
      tileCache.clear();
      setTiles([]);
      setTileStates([]);
      stopDevPeers();
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

    /*
      Synthetic participants, when a developer has asked for them — see `devPeers`.

      Appended here rather than injected into the roster, so they cost the mesh and presence nothing
      and cannot be mistaken for a real peer by anything upstream. They go through `stabilise` and
      `tileStates` like everyone else, which is the point: the tiling solve, the spotlight's axis and
      fit-to-content all see exactly what they would in a real call.
    */
    for (const peer of devPeers(fakePeerCount())) {
      next.push(stabilise({ id: peer.id, did: peer.id, stream: peer.stream, isSelf: false }));
      states.push({
        id: peer.id,
        isScreen: false,
        audioEnabled: peer.audioEnabled,
        videoEnabled: true,
        connection: 'connected',
        hasPicture: peer.stream !== null,
        connecting: false,
        failed: false,
      });
    }

    // Drop anyone who left, so the cache cannot grow across a long-lived session.
    const present = new Set(next.map((tile) => tile.id));
    for (const key of [...tileCache.keys()]) if (!present.has(key)) tileCache.delete(key);

    const focus = reconcileFocus(states, present);

    setTiles(next);
    setTileStates(states.map((state) => ({ ...state, focused: state.id === focus })));

    // ── Auto quality ──────────────────────────────────────────────────
    //
    // Adjusts the SFU simulcast layer based on participant count when
    // the user has not explicitly chosen a preference.  More
    // participants → lower quality → less bandwidth per stream.
    if (topology() === 'sfu' && backend && !qualityIsManual) {
      const count = next.length;
      let target: BackendQuality = 'high';
      if (count >= AUTO_QUALITY_LOW) target = 'low';
      else if (count >= AUTO_QUALITY_MEDIUM) target = 'medium';
      if (target !== qualityPreference()) {
        setQualityPreferenceSignal(target);
        void backend.setQualityPreference(target);
      }
    }
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
    if (dataUnsubscribe) {
      dataUnsubscribe();
      dataUnsubscribe = null;
    }
    dataListeners.clear();
    if (backend) {
      backend.destroy().catch((err) => console.error('call: backend destroy', err));
      backend = null;
    }
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
    setTopology('mesh');
    qualityIsManual = false;
    anchor = undefined;
    setVisible(false);
    setFocusedId(null);
    focusIsManual = false;
    sharingPeers = new Set();
    setTiles([]);
  }

  async function join(id: string, joinAnchor?: Focus) {
    if (callId() === id) return;
    // One call at a time, and this is where that is decided: joining a second tears the first down
    // rather than running both. Everything below assumes a single mesh, a single scope and a single
    // set of local tracks, and the stage has one spotlight.
    if (callId()) teardown();

    setProblem(null);

    const handle = dataset?.() ?? null;
    const uri = datasetUri?.() ?? null;
    const me = selfId?.() ?? null;

    /*
      A call always says which space it is in, even when it is not *about* anything in particular.

      An unanchored activity used to be enough, because a call could only be published into the space
      you were standing in. Now that a call outlives navigating away from it, the space is no longer
      derivable from where you happen to be — the host routes the activity to the call's own presence
      source, and this is what tells it which that is.

      A space-wide call carries `datasetUri` and no `nodeId`, which is exactly what consumers already
      test for: `transcribe` reads `anchor?.nodeId ?? null`, so this reads identically to the absent
      anchor it replaces.
    */
    anchor = joinAnchor ?? (uri ? { datasetUri: uri } : undefined);
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
    /*
      Starting a call shows the call.

      Nothing did this, so the first thing that happened when you pressed the call button was that
      the bar appeared and the video did not: `dockEdge` returns null while `visible` is false, and
      the host renders no dock for a null edge. The only way to a visible stage was the expand
      toggle, which reads as a way to *change* something already on screen — so the call looked like
      it had failed to start any picture at all.

      Placing it is a separate question from showing it, and not this module's: the stage opens as a
      floating card, and where it goes from there is the host's, on the panel itself. Leaving a call
      sets this back off, so it means "this call is showing" rather than a preference that outlives
      the call it was made in.
    */
    setVisible(true);

    controller = createMediaController({
      onTrackChanged: (kind, track) => {
        if (backend) void backend.replaceTrack(kind, track);
        else void mesh?.setOutboundTrack(kind, track);
      },
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

    if (deps.backend) {
      // ── Session backend path ────────────────────────────────────────
      //
      // The backend (Session from @coasys/ad4m) manages topology, signalling, roster polling,
      // and peer connections internally. The store only drives lifecycle and reads participants.
      backend = deps.backend;

      backend.on('participant-joined', () => {
        remoteStreams = new Map(backend!.participants.map((p) => [p.agentDid, p.stream]));
        rebuildTiles();
      });
      backend.on('participant-left', () => {
        remoteStreams = new Map(backend!.participants.map((p) => [p.agentDid, p.stream]));
        rebuildTiles();
      });
      backend.on('stream-added', () => {
        remoteStreams = new Map(backend!.participants.map((p) => [p.agentDid, p.stream]));
        rebuildTiles();
      });
      backend.on('stream-removed', () => {
        remoteStreams = new Map(backend!.participants.map((p) => [p.agentDid, p.stream]));
        rebuildTiles();
      });
      backend.on('topology-changed', (topo: unknown) => {
        if (topo === 'mesh' || topo === 'sfu') setTopology(topo);
      });
      backend.on('error', (err: unknown) => console.error('call: backend error', err));

      // Subscribe to data channel messages from other participants.
      dataUnsubscribe = backend.onData((msg) => {
        for (const cb of dataListeners) {
          try {
            cb(msg);
          } catch (e) {
            console.error('call: data listener error', e);
          }
        }
      });

      // Announce before acquiring devices, same as the mesh path.
      publishActivity();
      rebuildTiles();

      // Acquire media, then join the backend with the local stream.
      await controller.start();
      const localStream = controller.displayStream() ?? controller.localStream() ?? new MediaStream();
      await backend.join(localStream);

      // Seed remote streams from anyone already in the room.
      remoteStreams = new Map(backend.participants.map((p) => [p.agentDid, p.stream]));
      rebuildTiles();
    } else {
      // ── Mesh path (default — WE's built-in peer-to-peer mesh) ───────
      setTopology('mesh');

      const meshCallbacks = {
        onRemoteStreamsChanged: (streams: Map<string, MediaStream>) => {
          remoteStreams = streams;
          rebuildTiles();
        },
        onPeerStateChanged: (peerId: string, state: RTCPeerConnectionState) => {
          peerStates.set(peerId, state);
          rebuildTiles();
        },
        onError: (context: string, error: unknown) => console.error(`call: ${context}`, error),
      };

      // coalesce: false, emphatically. Presence heartbeats are last-write-wins so a dropped one costs
      // nothing; an SDP offer dropped because the previous send was slow is simply lost, and that peer
      // never connects.
      const channel = scope.channel('rtc', { coalesce: false });

      mesh = createCallMesh({
        callId: id,
        selfId: me,
        channel,
        createPeerConnection: deps.createPeerConnection,
        ...meshCallbacks,
      });

      // Announce before acquiring devices: joining should be visible to peers immediately, and the
      // permission prompt can take as long as the user takes.
      publishActivity();
      rebuildTiles();

      await controller.start();
    }

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
  // When a Session backend handles the call, it manages roster polling internally — skip this.
  effect?.(() => {
    const peers = roster();
    if (backend || !mesh) return;
    mesh.setRoster(peers.map((peer) => peer.agentId));
    rebuildTiles();
  });

  /*
    Leaving the space no longer leaves the call.

    It used to, on the grounds that staying connected to a call in a space you have navigated out of
    is a surprise — and, decisively, that "the transport scope is torn down under us anyway". The
    second half was the real reason, and it is no longer true: this store holds its own refcounted
    handle on the call's scope for as long as the call lasts, and the host now keeps a presence
    source open for any space holding a live activity, so the roster survives too.

    That leaves only the first half, and it is the wrong way round. Being dropped out of a call
    because you went to look something up is the surprise; a call you have to stay still for is not
    one you can use. So the call ends when somebody ends it, and nothing else — hanging up, joining
    another (see `join`), or losing the module.

    Nothing replaces this effect. There is deliberately no "the dataset went away" case: a null
    dataset is the boot frame and the moment between spaces as much as it is anything final, and
    tearing a call down on it is what this was doing wrong in the first place.
  */

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
   * How the tiles are arranged, as reported by the stage.
   *
   * This module no longer decides it. It used to, from the participant count alone — two columns up
   * to four people, three beyond — and the panel's *shape* was not an input at all, so a call
   * dragged tall and thin got two columns of postage stamps and one dragged wide got two rows with
   * bands of empty panel above and below. The comment here claimed a tall dock wanted one or two
   * columns; the code had no width to make that true with, and had not since a panel stopped being
   * defined by which edge it was on.
   *
   * `Grid`'s `childAspect` solves it properly — largest 16:9 tiles for the box, both axes — and
   * reports what it settled on. Read here for two things only the module can answer: what shape the
   * panel wants at fit-to-content, and where a spotlight should put everyone else.
   */
  const [arrangement, setArrangement] = signal<{ columns: number; rows: number }>({ columns: 1, rows: 1 });

  /**
   * The stage's own box, reported by the grid — see `Grid`'s `onMeasure`.
   *
   * Used for one decision and no arithmetic: which edge the filmstrip runs along. The thicknesses
   * themselves are written in container-query units, so they stay right between measurements rather
   * than lagging a frame behind a drag.
   */
  const [stageBox, setStageBox] = signal<{ width: number; height: number }>({ width: 0, height: 0 });

  /**
   * Whether the spotlight has the stage to itself.
   *
   * A second mode rather than a third click, because a three-state cycle on one gesture cannot say
   * which state it is in — the same trap the show/hide toggle was split apart to escape. It is a
   * toggle in the bar, visible only while something is focused, so the state is on screen and the
   * move has a name.
   *
   * The strip is what you give up, and it is worth giving up mainly for a shared screen: reading
   * somebody's desktop you want every pixel and the faces are not the point.
   */
  const [solo, setSolo] = signal(false);

  /** How many tiles the strip holds — everyone but the one with the stage. */
  const stripCount = () => Math.max(1, tiles().length - 1);

  /** The strip's own solve, against the box the grid last reported — see `solveStrip`. */
  const stripLayout = () => solveStrip(stripCount(), stageBox(), { aspect: TILE_ASPECT, gap: STAGE_GAP_PX });

  /** Everyone in the space-wide call, whether or not this agent has joined — so the bar can offer
   *  "3 in a call · Join" rather than only appearing once you are already in one. */
  const ongoingPeers = () => {
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
  };

  return {
    // ── State ────────────────────────────────────────────────────────────────
    callId,
    tiles,
    tileStates,
    focusedId,
    media,
    problem,
    /** Whether this call runs through the SFU relay (`'sfu'`) or the peer-to-peer mesh (`'mesh'`). */
    topology,
    /** The SFU quality layer this agent prefers. Only meaningful when `topology() === 'sfu'`. */
    qualityPreference,
    /**
     * Relay availability summary — signals the UI without exposing
     * any SFU terminology.  `meshLimitReached` turns true when the
     * call runs peer-to-peer and exceeds the comfortable participant
     * limit; the UI can surface a hint about call quality.
     */
    relayInfo: (): RelayInfo => ({
      relayActive: topology() === 'sfu',
      participantCount: tiles().length,
      meshLimitReached: topology() === 'mesh' && tiles().length > MESH_LIMIT,
    }),

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
    dockEdge: () => (!visible() || !callId() ? null : 'bottom'),
    /**
     * How much room to ask for, once, when the panel first opens.
     *
     * An opening bid and nothing else. Size, position, whether it displaces content and whether it
     * covers the screen are all the host's now, on the panel's own titlebar — so this module has no
     * opinion about layout left beyond "a card, to begin with".
     */
    dockSize: () => 'sm',
    /**
     * Always overlaying, as far as this module is concerned.
     *
     * The stage floats when it opens; whether it goes on to *take room* is the host's toggle now, on
     * the panel itself, and this module neither sets it nor reads it. That is the point of the split:
     * a call knows how much of your attention it wants, and the app knows how the app is laid out.
     */
    dockFloat: () => true,

    /**
     * The shape this panel's content wants, so the host can offer "fit to content".
     *
     * Every tile is 16:9 and they divide the stage evenly, so for any width there is exactly one
     * height at which no band of empty panel is left above or below the pictures — the thing
     * hand-resizing can never quite land on. `cols × 16 / (rows × 9)` is that shape.
     *
     * The insets are the stage's own fixed pixels: `STAGE_PADDING_PX` on each side and
     * `STAGE_GAP_PX` between tiles. Left out — as they were at first — the host solved on the full
     * panel width, made the box about twenty pixels too short for its pictures, and the tiles
     * answered by shrinking to the height and leaving a gap down each side. They are constants at a
     * given tile count, which is what lets this stay a value rather than a callback taking a width.
     *
     * The arrangement is the one the stage is *currently in*, not one solved again here. That is
     * deliberate: with the width fixed, any column count can be made to fit perfectly, so "fit" that
     * re-solved could rearrange the call under a click that only asked to remove the empty band.
     * This takes the slack out and leaves the tiles where they are.
     */
    dockAspect: () => {
      /*
        Spotlight and solo are one 16:9 picture with a band beside or beneath it, so the shape is the
        tile's and the strip is an inset — which is exactly the pair this contract asks for, and the
        same band the tracks are written from.
      */
      if (focusedId() !== null) {
        const strip = stripLayout();
        const band = solo() ? 0 : strip.thickness + STAGE_GAP_PX;
        const beside = !solo() && strip.side;
        return {
          ratio: TILE_ASPECT,
          insetX: STAGE_PADDING_PX * 2 + (beside ? band : 0),
          insetY: STAGE_PADDING_PX * 2 + (!solo() && !strip.side ? band : 0),
        };
      }

      const { columns, rows } = arrangement();
      return {
        ratio: (columns * 16) / (rows * 9),
        insetX: STAGE_PADDING_PX * 2 + (columns - 1) * STAGE_GAP_PX,
        insetY: STAGE_PADDING_PX * 2 + (rows - 1) * STAGE_GAP_PX,
      };
    },

    /*
      Synthetic participants, and the two controls that change how many — see `devPeers`.

      Spread conditionally rather than declared and left inert, so a production build's store does
      not carry a `setFakePeers` a template could find and call. Nothing else here is conditional;
      this is the one member that must not exist rather than merely do nothing.
    */
    ...(devPeersAvailable
      ? {
          fakePeerCount,
          /*
            A step rather than a setter, because the schema layer has no arithmetic — there is no
            token for "the current count minus one", so a `+`/`−` pair has to be two actions.

            Both re-solve the stage on the click. Reading storage per rebuild instead would leave it
            showing the old count until whatever roster event happened next, which for a button you
            press while watching the thing it changes is the whole of the feedback.
          */
          addFakePeer: () => stepFakePeers(1),
          removeFakePeer: () => stepFakePeers(-1),
        }
      : {}),

    /** Whether the video is showing at all — what the show/hide button reflects. */
    stageOpen: visible,

    // ── How the tiles pack ────────────────────────────────────────────────────
    /**
     * What the stage settled on — wired to `Grid`'s `onArrange`.
     *
     * A setter on the store because the arrangement is decided where it can be measured, and needed
     * where the panel's geometry is decided. The alternative was for this module to import the
     * solver and re-derive it, which would mean a module depending on the design system — an edge
     * the package layering does not have — and two copies of an answer that must agree.
     */
    setArrangement,
    arrangement,
    setStageBox,
    solo,

    /**
     * The stage's grid tracks while somebody has the spotlight — `undefined` the rest of the time.
     *
     * Undefined is what hands the layout back to `Grid`'s own solver: `template` takes precedence
     * over `childAspect`, so writing tracks here turns the equal-tile solve off and leaving it
     * absent turns it back on. Two modes, one prop, and no mode flag to keep in step with anything.
     *
     * Spotlight is not a span in the equal grid, which is what it used to be and why it barely
     * looked focused: the tracks were solved for N tiles of one size, so the spotlight could only
     * ever be two of them — two thirds of the stage at three people, one third at six. The tracks
     * are the spotlight's own now.
     */
    stageTemplate: (): string | undefined => {
      if (focusedId() === null) return undefined;
      if (solo()) return '1fr';
      const strip = stripLayout();
      const track = strip.scroll ? `${strip.tile}px` : '1fr';
      return strip.side ? `1fr ${strip.thickness}px` : `repeat(${strip.count}, ${track})`;
    },

    stageRows: (): string | undefined => {
      if (focusedId() === null) return undefined;
      if (solo()) return '1fr';
      const strip = stripLayout();
      const track = strip.scroll ? `${strip.tile}px` : '1fr';
      return strip.side ? `repeat(${strip.count}, ${track})` : `1fr ${strip.thickness}px`;
    },

    /**
     * The picture box's own sizing.
     *
     * A 16:9 box as wide as the cell's height allows, so the picture is the right shape whatever
     * proportions the panel has been dragged to — and the name and badges anchored to its corner land
     * *on the video* rather than in the empty half of a cell they nominally shared.
     *
     * The container query is what makes that possible: `container-type: size` on the cell (see
     * `tileCells`) is what `100cqh` measures.
     */
    pictureStyle: (): Record<string, string> => ({
      'aspect-ratio': '16 / 9',
      width: 'min(100%, calc(100cqh * 16 / 9))',
      margin: 'auto',
    }),

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
      /*
        Where the spotlight sits in the tracks `stageTemplate` wrote.

        It takes the whole of the axis the strip does not run along — the full height beside a strip
        down the side, the full width above one underneath — and the others auto-place into what is
        left, one per track, in the order they are in. Explicit placement rather than `order`, which
        is what it used to need when the spotlight was a span in a grid solved for equal tiles.
      */
      /*
        The spotlight's cell fills with its box rather than centring it.

        Every other cell centres what it holds, which is right for a picture smaller than its cell.
        This one holds the *pinned* box — see `tilePins` — and a sticky element's range is measured
        from where it would have sat: centred in a column several times the height of the stage, it
        starts halfway down and scrolls out of view before it ever reaches the top edge it is
        supposed to stick to. Stretched from the start of the cell, it pins as intended.
      */
      const fills: Record<string, string | number> = { 'justify-content': 'flex-start', 'align-items': 'stretch' };
      const spotlight: Record<string, string | number> = stripLayout().side
        ? { ...fills, 'grid-column': '1', 'grid-row': '1 / -1' }
        : { ...fills, 'grid-row': '1', 'grid-column': '1 / -1' };
      /**
       * Every cell is a size container, which is what lets the picture inside it be the right shape.
       *
       * A cell is whatever the panel's proportions make it — and a picture cannot be fitted into an
       * arbitrary box by CSS alone unless something can be measured. `container-type: size` makes the
       * cell measurable, so the tile can ask for "as wide as 16:9 allows at this height" and stop
       * being a full-height box with a band of video in the middle. That band was where the name and
       * the mute badge ended up: anchored to the bottom of the cell, floating in empty space well
       * below the picture they belonged to.
       *
       * Unconditional now. It used to be skipped on a side dock, whose rows were sized from the
       * column width and would have collapsed to nothing under size containment — a shape a panel
       * can no longer be in, since every stage divides a box the user dragged.
       */
      /*
        The cell no longer measures itself: the box inside it does — see `tilePins`. A pinned
        spotlight is shorter than the cell it spans, and the picture has to be sized from the part
        that is on screen rather than from the whole scrollable column.
      */
      const cell: Record<string, string | number> = {};
      /*
        Solo hides the others rather than dropping them from the list.

        `tiles` is a reference-keyed `$each`, so removing an entry unmounts its row and takes the
        `<video>` with it — everyone's picture would go black on the way in and have to renegotiate
        on the way out. Hidden, they keep their streams and come back instantly.
      */
      const hidden: Record<string, string | number> = { display: 'none' };
      return tiles().map((entry) => {
        if (entry.id === focus) return { id: entry.id, style: { ...cell, ...(focus ? spotlight : {}) } };
        return { id: entry.id, style: focus !== null && solo() ? hidden : cell };
      });
    },
    /**
     * The box inside each tile that the picture is measured against.
     *
     * Ordinarily it simply fills the cell, and the picture sizes itself from it exactly as it did
     * when the cell was the container. The one that matters is the spotlight's while the strip
     * scrolls: it spans every row of a column taller than the stage, so a picture measured from the
     * cell would be sized for a box mostly off screen. Pinning this box to the visible band and
     * measuring *it* is what keeps the spotlight the size of what you can see.
     *
     * `position: sticky` rather than anything measured per frame: the browser holds it against the
     * scroll for free, and the height it is held at is the one number the stage already reports.
     */
    tilePins: (): { id: string; style: Record<string, string | number> }[] => {
      const focus = focusedId();
      const box = stageBox();
      const strip = stripLayout();
      const base: Record<string, string | number> = { 'container-type': 'size', width: '100%', height: '100%' };
      const pinned: Record<string, string | number> = strip.side
        ? { ...base, position: 'sticky', top: '0', height: `${Math.round(box.height)}px` }
        : { ...base, position: 'sticky', left: '0', width: `${Math.round(box.width)}px` };

      return tiles().map((entry) => ({
        id: entry.id,
        style: entry.id === focus && !solo() && strip.scroll ? pinned : base,
      }));
    },

    /**
     * Which way the stage scrolls, which is only ever the axis the strip runs along.
     *
     * Hidden on the other, because nothing should ever overflow it — the spotlight is fitted to the
     * box and the strip is one line. A stage that scrolled both ways would be hiding a bug rather
     * than offering a feature.
     */
    stageOverflow: (): Record<string, string> => {
      if (focusedId() === null || solo()) return { overflow: 'hidden' };
      const strip = stripLayout();
      if (!strip.scroll) return { overflow: 'hidden' };
      return strip.side
        ? { 'overflow-y': 'auto', 'overflow-x': 'hidden' }
        : { 'overflow-x': 'auto', 'overflow-y': 'hidden' };
    },

    /** True when this agent is in a call — the call bar's visibility condition. */
    active: () => callId() !== null,

    /**
     * In a call that is happening somewhere other than the space on screen.
     *
     * The condition for the bar's way back, and it has to be a comparison rather than a flag: you
     * can leave the call's space and come back to it, and the affordance has to disappear again when
     * you do. `anchor.datasetUri` is set for every call — see `join`.
     */
    elsewhere: () => callId() !== null && !!anchor?.datasetUri && anchor.datasetUri !== (datasetUri?.() ?? null),

    /**
     * The space this call is in, named — or `null` when there is no call.
     *
     * Read through the host's dataset directory rather than remembered at join time, so a name or
     * picture that loads afterwards appears on its own. The uri is always there; the rest is
     * whatever the host knows, and a space whose record has not arrived yet simply has no name to
     * show, which the bar handles.
     */
    callSpace: () => {
      const uri = anchor?.datasetUri;
      if (!callId() || !uri) return null;
      const known = datasets?.get(uri);
      return { uri, name: known?.name ?? '', avatar: known?.avatar ?? '' };
    },

    /** Go back to the space the call is in. No-op outside a call. */
    returnToCall: () => {
      const uri = anchor?.datasetUri;
      if (callId() && uri) datasets?.open(uri);
    },

    /**
     * The band this module's fixed chrome occupies, for panels to keep clear of.
     *
     * The bar is `position: fixed` at the top and paints above the panels, so a panel snapped to the
     * top centre lands underneath it — including the panel's own grip and position menu, which are
     * the two things it is dragged back out with. The host reserves this on every *floating* panel;
     * a displacing one is unaffected, since it takes an edge this does not sit on.
     *
     * Reported rather than assumed, because the host cannot see whether the bar is up: the same
     * value used to be a constant in the shell's geometry, reserving the band whether or not a call
     * was running, and it could not grow when another module contributed into this bar's column.
     *
     * Non-zero whenever the bar is drawn at all, which includes the join prompt shown to somebody
     * who is not in the call yet — that is the same object in the same place, so it takes the same
     * room. `CALL_BAR_TOP` plus a row of `md` controls in a padded surface.
     */
    chromeReserve: () =>
      callId() !== null || ongoingPeers().length > 0 ? { bottom: CALL_BAR_RESERVE_PX } : { bottom: 0 },

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
    ongoing: ongoingPeers,

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
    toggleScreenShare: async () => {
      if (media().screenShareEnabled) {
        controller?.stopScreenShare();
        return;
      }
      // Only a genuine failure is worth a message. Closing the picker is an answer, not a fault.
      if ((await controller?.startScreenShare()) === 'failed') setProblem(SCREEN_UNAVAILABLE);
    },
    /** Show the video, or put it away. The other half of what one button used to do alone. */
    toggleStage: () => setVisible(!visible()),
    closeStage: () => setVisible(false),

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
      // Letting everyone back on the stage ends solo with it: it is a property of *having* a
      // spotlight, and a mode left armed with nothing to apply to would take effect on whoever was
      // focused next, which nobody asked for.
      if (next === null) setSolo(false);
      // The states array carries `focused`, so the change has to reach it for the layout to move.
      rebuildTiles();
    },

    /**
     * Give the spotlight the stage to itself, or bring the others back.
     *
     * Only meaningful while something is focused, and the bar only shows it then — but guarded here
     * too, since a store method is reachable by anything a template can write.
     */
    toggleSolo: () => {
      if (focusedId() === null) return;
      setSolo(!solo());
    },

    dismissProblem: () => setProblem(null),

    /**
     * Ask the backend to forward a different simulcast layer.
     *
     * `'high'` is the full-resolution stream, `'medium'` halves each dimension, `'low'` quarters it.
     * The preference propagates to the backend (SFU relay), which selects the matching layer for
     * every forwarded stream. Silently accepted on a mesh call (no simulcast layers).
     */
    setQualityPreference: async (quality: BackendQuality) => {
      qualityIsManual = true;
      setQualityPreferenceSignal(quality);
      if (backend) await backend.setQualityPreference(quality);
    },

    /**
     * Send data to all other call participants via the session's relay.
     *
     * Only works when a backend (Session) handles the call — mesh-only calls
     * have no server relay for data. Returns silently if no backend exists.
     */
    sendData: async (label: string, data: string, binary?: boolean) => {
      if (backend) await backend.sendData(label, data, binary);
    },

    /**
     * Subscribe to data channel messages from other call participants.
     * Returns an unsubscribe function.
     */
    onData: (cb: (msg: BackendDataMessage) => void) => {
      dataListeners.add(cb);
      return () => {
        dataListeners.delete(cb);
      };
    },
  };
}
