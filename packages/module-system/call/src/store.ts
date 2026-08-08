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
  name?: string;
  avatar?: string;
  /** `null` until that peer's media arrives, which is normal for the first second or two. */
  stream: MediaStream | null;
  isSelf: boolean;
}

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
}

export interface CallStoreDeps extends ModuleStoreDeps {
  /** Overridable for tests; defaults to the browser's WebRTC and media APIs. */
  createPeerConnection?: () => RTCPeerConnection;
}

export function createCallStore(deps: CallStoreDeps) {
  const { signal, effect, dataset, datasetUri, selfId, ephemeral, presence } = deps;

  const [callId, setCallId] = signal<string | null>(null);
  const [tiles, setTiles] = signal<CallTile[]>([]);
  const [tileStates, setTileStates] = signal<CallTileState[]>([]);
  const [expanded, setExpanded] = signal(false);
  const [media, setMedia] = signal<MediaSettings>({
    audioEnabled: true,
    videoEnabled: true,
    screenShareEnabled: false,
  });
  /** Surfaced rather than logged: "the call cannot start here" is something the user must see. */
  const [problem, setProblem] = signal<string | null>(null);

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
    const states: CallTileState[] = [];

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

    setTiles(next);
    setTileStates(states);
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
    remoteStreams = new Map();
    peerStates = new Map();
    if (id) presence?.clearActivity('call', id);
    setCallId(null);
    setExpanded(false);
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

  return {
    // ── State ────────────────────────────────────────────────────────────────
    callId,
    tiles,
    tileStates,
    expanded,
    media,
    problem,
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
    localAudio: () => (callId() ? (controller?.localStream() ?? null) : null),

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
      return activitiesOfType(presence.peers(), 'call')
        .filter(({ activity }) => activity.id === id)
        .map(({ peer }) => peer);
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
    toggleStage: () => setExpanded(!expanded()),
    closeStage: () => setExpanded(false),
    dismissProblem: () => setProblem(null),
  };
}
