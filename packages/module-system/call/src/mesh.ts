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
 * ## The signalling channel is not reliable, and perfect negotiation assumes it is
 *
 * This is the correction that most of the machinery below exists for, and it is worth stating
 * plainly because the original implementation was a faithful copy of a pattern whose unwritten
 * premise does not hold here.
 *
 * Perfect negotiation, as specified, assumes a reliable ordered channel — a WebSocket. What it runs
 * on here is `EphemeralScope.channel`, whose AD4M implementation declares
 * `reliability: 'send-acked'`: the executor confirms it *took* the message and nothing confirms a
 * peer received it. Sends are dispatched concurrently, so there is no ordering either. And the first
 * broadcast on a freshly joined neighbourhood has been measured at **eighteen seconds**.
 *
 * Against that transport, the pattern's failure modes stop being theoretical and become the
 * ordinary experience of starting a call:
 *
 * - **A lost offer deadlocks a pair.** The impolite peer ignores the polite peer's offer on a
 *   collision, expecting its own to win — and its own was the one that was dropped. Both then wait
 *   forever, `connectionState` never reaches `failed`, and the tile says "Connecting…" for the rest
 *   of the call.
 * - **A candidate overtaking its description is discarded.** `addIceCandidate` throws with no remote
 *   description, and on an unordered transport that is the normal case rather than a race.
 * - **Concurrent handling corrupts the state machine.** Two messages for one peer, each awaiting
 *   `setRemoteDescription`, read `makingOffer` and `signalingState` at moments that are stale by the
 *   time they resume.
 *
 * None of those recovered, because nothing ever revisited a connection once it existed. Four
 * mechanisms fix that, and all four are about the same thing — a pair that has not connected is a
 * pair worth trying again with:
 *
 * 1. **Per-peer serialisation.** Signalling for one peer runs one message at a time ({@link enqueue}).
 * 2. **Candidate buffering.** Candidates arriving before a remote description wait for one.
 * 3. **A recovery ladder.** ICE restart → resend the description → rebuild the pair, escalating, on a
 *    sweep ({@link CallMesh.tick}) rather than on a single event.
 * 4. **A `reset` message**, so a rebuild is agreed rather than unilateral. See `protocol.ts`.
 *
 * ## Who repairs, and why not both
 *
 * Recovery uses the same tie-break as offers: the **impolite** peer acts first. Two peers restarting
 * ICE at each other is the glare problem again one layer up, and this pair already has a
 * deterministic, agreement-free way to pick one of them.
 *
 * The polite peer is not merely passive, though — it runs the same ladder on a doubled deadline. In
 * the ordinary case the impolite side repairs long before that fires and it never comes up. It
 * matters for the case the impolite side cannot see: a peer whose roster never listed the other has
 * no slot, so it has nothing to notice and nothing to repair, and without this the pair would wait on
 * an agent that is not coming.
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
  /**
   * Optional on the port, and optional here for the same reason: a transport that cannot tell what
   * became of a send must not pretend. Where it exists the mesh uses it for one thing — knowing
   * whether a send is still outstanding — which is what separates "the message was lost" from "the
   * message has not gone yet". See {@link outstanding}.
   */
  onPublishResult?(cb: (result: { ok: boolean; ms: number }) => void): () => void;
}

