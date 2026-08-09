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
}

/**
 * How much of the screen the call is asking for.
 *
 * Four states rather than the `expanded` boolean this replaced, because a call is two different
 * things at different moments and one flag could only ever be right about one of them. `strip` is a
 * call you are *in* while working — glanceable, overlaying, taking no room. `dock` is a call you
 * are *watching* — a real panel that shrinks the app beside it, which is the only arrangement where
 * both are usable at once. `max` is a demo, and gives up on the app entirely for the duration.
 *
 * The progression is deliberate and one button walks it: hidden → strip → dock → max → hidden.
 */
export type CallStageMode = 'hidden' | 'strip' | 'dock' | 'max';

/** Which edge the docked stage occupies. A preference, and the only geometry the module states. */
export type CallDockEdge = 'left' | 'right' | 'top' | 'bottom';

/** How much room the docked stage asks the host for. Resolved to pixels by the host, not here. */
export type CallDockSize = 'sm' | 'md' | 'lg';

export interface CallStoreDeps extends ModuleStoreDeps {
  /** Overridable for tests; defaults to the browser's WebRTC and media APIs. */
  createPeerConnection?: () => RTCPeerConnection;
}

export function createCallStore(deps: CallStoreDeps) {
  const { signal, effect, dataset, datasetUri, selfId, ephemeral, presence, identities } = deps;

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
  const [stageMode, setStageMode] = signal<CallStageMode>('hidden');
  const [dockEdge, setDockEdge] = signal<CallDockEdge>('right');
  const [dockSize, setDockSize] = signal<CallDockSize>('md');
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
      next.push(stabilise({ id: me, did: me, stream: controller?.displayStream() ?? null, isSelf: true }));
      states.push({
        id: me,
        isScreen: state?.screenShareEnabled ?? false,
        audioEnabled: state?.audioEnabled ?? false,
        videoEnabled: state?.videoEnabled ?? false,
      });
    }

    for (const { peer, activity } of activitiesOfType(presence?.peers() ?? [], 'call')) {
      if (activity.id !== id || peer.agentId === me) continue;
      const settings = activity.media;
      next.push(
        stabilise({
          id: peer.agentId,
          did: peer.agentId,
          stream: remoteStreams.get(peer.agentId) ?? null,
          isSelf: false,
        }),
      );
      states.push({
        id: peer.agentId,
        // Read from the roster, never inferred from the track — the sender is the only one who knows
        // whether the video it is sending is a camera or a desktop.
        isScreen: settings?.screenShareEnabled ?? false,
        audioEnabled: settings?.audioEnabled ?? true,
        videoEnabled: settings?.videoEnabled ?? true,
        connection: peerStates.get(peer.agentId),
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

  /** Republish the call activity so peers see mute/camera/screen changes. */
  function publishActivity(anchor?: Focus) {
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
    setLocalAudio(null);
    remoteStreams = new Map();
    peerStates = new Map();
    if (id) presence?.clearActivity('call', id);
    setCallId(null);
    setStageMode('hidden');
    setFocusedId(null);
    focusIsManual = false;
    sharingPeers = new Set();
    setTiles([]);
  }

  async function join(id: string, anchor?: Focus) {
    if (callId() === id) return;
    if (callId()) teardown();

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
        // Fires once when devices are acquired, and on every mute after — the first is what tells a
        // listener the microphone exists at all.
        setLocalAudio(controller?.localStream() ?? null);
        publishActivity(anchor);
        rebuildTiles();
      },
      onError: (context, error) => console.error(`call: ${context}`, error),
    });

    // Announce before acquiring devices: joining should be visible to peers immediately, and the
    // permission prompt can take as long as the user takes.
    publishActivity(anchor);
    rebuildTiles();

    await controller.start();
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

  /** The next mode the one expand button lands on. Wraps, so the same button also puts it away. */
  const NEXT_MODE: Record<CallStageMode, CallStageMode> = {
    hidden: 'strip',
    strip: 'dock',
    dock: 'max',
    max: 'hidden',
  };

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
  function stageColumns(count: number, focused: boolean, mode: CallStageMode, edge: CallDockEdge): number {
    if (count <= 1) return 1;
    if (focused) return Math.min(count - 1, 4);
    const vertical = mode === 'dock' && (edge === 'left' || edge === 'right');
    if (vertical) return count <= 3 ? 1 : 2;
    return count <= 4 ? 2 : 3;
  }

  return {
    // ── State ────────────────────────────────────────────────────────────────
    callId,
    tiles,
    tileStates,
    stageMode,
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
    dockEdge: () => (stageMode() === 'hidden' || !callId() ? null : dockEdge()),
    dockSize: (): CallDockSize | 'full' =>
      stageMode() === 'max' ? 'full' : stageMode() === 'strip' ? 'sm' : dockSize(),
    /** Overlay rather than inset: a strip is too small to be worth shrinking the app for, a
     *  maximised stage too large to leave anything of it. */
    dockFloat: () => stageMode() === 'strip' || stageMode() === 'max',

    /** The edge picker's options, pre-built — a schema can `$each` an array but cannot author one. */
    dockEdgeOptions: () => [
      { id: 'left', icon: 'arrow-line-left', label: 'Dock left', active: dockEdge() === 'left' },
      { id: 'right', icon: 'arrow-line-right', label: 'Dock right', active: dockEdge() === 'right' },
      { id: 'top', icon: 'arrow-line-up', label: 'Dock top', active: dockEdge() === 'top' },
      { id: 'bottom', icon: 'arrow-line-down', label: 'Dock bottom', active: dockEdge() === 'bottom' },
    ],
    dockSizeOptions: () => [
      { id: 'sm', label: 'Small', active: dockSize() === 'sm' },
      { id: 'md', label: 'Medium', active: dockSize() === 'md' },
      { id: 'lg', label: 'Large', active: dockSize() === 'lg' },
    ],

    /** True while the stage is showing anything at all — what the expand button's icon follows. */
    stageOpen: () => stageMode() !== 'hidden',
    /** True while the stage is a docked panel, so the size and edge controls only appear where they act. */
    stageDocked: () => stageMode() === 'dock',

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
    stageStyle: (): Record<string, string> =>
      stageMode() === 'strip'
        ? {
            display: 'grid',
            'grid-auto-flow': 'column',
            // 16:9 at the strip's own height. Fixed rather than derived, because deriving it needs
            // the panel's measured height and the whole arrangement exists to avoid measuring.
            'grid-auto-columns': '220px',
            'grid-template-rows': '1fr',
          }
        : {
            display: 'grid',
            'grid-template-columns': `repeat(${stageColumns(tiles().length, focusedId() !== null, stageMode(), dockEdge())}, 1fr)`,
            'grid-auto-rows': '1fr',
          },

    /**
     * Each tile's placement in that grid, looked up by id the same way its volatile flags are.
     *
     * Computed on read rather than stored on the tile — for the reason the tile carries so little,
     * and for one more besides. Placement depends on the *mode*, which changes without the roster
     * changing, so a stored copy would have to be rebuilt from somewhere that has no business
     * knowing about layout. Here it simply re-derives, and every signal it reads makes it reactive.
     */
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
      const strip = stageMode() === 'strip';
      // A focused tile spans the full width and two rows: the classic spotlight, in one declaration,
      // at any participant count. In a strip there is nothing to spotlight — every cell is already
      // the same size and there is only one row.
      const spotlight: Record<string, string | number> = { 'grid-column': '1 / -1', 'grid-row': 'span 2', order: -1 };
      return tiles().map((entry) => ({
        id: entry.id,
        style: !strip && entry.id === focus ? spotlight : {},
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
    toggleVideo: () => controller?.setVideoEnabled(!media().videoEnabled),
    toggleScreenShare: () => {
      if (media().screenShareEnabled) controller?.stopScreenShare();
      else void controller?.startScreenShare();
    },
    /** Walk the stage one step bigger, and round to hidden. See {@link CallStageMode}. */
    cycleStage: () => setStageMode(NEXT_MODE[stageMode()]),
    closeStage: () => setStageMode('hidden'),
    setDockEdge: (edge: CallDockEdge) => setDockEdge(edge),
    setDockSize: (size: CallDockSize) => setDockSize(size),

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
