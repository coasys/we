/**
 * SFU (Selective Forwarding Unit) adapter — one `RTCPeerConnection` to a relay server.
 *
 * ## SFU, not mesh
 *
 * A mesh sends every participant's video to every other participant. That scales to about four people
 * before upstream bandwidth saturates. An SFU receives each participant's media once, then forwards it
 * selectively: each client uploads once and downloads N−1 times, so the bottleneck shifts from the
 * weakest uplink to the relay's bandwidth, which is typically orders of magnitude larger.
 *
 * ## How it fits
 *
 * This adapter implements {@link CallMesh} — the same interface the peer-to-peer mesh exposes — so the
 * store drives both topologies identically. The only difference is construction: the store receives an
 * {@link SfuBackend} through its deps and hands it here instead of building a mesh. Everything above
 * (tiles, focus, media controller) remains unaware of the topology.
 *
 * ## What the host provides
 *
 * {@link SfuBackend} is a structural interface satisfied by `SfuManager` from `@coasys/ad4m`. This
 * module carries no import-time dependency on that package; the host (the WE app, Flux, or a test
 * harness) constructs the manager and passes it in. The decoupling is deliberate: the call module stays
 * framework-agnostic, and the SFU implementation can change without touching the module.
 *
 * ## Quality preferences
 *
 * The SFU supports simulcast with three layers (high / medium / low). The adapter exposes
 * {@link setQualityPreference} so the store can offer a user-facing toggle. The preference propagates
 * to the SFU server, which selects the matching layer for every forwarded stream. On a slow connection,
 * dropping to `low` keeps the call running where a mesh would have frozen.
 */
import type { CallMesh } from './mesh';

// ── Public types ──────────────────────────────────────────────────

/** A quality layer the SFU can forward. Maps to simulcast encodings on the sender. */
export type SfuQuality = 'high' | 'medium' | 'low';

/**
 * Structural interface for an SFU client manager.
 *
 * Satisfied by `SfuManager` from `@coasys/ad4m/neighbourhood` without importing it. The host
 * constructs the manager (with neighbourhood proxy, room id, agent DID, ICE config) and passes it
 * here. This module never touches `NeighbourhoodProxy` or any AD4M type directly.
 */
export interface SfuBackend {
  /** Connect to the SFU room with the agent's outbound media. */
  join(localStream: MediaStream): Promise<void>;
  /** Disconnect from the SFU room. */
  leave(): Promise<void>;
  /** Tell the SFU which simulcast layer to forward for incoming streams. */
  setQualityPreference(preference: SfuQuality): Promise<void>;
  /** Subscribe to an SFU lifecycle event. */
  on(event: 'participant-joined', cb: (p: { did: string; stream: MediaStream }) => void): void;
  on(event: 'participant-left', cb: (p: { did: string }) => void): void;
  on(event: 'stream-added', cb: (stream: MediaStream, track: MediaStreamTrack) => void): void;
  on(event: 'stream-removed', cb: (stream: MediaStream, track: MediaStreamTrack) => void): void;
  on(event: 'error', cb: (error: unknown) => void): void;
  /** Unsubscribe from an event. */
  off(event: string, cb?: (...args: unknown[]) => void): void;
  /** Read the current connection state, including the underlying `RTCPeerConnection`. */
  getState(): { peerConnection: RTCPeerConnection | null };
  /** List participants currently receiving media from this SFU node. */
  getParticipants(): { did: string; stream: MediaStream }[];
  /** Tear down the manager — leaves the room, closes the connection, clears all listeners. */
  destroy(): Promise<void>;
}

export interface CallSfuOptions {
  /** The SFU client manager, already constructed with room and neighbourhood details. */
  backend: SfuBackend;
  /** The agent's outbound media — must contain at least one track for the SDP offer to carry media. */
  localStream: MediaStream;
  /** Fired whenever the set of remote streams changes. Same semantics as the mesh callback. */
  onRemoteStreamsChanged?: (streams: Map<string, MediaStream>) => void;
  /** Fired when the SFU connection state changes. Reported as the self-peer's state. */
  onPeerStateChanged?: (peerId: string, state: RTCPeerConnectionState) => void;
  /** Reported rather than thrown — same discipline as the mesh. */
  onError?: (context: string, error: unknown) => void;
}