export interface CallMeshOptions {
  /** Which call this mesh serves. A space can host several at once. */
  callId: string;
  selfId: string;
  channel: SignallingChannel;
  /**
   * Where to find NAT traversal. Defaults to {@link DEFAULT_ICE_SERVERS} — public STUN and no TURN,
   * so a pair behind symmetric NAT will not connect.
   *
   * Configurable rather than pinned, which is the part that was missing: a TURN server is
   * infrastructure somebody has to run, so the module cannot *ship* one, but it has no business
   * making that unreachable for a deployment that does. Flux got this right and WE lost it — Flux
   * shipped `turn:relay.ad4m.dev` by default and let a user add their own in settings. The relay is
   * decommissioned now, which is the argument against a default rather than against the mechanism.
   */
  iceServers?: RTCIceServer[];
  /**
   * Injected so tests can supply a fake. Receives the configuration the mesh decided on — the ICE
   * opinion stays here, and the host only lends the constructor.
   */
  createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
  /** Fired whenever the set of remote streams changes — a peer joined, left, or started sending. */
  onRemoteStreamsChanged?: (streams: Map<string, MediaStream>) => void;
  onPeerStateChanged?: (peerId: string, state: RTCPeerConnectionState) => void;
  /**
   * A repair was attempted on this pair. Reported so a tile can say "Reconnecting…" rather than
   * showing the same motionless spinner it showed before anything was being done about it.
   */
  onPeerRecovery?: (peerId: string, attempt: { rung: RecoveryRung; attempts: number }) => void;
  /** Reported rather than thrown: one peer failing to negotiate must not take down the call. */
  onError?: (context: string, error: unknown) => void;
  /** Injectable clock, so the recovery ladder is testable without waiting out real deadlines. */
  now?: () => number;
  /** How often the mesh looks at its own connections. `0` disables the timer; {@link CallMesh.tick}
   *  still works, which is how tests drive it. */
  sweepMs?: number;
}

/** Which rung of the recovery ladder an attempt was on — see the ladder in {@link repair}. */
export type RecoveryRung = 'ice-restart' | 'resend' | 'rebuild';

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
  /**
   * Throw one pair's connection away and negotiate it again, telling the peer to do the same.
   *
   * The manual rung of the ladder, for the button on a tile. Deliberately reachable from either side
   * regardless of politeness: the person pressing it is looking at the tile that is broken, and
   * telling them the other agent is the one who has to press it would be absurd.
   */
  reconnect(peerId: string): void;
  /**
   * Look at every connection and repair what is stuck. Driven by an internal timer; exposed because
   * a test needs to drive it, and because a failed send is a reason to look now rather than in two
   * seconds' time.
   */
  tick(): void;
  /**
   * How this pair's media is actually reaching the other end — `host` on a LAN, `srflx` through
   * NAT, `relay` through TURN — or `null` when nothing is connected or the host's
   * `RTCPeerConnection` has no `getStats`.
   *
   * The one diagnostic that separates "you need TURN" from "the handshake never finished", which is
   * otherwise a question nobody can answer from outside. Both look identical on the tile.
   */
  transportOf(peerId: string): Promise<string | null>;
  close(): void;
}

/**
 * Public STUN, and no TURN — see {@link CallMeshOptions.iceServers}.
 *
 * Two servers rather than one because a single point of failure for candidate gathering is a single
 * point of failure for the call, and they cost nothing: ICE queries them in parallel and takes
 * whatever answers.
 *
 * Exported because the store resolves the deployment's configured servers and falls back to these,
 * and because a caller passing no `iceServers` should be able to see what it is getting.
 */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/**
 * How long a pair may sit unconnected before the impolite side intervenes.
 *
 * Chosen against the transport rather than against WebRTC: an ordinary handshake is well under a
 * second, but the *first* broadcast on a fresh neighbourhood has been measured at eighteen seconds,
 * and repairing a handshake whose offer simply has not gone yet would add load to the thing already
 * stalled. That case is handled properly by {@link outstanding} — a send in flight defers repair —
 * so this only has to be longer than a healthy negotiation, not longer than the worst transport.
 */
export const HANDSHAKE_GRACE_MS = 10_000;

/** How long each rung of the ladder is given before escalating to the next. */
export const RECOVERY_INTERVAL_MS = 8_000;

/**
 * How long `disconnected` is tolerated before an ICE restart.
 *
 * Shorter than the others because `disconnected` is not a verdict — it is ICE saying it has stopped
 * hearing from the other end, and it very often recovers by itself within a second or two. Restarting
 * immediately would throw away a connection that was about to come back; waiting as long as a failed
 * handshake would leave a call frozen while the picture everyone is looking at is stale.
 */
