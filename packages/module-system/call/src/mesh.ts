/**
 * The peer-connection mesh — one `RTCPeerConnection` per remote participant.
 *
 * ## Mesh, not SFU
 *
 * Every participant connects to every other, so N participants means N−1 connections each and each
 * peer uploads its video N−1 times. That ceiling is real — roughly four to six before upstream
 * bandwidth becomes the limit — and it is the honest choice here, because an SFU is a *server*, and a
 * local-first app that quietly requires one has stopped being local-first. The alternative is not
 * "mesh but scalable", it is "someone must run infrastructure".
 *
 * ## Membership comes from presence; this file only negotiates
 *
 * {@link CallMesh.setRoster} is called with whoever presence says is in the call. Connections are
 * reconciled against it: appear → connect, disappear → tear down. There is no join or leave message,
 * because a peer that crashes never sends one. See `protocol.ts`.
 *
 * ## Perfect negotiation
 *
 * Both peers see each other join at slightly different moments, both add tracks, and both fire
 * `negotiationneeded` — so offers collide. The mesh implements the standard *perfect negotiation*
 * pattern: each pair has a **polite** peer and an **impolite** one, decided by comparing ids, which is
 * deterministic and needs no agreement round-trip (the same lower-id-wins trick the tab coordinator
 * uses to break leader ties). On collision the impolite peer ignores the incoming offer and the polite
 * peer rolls back its own. Exactly one offer survives.
 *
 * This is also what makes mid-call renegotiation safe, which matters because screen share and
 * reconnects both trigger it.
 *
 * ## Why it types against the DOM's WebRTC classes
 *
 * `RTCPeerConnection` and `MediaStream` are W3C interfaces, not a framework — a host that lacks them
 * has no WebRTC at all, so abstracting over them would buy nothing. The *constructor* is injected all
 * the same, so tests can drive the whole negotiation with a fake and no browser.
 */
import { CALL_PROTOCOL_VERSION, type CallBody, type CallMessage, parseCallMessage } from './protocol';

/** Structurally an `EphemeralChannel`, restated so this module is testable with a fake and carries no
 *  import-time dependency on the port. */
export interface SignallingChannel {
  publish(payload: unknown, to?: { agentId?: string }): void;
  onMessage(cb: (from: string, payload: unknown) => void): () => void;
}

export interface CallMeshOptions {
  /** Which call this mesh serves. A space can host several at once. */
  callId: string;
  selfId: string;
  channel: SignallingChannel;
  /**
   * Injected so tests can supply a fake. Defaults to the browser's, with public STUN — no TURN, so
   * peers behind symmetric NAT will fail to connect. Configurable rather than solved: a TURN server
   * is infrastructure someone has to run, which is a deployment decision, not a module one.
   */
  createPeerConnection?: () => RTCPeerConnection;
  /** Fired whenever the set of remote streams changes — a peer joined, left, or started sending. */
  onRemoteStreamsChanged?: (streams: Map<string, MediaStream>) => void;
  onPeerStateChanged?: (peerId: string, state: RTCPeerConnectionState) => void;
  /** Reported rather than thrown: one peer failing to negotiate must not take down the call. */
  onError?: (context: string, error: unknown) => void;
}

export interface CallMesh {
  /** Reconcile connections against who presence says is in the call. Excludes this agent. */
  setRoster(peerIds: string[]): void;
  /**
   * Set what this agent sends on a track kind. `null` stops sending that kind.
   *
   * Replaces the track on the existing sender where there is one, which is what makes camera↔screen
   * swapping free: `replaceTrack` does not renegotiate, so the switch is instant and cannot fail
   * half-way for one peer and not another.
   */
  setOutboundTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null): Promise<void>;
  remoteStreams(): Map<string, MediaStream>;
  peerStates(): Map<string, RTCPeerConnectionState>;
  close(): void;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];

interface PeerSlot {
  pc: RTCPeerConnection;
  /** Decided by id comparison — symmetric, so the two peers always disagree, which is the point. */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  stream: MediaStream;
  /**
   * The sender carrying each kind, remembered rather than looked up.
   *
   * `getSenders().find((s) => s.track?.kind === kind)` cannot find a sender whose track is `null`,
   * and a sender's track *is* null for the whole time this agent is sending nothing of that kind —
   * which is precisely what `replaceTrack(null)` leaves behind when a screen share stops with no
   * camera to fall back to.
   *
   * The consequence was not a missing frame, it was a permanent one. Sharing again found no sender,
   * took the `addTrack` branch, and gave the peer a *second* video track; their `<video>` renders
   * the first one in the stream, which is the dead one. Their view froze on the last shared frame
   * and never recovered, for the rest of the call.
   */
  senders: Map<'audio' | 'video', RTCRtpSender>;
}