// ── Adapter ──────────────────────────────────────────────────────

/**
 * Create an SFU-backed call mesh.
 *
 * Joins the SFU room immediately with `localStream`. Subsequent track changes via
 * {@link CallMesh.setOutboundTrack} replace the track on the existing `RTCPeerConnection` sender —
 * no renegotiation required, same as the peer mesh.
 *
 * Returns a `CallMesh` (for the store) plus {@link setQualityPreference} (for the UI toggle).
 */
export async function createCallSfu(
  options: CallSfuOptions,
): Promise<CallMesh & { setQualityPreference(quality: SfuQuality): Promise<void> }> {
  const { backend, localStream, onRemoteStreamsChanged, onPeerStateChanged, onError } = options;

  const remoteStreams = new Map<string, MediaStream>();
  const peerStates = new Map<string, RTCPeerConnectionState>();
  let closed = false;

  const fail = (context: string, error: unknown) => onError?.(context, error);

  function emitStreams() {
    if (closed) return;
    onRemoteStreamsChanged?.(new Map(remoteStreams));
  }

  // ── Wire up SFU events ──────────────────────────────────────────

  backend.on('participant-joined', (participant) => {
    remoteStreams.set(participant.did, participant.stream);
    emitStreams();
  });

  backend.on('participant-left', (participant) => {
    remoteStreams.delete(participant.did);
    peerStates.delete(participant.did);
    emitStreams();
  });

  backend.on('stream-added', () => emitStreams());

  backend.on('error', (err) => fail('sfu', err));

  // ── Join the SFU room ───────────────────────────────────────────

  await backend.join(localStream);

  // Seed remote streams from anyone already in the room when we joined.
  for (const p of backend.getParticipants()) {
    remoteStreams.set(p.did, p.stream);
  }
  emitStreams();

  // Monitor the single PC's connection state and report it as this peer's state.
  const pc = backend.getState().peerConnection;
  if (pc) {
    const reportState = () => {
      if (closed) return;
      onPeerStateChanged?.('sfu', pc.connectionState);
    };
    pc.addEventListener('connectionstatechange', reportState);
  }

  // ── CallMesh interface ──────────────────────────────────────────

  return {
    setRoster(_peerIds: string[]) {
      // In SFU mode, the server manages room membership. The roster from presence drives tiles in the
      // store but does not create or tear down connections here — that is the whole point of the SFU.
    },

    async setOutboundTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null) {
      const currentPc = backend.getState().peerConnection;
      if (!currentPc || closed) return;

      // Find the sender carrying this kind. After `SfuManager.join()`, the PC has one transceiver per
      // track kind from the local stream. Match by the sender's current track kind, or — when the
      // sender's track has been replaced with null — by the transceiver's receiver track kind, which
      // retains the original direction.
      const sender = currentPc.getSenders().find((s) => {
        if (s.track?.kind === kind) return true;
        if (s.track) return false;
        const transceiver = currentPc.getTransceivers().find((t) => t.sender === s);
        return transceiver?.receiver?.track?.kind === kind;
      });

      if (sender) {
        try {
          await sender.replaceTrack(track);
        } catch (error) {
          fail(`replacing ${kind} track on SFU connection`, error);
        }
      } else if (track) {
        // No sender for this kind yet — the SFU join did not include a track of this kind. Adding one
        // will trigger renegotiation, which the SFU handles via server-pushed offers.
        try {
          currentPc.addTrack(track);
        } catch (error) {
          fail(`adding ${kind} track to SFU connection`, error);
        }
      }
    },

    remoteStreams() {
      return new Map(remoteStreams);
    },

    peerStates() {
      return new Map(peerStates);
    },

    close() {
      if (closed) return;
      closed = true;
      backend.leave().catch((err) => fail('sfu-leave', err));
      remoteStreams.clear();
      peerStates.clear();
      emitStreams();
    },

    async setQualityPreference(quality: SfuQuality) {
      try {
        await backend.setQualityPreference(quality);
      } catch (error) {
        fail('quality-preference', error);
      }
    },
  };
}