export const DISCONNECT_GRACE_MS = 5_000;

/**
 * How many times a pair is repaired before the mesh stops and lets the tile say so.
 *
 * Trying forever is not persistence, it is a spinner that never resolves: a pair that has failed a
 * full ladder four times is behind a NAT that needs TURN, or on a network that is down, and neither
 * is fixed by a fifth attempt. Stopping is what lets `failed` reach the tile and the reconnect button
 * become the honest next step.
 */
export const MAX_RECOVERY_ATTEMPTS = 4;

/** How often the mesh looks at its own connections, when not driven by hand. */
export const SWEEP_INTERVAL_MS = 2_000;

/**
 * The shortest gap between two repairs, whatever asks for them.
 *
 * `tick` is not only called by the sweep: a settled send calls it too, so that a lost message is
 * acted on immediately rather than up to two seconds later. Without a floor those two compose
 * badly — a repair publishes, the publish settles, that calls `tick`, which repairs the next pair,
 * which publishes — and a four-person call rebuilds every connection it has in one burst, onto the
 * transport that was already the problem. The "one pair per sweep" rule in {@link tick} bounds a
 * single call; this is what bounds the cascade of calls.
 *
 * Below {@link SWEEP_INTERVAL_MS} on purpose, so the ordinary cadence is never itself throttled.
 */
export const REPAIR_SPACING_MS = 1_500;

/**
 * Candidates held for a remote description that has not arrived.
 *
 * Bounded like `pending` below, and for the same reason: it buffers on behalf of a peer whose
 * signalling is misbehaving. A generous ceiling, because a full gathering round on a multi-homed
 * machine is a few dozen candidates and discarding the tail would silently cost connectivity.
 */
const MAX_EARLY_CANDIDATES = 64;

/** The handful of `RTCStats` fields {@link CallMesh.transportOf} reads. The DOM types the report as
 *  `ReadonlyMap<string, any>`, so naming what is actually used is the only typing available. */
interface RtcStatReport {
  type?: string;
  id?: string;
  state?: string;
  localCandidateId?: string;
  candidateType?: string;
}

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
  /**
   * The tail of this peer's signalling, so messages are applied one at a time.
   *
   * `setRemoteDescription` and `setLocalDescription` are operations on a state machine and each one
   * awaits. Handled concurrently, the collision test reads `makingOffer` and `signalingState` at a
   * moment that may already be wrong, and two descriptions can be applied out of order — which is
   * not hypothetical here, because `release` replays a whole held queue at once and the transport
   * delivers without ordering.
   */
  work: Promise<void>;
  /** A remote description has been applied, so candidates can be too. */
  remoteReady: boolean;
  /** Candidates that arrived before {@link remoteReady}, replayed the moment it is true. */
  earlyCandidates: RTCIceCandidateInit[];
  /** The last description this side sent, so a lost one can be sent again rather than rebuilt. */
  lastSent: RTCSessionDescriptionInit | null;
  /**
   * The `sdp` of the description this pair has already had resent once.
   *
   * What stops the second rung becoming a loop. Resending is worth exactly one try: if the peer did
   * not act on the same description twice, the message is not what is wrong, and sending it a third
   * time is a slower way of never escalating to a rebuild.
   */
  lastResent: string | null;
  /**
   * This pair has been `connected` at least once.
   *
   * What separates "the handshake never finished" from "the connection died" — two failures that
   * want opposite repairs. Resending a description is right for the first and pointless for the
   * second: a pair that connected is a pair whose messages demonstrably arrived, so what broke is
   * the transport, and only ICE has anything to say about that.
   */
  everConnected: boolean;
  /** When this slot was created or last rebuilt — where the handshake deadline counts from. */
  since: number;
  /** When the last repair was attempted, so rungs are spaced rather than fired in a burst. */
  lastAttempt: number;
  /** How many repairs this pair has had. Reset by a successful connection. */
  attempts: number;
  /** When ICE first reported `disconnected`, or 0. Its own grace period — see the constant. */
  disconnectedAt: number;
}