export function createCallMesh(options: CallMeshOptions): CallMesh {
  const { callId, selfId, channel } = options;
  const createPeerConnection =
    options.createPeerConnection ?? (() => new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS }));

  const slots = new Map<string, PeerSlot>();
  const states = new Map<string, RTCPeerConnectionState>();
  const outbound = new Map<'audio' | 'video', MediaStreamTrack | null>();
  /** One stream for all of this agent's outbound tracks, so a remote peer receives mic and camera
   *  grouped as one stream rather than two unrelated ones it would have to correlate itself. */
  const outboundStream = new MediaStream();
  let closed = false;

  const fail = (context: string, error: unknown) => options.onError?.(context, error);

  const emitStreams = () => {
    const streams = new Map<string, MediaStream>();
    for (const [peerId, slot] of slots) streams.set(peerId, slot.stream);
    options.onRemoteStreamsChanged?.(streams);
  };

  /**
   * Addressed twice, on purpose.
   *
   * `to` on the publish lets a backend with **native** unicast actually send to one peer. The
   * recipient is *also* in the payload because `unicast: 'emulated'` means the transport fans out and
   * filters on receipt — and on a fanout-only transport it would not filter at all, so a third peer
   * would apply an offer meant for someone else and negotiate a connection nobody asked for. The
   * duplicated field costs a few bytes and makes the mesh correct on every transport tier.
   *
   * It is addressing, never privacy: on an emulated transport every peer still receives the bytes.
   */
  const send = (to: string, message: CallBody) => {
    channel.publish({ v: CALL_PROTOCOL_VERSION, call: callId, to, ...message }, { agentId: to });
  };

  function connect(peerId: string): PeerSlot {
    const existing = slots.get(peerId);
    if (existing) return existing;

    const pc = createPeerConnection();
    const slot: PeerSlot = {
      pc,
      // Comparing ids gives each pair exactly one polite side without a round trip.
      polite: selfId > peerId,
      makingOffer: false,
      ignoreOffer: false,
      stream: new MediaStream(),
      senders: new Map(),
    };
    slots.set(peerId, slot);

    pc.onnegotiationneeded = async () => {
      try {
        slot.makingOffer = true;
        // No argument: the browser picks offer or answer from the signaling state, which is what
        // makes the rolled-back case recover on its own.
        await pc.setLocalDescription();
        if (pc.localDescription) send(peerId, { kind: 'description', description: pc.localDescription });
      } catch (error) {
        fail(`negotiating with ${peerId}`, error);
      } finally {
        slot.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) send(peerId, { kind: 'ice', candidate: candidate.toJSON() });
    };

    pc.ontrack = ({ track }) => {
      slot.stream.addTrack(track);
      // A replaced track (camera → screen) arrives as a new track and the old one ends. Without this
      // the tile would accumulate dead tracks and keep rendering the first one.
      track.addEventListener('ended', () => {
        slot.stream.removeTrack(track);
        emitStreams();
      });
      emitStreams();
    };

    pc.onconnectionstatechange = () => {
      states.set(peerId, pc.connectionState);
      options.onPeerStateChanged?.(peerId, pc.connectionState);
    };

    // Send whatever we are already sending. A peer joining mid-call must receive our media without
    // waiting for us to toggle something.
    for (const [kind, track] of outbound) {
      if (!track) continue;
      try {
        slot.senders.set(kind, pc.addTrack(track, outboundStream));
      } catch (error) {
        fail(`adding track for ${peerId}`, error);
      }
    }

    return slot;
  }

  function disconnect(peerId: string) {
    const slot = slots.get(peerId);
    if (!slot) return;
    slot.pc.onnegotiationneeded = null;
    slot.pc.onicecandidate = null;
    slot.pc.ontrack = null;
    slot.pc.onconnectionstatechange = null;
    try {
      slot.pc.close();
    } catch (error) {
      fail(`closing connection to ${peerId}`, error);
    }
    slots.delete(peerId);
    states.delete(peerId);
  }

  const unsubscribe = channel.onMessage((from, payload) => {
    if (closed || from === selfId) return;

    const message = parseCallMessage(payload);
    if (!message || message.call !== callId) return;

    // See `send` — the recipient is carried in the payload so a fanout-only transport cannot cause a
    // bystander to negotiate.
    const to = (payload as { to?: unknown }).to;
    if (typeof to === 'string' && to !== selfId) return;

    // Only negotiate with peers the roster put in the call. Without this, anyone on the channel could
    // open a connection by sending an offer.
    const slot = slots.get(from);
    if (!slot) {
      hold(from, message);
      return;
    }

    void handle(from, slot, message);
  });

  /**
   * Signalling that arrived before the roster had caught up, kept until it does.
   *
   * Dropping it was normally self-healing: both peers add tracks, so whoever's offer was discarded
   * fires `negotiationneeded` again a moment later. **A peer who denied the microphone has no
   * outbound tracks, so it never fires at all.** They joined, appeared on everyone's roster, and
   * connected to nobody in either direction — showing "Connecting…" forever, since `connectionState`
   * never reaches `failed` and the honest error badge never appears.
   *
   * Bounded on both axes, because this buffers messages from agents the roster has not vouched for
   * and an unbounded one is a memory target for anybody on the channel. Overflow drops the oldest:
   * a stale offer is worth less than the one behind it.
   */
  const pending = new Map<string, CallMessage[]>();
  const MAX_PENDING_PEERS = 16;
  const MAX_PENDING_PER_PEER = 8;

  function hold(peerId: string, message: CallMessage): void {
    if (!pending.has(peerId) && pending.size >= MAX_PENDING_PEERS) return;
    const queue = pending.get(peerId) ?? [];
    queue.push(message);
    if (queue.length > MAX_PENDING_PER_PEER) queue.shift();
    pending.set(peerId, queue);
  }

  /** Replay what this peer sent while we were still learning they were here. */
  function release(peerId: string, slot: PeerSlot): void {
    const queue = pending.get(peerId);
    if (!queue) return;
    pending.delete(peerId);
    for (const message of queue) void handle(peerId, slot, message);
  }

  async function handle(peerId: string, slot: PeerSlot, message: CallMessage) {
    try {
      if (message.kind === 'description') {
        const { description } = message;
        const collision = description.type === 'offer' && (slot.makingOffer || slot.pc.signalingState !== 'stable');

        // The impolite peer wins a collision by ignoring the other's offer; the polite peer yields,
        // and `setRemoteDescription` performs the implicit rollback that lets it accept.
        slot.ignoreOffer = !slot.polite && collision;
        if (slot.ignoreOffer) return;

        await slot.pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await slot.pc.setLocalDescription();
          if (slot.pc.localDescription) {
            send(peerId, { kind: 'description', description: slot.pc.localDescription });
          }
        }
        return;
      }

      try {
        await slot.pc.addIceCandidate(message.candidate);
      } catch (error) {
        // Candidates for an offer we deliberately ignored will fail, and that is expected — the
        // connection they belong to was never established. Anything else is real.
        if (!slot.ignoreOffer) throw error;
      }
    } catch (error) {
      fail(`handling ${message.kind} from ${peerId}`, error);
    }
  }

  return {
    setRoster(peerIds) {
      if (closed) return;
      const wanted = new Set(peerIds.filter((id) => id !== selfId));

      for (const peerId of slots.keys()) {
        if (!wanted.has(peerId)) disconnect(peerId);
      }
      for (const peerId of wanted) {
        if (!slots.has(peerId)) release(peerId, connect(peerId));
      }
      // Anything held for an agent the roster does not list is not going to be wanted.
      for (const peerId of pending.keys()) {
        if (!wanted.has(peerId)) pending.delete(peerId);
      }
      emitStreams();
    },

    async setOutboundTrack(kind, track) {
      const previous = outbound.get(kind);
      outbound.set(kind, track);
      if (previous) outboundStream.removeTrack(previous);
      if (track) outboundStream.addTrack(track);
      if (closed) return;

      await Promise.all(
        [...slots.entries()].map(async ([peerId, slot]) => {
          try {
            // The remembered sender, not one found by its current track — see `PeerSlot.senders`.
            const sender = slot.senders.get(kind);
            if (sender) {
              // Does not renegotiate — this is why camera↔screen switching is instant, and why
              // resuming a share the peer already has a transceiver for needs no handshake at all.
              await sender.replaceTrack(track);
            } else if (track) {
              // First track of this kind: adding a sender *does* fire `negotiationneeded`, which
              // perfect negotiation above resolves.
              slot.senders.set(kind, slot.pc.addTrack(track, outboundStream));
            }
          } catch (error) {
            fail(`setting ${kind} track for ${peerId}`, error);
          }
        }),
      );
    },

    remoteStreams() {
      const streams = new Map<string, MediaStream>();
      for (const [peerId, slot] of slots) streams.set(peerId, slot.stream);
      return streams;
    },

    peerStates() {
      return new Map(states);
    },

    close() {
      closed = true;
      unsubscribe();
      pending.clear();
      for (const peerId of [...slots.keys()]) disconnect(peerId);
      emitStreams();
    },
  };
}