export function createCallMesh(options: CallMeshOptions): CallMesh {
  const { callId, selfId, channel } = options;
  const now = options.now ?? (() => Date.now());
  const configuration: RTCConfiguration = {
    iceServers: options.iceServers?.length ? options.iceServers : DEFAULT_ICE_SERVERS,
    /*
      Gather one candidate set before anybody asks for it.

      ICE normally starts gathering at `setLocalDescription`, so the STUN round trip is spent inside
      the handshake. With a pool it is spent while the user is still reading the permission prompt,
      and the offer goes out with candidates already in hand. Worth a little more traffic on a
      transport whose first send can take eighteen seconds.
    */
    iceCandidatePoolSize: 1,
  };
  const createPeerConnection =
    options.createPeerConnection ?? ((config: RTCConfiguration) => new RTCPeerConnection(config));

  const slots = new Map<string, PeerSlot>();
  const states = new Map<string, RTCPeerConnectionState>();
  const outbound = new Map<'audio' | 'video', MediaStreamTrack | null>();
  /** One stream for all of this agent's outbound tracks, so a remote peer receives mic and camera
   *  grouped as one stream rather than two unrelated ones it would have to correlate itself. */
  const outboundStream = new MediaStream();
  let closed = false;

  /**
   * How many sends this mesh has published and not yet heard the outcome of.
   *
   * The whole reason it is counted: with an unreliable transport, "the peer never answered" and "the
   * message has not left yet" look identical from here, and repairing the second one is actively
   * harmful — it piles more sends onto an executor that is already stalled, which is the state that
   * produced the eighteen-second first broadcast in the first place.
   *
   * `onPublishResult` is explicitly *not* correlated with individual messages, and does not need to
   * be for this: one publish yields exactly one result, so a count is exact even though a pairing is
   * not available. Where the transport does not report at all this stays zero and the ladder behaves
   * as though every send landed instantly, which is the right degradation — it is what the mesh did
   * before any of this existed.
   */
  let outstanding = 0;
  /** When a sweep last repaired something — the floor {@link REPAIR_SPACING_MS} describes. */
  let lastRepairAt = 0;
  /**
   * Whether outcomes are reported at all.
   *
   * Counted only where they are, because a count that goes up and never comes down would hold the
   * ladder closed for the life of the call — the exact opposite of what it is for, and a far worse
   * bug than the one it guards against.
   */
  const reportsSends = typeof channel.onPublishResult === 'function';
  const unwatchPublish = channel.onPublishResult?.(() => {
    outstanding = Math.max(0, outstanding - 1);
    /*
      A send whose outcome is known is a reason to look now rather than in two seconds. Deferred a
      microtask rather than called straight out, because a transport may report synchronously from
      inside `publish` — the in-memory one does — and `repair` publishes, so a direct call would
      re-enter the sweep from the middle of a repair it is halfway through.
    */
    queueMicrotask(tick);
  });

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
    if (reportsSends) outstanding += 1;
    channel.publish({ v: CALL_PROTOCOL_VERSION, call: callId, to, ...message }, { agentId: to });
  };

  function connect(peerId: string): PeerSlot {
    const existing = slots.get(peerId);
    if (existing) return existing;

    const pc = createPeerConnection(configuration);
    const slot: PeerSlot = {
      pc,
      // Comparing ids gives each pair exactly one polite side without a round trip.
      polite: selfId > peerId,
      makingOffer: false,
      ignoreOffer: false,
      stream: new MediaStream(),
      senders: new Map(),
      work: Promise.resolve(),
      remoteReady: false,
      earlyCandidates: [],
      lastSent: null,
      lastResent: null,
      everConnected: false,
      since: now(),
      lastAttempt: 0,
      attempts: 0,
      disconnectedAt: 0,
    };
    slots.set(peerId, slot);

    pc.onnegotiationneeded = async () => {
      try {
        slot.makingOffer = true;
        // No argument: the browser picks offer or answer from the signaling state, which is what
        // makes the rolled-back case recover on its own.
        await pc.setLocalDescription();
        if (pc.localDescription) {
          // Remembered so a lost one can be sent again. Resending the exact description is the
          // difference between the second rung of the ladder and the third: the peer connection is
          // intact and only the message was dropped, so nothing needs rebuilding.
          slot.lastSent = { type: pc.localDescription.type, sdp: pc.localDescription.sdp };
          send(peerId, { kind: 'description', description: pc.localDescription });
        }
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
      /*
        A remote track that stops receiving goes MUTED, not ended — and that is the frozen frame.

        `ended` is about the sender deliberately stopping a track, which is the replacement case
        above. When a peer leaves, crashes or drops off the network, nothing ends: the track stays
        `readyState === 'live'` for as long as the connection object exists, and what changes is
        `muted`, which the browser sets when RTP stops arriving. Nothing was listening, so the
        `<video>` kept its `srcObject` and went on painting the last frame it had decoded — for the
        minutes it took the roster to drop the peer.

        Re-emitting on both edges rather than only on `mute`: a connection that recovers unmutes the
        same track, and a tile that had fallen back to an avatar has to come back to the picture
        without waiting for some other event to happen to fire.

        No state of its own. The streams map is rebuilt from the slots and the store reads the tracks
        it holds, so re-emitting is the whole of telling it something changed — see `hasLiveVideo`.
      */
      track.addEventListener('mute', emitStreams);
      track.addEventListener('unmute', emitStreams);
      emitStreams();
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      states.set(peerId, state);
      if (state === 'connected') {
        slot.everConnected = true;
        /*
          A pair that connected has no history worth holding against it.

          Not merely tidiness: without this, a call that drops and recovers twice arrives at
          MAX_RECOVERY_ATTEMPTS and stops repairing itself while nothing is actually wrong. The
          budget is meant to bound one *failure*, not a session.
        */
        slot.attempts = 0;
        slot.disconnectedAt = 0;
        slot.earlyCandidates.length = 0;
      }
      if (state === 'disconnected' && !slot.disconnectedAt) slot.disconnectedAt = now();
      if (state === 'connected' || state === 'failed') slot.disconnectedAt = 0;
      options.onPeerStateChanged?.(peerId, state);
      // `failed` is actionable immediately — there is nothing in flight to wait for.
      if (state === 'failed') tick();
    };

    /*
      Both m-lines, before there is anything to put in them.

      A peer connection can only carry media of a kind it negotiated an m-section for, and
      `addTrack` is what creates one. So an agent sending no video negotiated **no video m-line at
      all** — and since the topology is agreed between the pair, that left the *other* peer's camera
      with nowhere to arrive. Block your camera and their video never appeared, however healthy the
      connection was; start a screen share and theirs would suddenly turn up, because adding a video
      track of your own finally created the m-line their video had been waiting for. That is the
      symptom this fixes, and it is worth stating plainly: it was never about their camera.

      Declaring both up front makes the topology a constant rather than a consequence. Every
      connection has one audio and one video section from the moment it exists, so what either side
      happens to be sending is a question about tracks — answered by `replaceTrack` — instead of a
      question about SDP. That also means muting, unmuting, and swapping camera for screen never
      renegotiate at all.

      `sendrecv` with no track attached is exactly right: it says "I will receive this kind, and I
      may send it", which is the honest description of an agent whose camera is off.
    */
    for (const kind of ['audio', 'video'] as const) {
      try {
        slot.senders.set(kind, pc.addTransceiver(kind, { direction: 'sendrecv', streams: [outboundStream] }).sender);
      } catch (error) {
        fail(`preparing ${kind} for ${peerId}`, error);
      }
    }

    // Attach whatever is already being sent. A peer joining mid-call must receive our media without
    // waiting for us to toggle something — and this is now an attachment, not a topology change.
    for (const [kind, track] of outbound) {
      if (!track) continue;
      const sender = slot.senders.get(kind);
      if (!sender) continue;
      void sender.replaceTrack(track).catch((error) => fail(`sending ${kind} to ${peerId}`, error));
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
    // Held signalling belongs to the connection that is going away. Kept, it would be replayed into
    // a connection it was never part of the moment the peer reappeared on the roster.
    pending.delete(peerId);
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

    enqueue(from, slot, message);
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
    // Enqueued rather than started: replaying a queue with `void handle(...)` in a loop starts every
    // message at once on a connection that is also about to fire `negotiationneeded` from the
    // transceivers `connect` just added. That is the worst concurrency this file sees, and it is on
    // the first-contact path, which is where the reported flakiness lives.
    for (const message of queue) enqueue(peerId, slot, message);
  }

  /**
   * Put one message on this peer's queue.
   *
   * The chain is never rejected — `handle` reports its own failures — so nothing has to guard
   * against a poisoned tail silently swallowing every message behind it.
   */
  function enqueue(peerId: string, slot: PeerSlot, message: CallMessage): void {
    slot.work = slot.work.then(async () => {
      // The pair may have been torn down or rebuilt while this waited its turn, in which case this
      // message is about a connection that no longer exists.
      if (closed || slots.get(peerId) !== slot) return;
      await handle(peerId, slot, message);
    });
  }

  async function handle(peerId: string, slot: PeerSlot, message: CallMessage) {
    try {
      if (message.kind === 'reset') {
        // The peer is starting over. Rebuild to match, and say nothing back — two peers each
        // answering a reset with a reset is a loop with no floor.
        rebuild(peerId, { announce: false, rung: 'rebuild' });
        return;
      }

      if (message.kind === 'description') {
        const { description } = message;
        const collision = description.type === 'offer' && (slot.makingOffer || slot.pc.signalingState !== 'stable');

        // The impolite peer wins a collision by ignoring the other's offer; the polite peer yields,
        // and `setRemoteDescription` performs the implicit rollback that lets it accept.
        slot.ignoreOffer = !slot.polite && collision;
        if (slot.ignoreOffer) return;

        await slot.pc.setRemoteDescription(description);
        /*
          Candidates become applicable exactly here, and not before.

          Flushing after the description rather than discarding on arrival is what makes this mesh
          correct on an unordered transport. The old code let `addIceCandidate` throw and swallowed
          it, which reads as defensive and is actually lossy: on a channel that dispatches sends
          concurrently, a candidate overtaking its offer is the ordinary case, and every one of them
          was thrown away.
        */
        slot.remoteReady = true;
        await flushCandidates(peerId, slot);

        if (description.type === 'offer') {
          await slot.pc.setLocalDescription();
          if (slot.pc.localDescription) {
            slot.lastSent = { type: slot.pc.localDescription.type, sdp: slot.pc.localDescription.sdp };
            send(peerId, { kind: 'description', description: slot.pc.localDescription });
          }
        }
        return;
      }

      if (!slot.remoteReady) {
        if (slot.earlyCandidates.length < MAX_EARLY_CANDIDATES) slot.earlyCandidates.push(message.candidate);
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

  async function flushCandidates(peerId: string, slot: PeerSlot) {
    if (!slot.earlyCandidates.length) return;
    const held = slot.earlyCandidates.splice(0, slot.earlyCandidates.length);
    for (const candidate of held) {
      try {
        await slot.pc.addIceCandidate(candidate);
      } catch (error) {
        // One stale candidate must not stop the rest: these were buffered across a negotiation, so
        // some may belong to an ICE generation that has since been replaced.
        fail(`applying a held candidate from ${peerId}`, error);
      }
    }
  }

  /**
   * Throw this pair away and start again.
   *
   * The last rung, and the only one that cannot be done alone — hence `announce`. Attempts carry over
   * the new slot rather than resetting with it, or a pair that rebuilds every time would never reach
   * {@link MAX_RECOVERY_ATTEMPTS} and would retry forever.
   */
  function rebuild(peerId: string, opts: { announce: boolean; rung: RecoveryRung }) {
    const previous = slots.get(peerId);
    const attempts = (previous?.attempts ?? 0) + 1;
    disconnect(peerId);
    if (opts.announce) send(peerId, { kind: 'reset' });
    const slot = connect(peerId);
    slot.attempts = attempts;
    slot.lastAttempt = now();
    // The tiles hold a `MediaStream` per peer and this one is new, so the stage has to be told or it
    // renders the old, now-dead object.
    emitStreams();
    options.onPeerRecovery?.(peerId, { rung: opts.rung, attempts });
  }

  /**
   * One pair, one repair, on whichever rung its state calls for.
   *
   * The ladder, cheapest first, because each rung costs more than the one below and throws away more
   * of what is already working:
   *
   * 1. **ICE restart.** Keeps the peer connection, the transceivers and the DTLS session, and only
   *    re-gathers the transport. The right answer to `failed` and to a `disconnected` that did not
   *    come back — and the one the W3C's own perfect-negotiation example includes and this file did
   *    not.
   * 2. **Resend the description.** For a handshake that never completed while the connection is
   *    otherwise fine, which on this transport means a message was dropped. Nothing is wrong with
   *    either peer connection, so rebuilding them would be destroying working state to recover a lost
   *    packet.
   * 3. **Rebuild.** When there is no description to resend, or the rungs above have been tried. Costs
   *    the peer their tile for a moment, which is why it is last.
   */
  function repair(peerId: string, slot: PeerSlot) {
    const at = now();
    slot.lastAttempt = at;
    const attempts = slot.attempts + 1;
    slot.attempts = attempts;

    const state = slot.pc.connectionState;
    const canRestart = typeof slot.pc.restartIce === 'function';

    // A connection that got far enough to fail has a transport to re-gather; one that never got a
    // remote description has nothing for ICE to restart and needs the message resent instead.
    if ((state === 'failed' || state === 'disconnected') && canRestart && slot.remoteReady) {
      try {
        slot.pc.restartIce();
        options.onPeerRecovery?.(peerId, { rung: 'ice-restart', attempts });
        return;
      } catch (error) {
        fail(`restarting ice with ${peerId}`, error);
      }
    }

    /*
      Resend whatever this side said last, whichever half of the handshake it was.

      This used to require `!slot.remoteReady`, which covered only the offerer — and left the more
      common case to the expensive rung. When it is the *answer* that is dropped, the answerer has a
      remote description and believes it is done, while the offerer is still waiting: nothing is
      wrong with either peer connection, only with one message, and rebuilding both to recover it
      would be destroying working state. Bounded to one attempt per description by `lastResent`, so
      it escalates rather than repeating.
    */
    if (!slot.everConnected && slot.lastSent && slot.lastSent.sdp !== slot.lastResent) {
      slot.lastResent = slot.lastSent.sdp ?? null;
      send(peerId, { kind: 'description', description: slot.lastSent });
      options.onPeerRecovery?.(peerId, { rung: 'resend', attempts });
      return;
    }

    // Undo the increment `rebuild` is about to make again, so one repair counts once.
    slot.attempts = attempts - 1;
    rebuild(peerId, { announce: true, rung: 'rebuild' });
  }

  /** Whether this pair has been given long enough, and whether it is this side's turn to act. */
  function dueForRepair(slot: PeerSlot, at: number): boolean {
    const state = slot.pc.connectionState;
    if (state === 'connected') return false;
    if (slot.attempts >= MAX_RECOVERY_ATTEMPTS) return false;

    /*
      The impolite peer repairs first; the polite one waits twice as long.

      Not a fallback nobody reaches — it is the only cover for the asymmetric case, where the
      impolite side has no slot for this pair at all (its roster never listed the peer) and so has
      nothing to notice. In the symmetric case the impolite side has repaired long before this
      doubles out, and the polite side's own deadline never arrives.
    */
    const patience = slot.polite ? 2 : 1;

    if (state === 'disconnected' && slot.disconnectedAt) {
      return at - slot.disconnectedAt >= DISCONNECT_GRACE_MS * patience;
    }
    if (state === 'failed') {
      return at - Math.max(slot.lastAttempt, slot.since) >= RECOVERY_INTERVAL_MS * patience;
    }
    // 'new' | 'connecting' | 'closed' — a handshake that has not finished.
    const from = slot.lastAttempt || slot.since;
    const deadline = slot.lastAttempt ? RECOVERY_INTERVAL_MS : HANDSHAKE_GRACE_MS;
    return at - from >= deadline * patience;
  }

  function tick() {
    if (closed) return;
    /*
      Nothing is repaired while a send is unaccounted for.

      The distinction this whole mechanism turns on: an offer that has not been delivered and an
      offer that was lost look the same from here, and repairing the first is worse than useless —
      it adds sends to an executor that is already the reason nothing has moved. `outstanding` is the
      only thing that can tell them apart, and where the transport does not report, this is zero and
      the ladder runs as though sends were instant.
    */
    if (outstanding > 0) return;
    const at = now();
    // See REPAIR_SPACING_MS: a settled send calls `tick`, and a repair publishes, so without a floor
    // the two chase each other through every pair in the call.
    if (lastRepairAt && at - lastRepairAt < REPAIR_SPACING_MS) return;
    for (const [peerId, slot] of [...slots]) {
      if (!dueForRepair(slot, at)) continue;
      lastRepairAt = at;
      repair(peerId, slot);
      // One pair per sweep. A call whose network has just come back has every pair due at once, and
      // rebuilding all of them in one tick is a burst of offers onto the transport that made them
      // fail. The next sweep is two seconds away.
      break;
    }
  }

  const sweepMs = options.sweepMs ?? SWEEP_INTERVAL_MS;
  const sweep = sweepMs > 0 ? setInterval(tick, sweepMs) : null;

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
            // The transceiver created with the connection — see the note in `connect`. Every track
            // change is a `replaceTrack` on a section that already exists, so none of them
            // renegotiate: not muting, not unmuting, not swapping camera for screen.
            const sender = slot.senders.get(kind);
            if (sender) {
              await sender.replaceTrack(track);
            } else if (track) {
              // Only reachable if `addTransceiver` failed above. Adding a sender here *does* fire
              // `negotiationneeded`, which perfect negotiation resolves.
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

    reconnect(peerId) {
      if (closed || !slots.has(peerId)) return;
      // The budget is for *automatic* repair. Somebody pressing a button has decided to spend
      // another attempt, and refusing them because a timer already spent four would be the app
      // arguing with the person looking at the broken tile.
      const slot = slots.get(peerId);
      if (slot) slot.attempts = 0;
      rebuild(peerId, { announce: true, rung: 'rebuild' });
    },

    tick,

    async transportOf(peerId) {
      const slot = slots.get(peerId);
      if (!slot || typeof slot.pc.getStats !== 'function') return null;
      try {
        /*
          Two passes rather than one, because the answer is spread over two report types: the pair
          says which candidates won, and the candidate says what kind it is. Collected into plain
          arrays first — `RTCStatsReport` is a `ReadonlyMap<string, any>`, so nothing here is typed
          by the DOM anyway and reading it in one pass would depend on report order, which is not
          specified.
        */
        const reports: RtcStatReport[] = [];
        (await slot.pc.getStats()).forEach((report: RtcStatReport) => reports.push(report));

        const winner = reports.find((report) => report.type === 'candidate-pair' && report.state === 'succeeded');
        const localId = winner?.localCandidateId;
        if (!localId) return null;

        const local = reports.find((report) => report.type === 'local-candidate' && report.id === localId);
        return local?.candidateType ?? null;
      } catch (error) {
        fail(`reading transport stats for ${peerId}`, error);
        return null;
      }
    },

    close() {
      closed = true;
      if (sweep) clearInterval(sweep);
      unwatchPublish?.();
      unsubscribe();
      pending.clear();
      for (const peerId of [...slots.keys()]) disconnect(peerId);
      emitStreams();
    },
  };
}
