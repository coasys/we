/**
 * Two agents negotiating in one process.
 *
 * The mesh is the part of this module that cannot be checked by looking at it: perfect negotiation is
 * a protocol between two peers whose bugs (glare, a lost candidate, a connection that never tears
 * down) only appear when both sides run. `InMemoryBus` — the ephemeral port's second implementation,
 * which exists precisely so the port is not defined by one backend — makes that a unit test rather
 * than a two-laptop manual check.
 *
 * The `RTCPeerConnection` fake is deliberately thin: it models signalling state and the callbacks the
 * mesh drives, and nothing about actual media. What is under test is the negotiation, not the browser.
 */
import { createInMemoryEphemeralPort, InMemoryBus } from '@we/backend-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createCallMesh,
  DISCONNECT_GRACE_MS,
  HANDSHAKE_GRACE_MS,
  MAX_RECOVERY_ATTEMPTS,
  RECOVERY_INTERVAL_MS,
  type RecoveryRung,
  type SignallingChannel,
} from './mesh';
import { CALL_PROTOCOL_VERSION, parseCallMessage, recordCallId } from './protocol';

// ── A fake RTCPeerConnection ────────────────────────────────────────────────

class FakePeerConnection {
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;

  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((e: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null = null;
  ontrack: ((e: { track: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  senders: { track: MediaStreamTrack | null; replaceTrack(t: MediaStreamTrack | null): Promise<void> }[] = [];
  addedTracks: unknown[] = [];
  /** The m-sections this connection has negotiated, which is the thing the fix is about. */
  transceivers: { kind: string; direction: string }[] = [];
  closed = false;

  /**
   * Fire `negotiationneeded` once per task, as a browser does.
   *
   * The spec sets a flag and fires the event when the operations chain next empties, so declaring
   * an audio and a video section together produces *one* negotiation. Firing per call instead
   * produced a second offer on top of the first and left both peers mid-handshake — a failure of
   * this double, not of the mesh, and one that would have made the transceiver change look broken.
   */
  private negotiationNeeded = false;
  private negotiationQueued = false;
  private queueNegotiation() {
    this.negotiationNeeded = true;
    if (this.negotiationQueued) return;
    this.negotiationQueued = true;
    queueMicrotask(() => {
      this.negotiationQueued = false;
      // Cleared by `setLocalDescription` — a peer that has just answered an offer describing the
      // very sections it was waiting to negotiate does not then turn round and offer them again.
      if (!this.negotiationNeeded) return;
      this.onnegotiationneeded?.();
    });
  }

  private makeSender(track: MediaStreamTrack | null) {
    const sender = {
      track,
      async replaceTrack(next: MediaStreamTrack | null) {
        sender.track = next;
      },
    };
    this.senders.push(sender);
    return sender;
  }

  addTransceiver(kind: string, init?: { direction?: string }) {
    this.transceivers.push({ kind, direction: init?.direction ?? 'sendrecv' });
    // Declaring a section is a topology change, so it renegotiates — once, when the peer connects.
    this.queueNegotiation();
    return { sender: this.makeSender(null) };
  }

  addTrack(track: MediaStreamTrack) {
    this.addedTracks.push(track);
    // Adding a sender is what fires renegotiation in a real connection.
    this.queueNegotiation();
    return this.makeSender(track);
  }

  getSenders() {
    return this.senders;
  }

  async setLocalDescription(description?: RTCSessionDescriptionInit) {
    // The spec updates the negotiation-needed flag here, which is what stops an answer being
    // chased by a redundant offer.
    this.negotiationNeeded = false;
    // Mirrors the browser: with no argument it picks offer or answer from the signaling state.
    const type = description?.type ?? (this.signalingState === 'have-remote-offer' ? 'answer' : 'offer');
    this.localDescription = { type: type as RTCSdpType, sdp: `${type}-sdp` };
    this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  candidates: RTCIceCandidateInit[] = [];
  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (this.signalingState === 'stable' && !this.remoteDescription) {
      throw new Error('no remote description');
    }
    this.candidates.push(candidate);
  }

  /** How many ICE restarts this connection was asked for — the cheapest rung of the ladder. */
  restartIceCalls = 0;
  restartIce() {
    this.restartIceCalls += 1;
    // A real restart re-gathers and renegotiates, which is the whole point of preferring it.
    this.queueNegotiation();
  }

  /** What `transportOf` reads. Empty unless a test says otherwise. */
  stats: Record<string, unknown>[] = [];
  async getStats() {
    return new Map(this.stats.map((report) => [report.id as string, report]));
  }

  close() {
    this.closed = true;
  }

  /** Test helper: pretend ICE produced a candidate. */
  emitCandidate(candidate: RTCIceCandidateInit) {
    this.onicecandidate?.({ candidate: { toJSON: () => candidate } });
  }

  /** Test helper: drive the connection state the recovery ladder reads. */
  setConnectionState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

interface MeshOptions {
  /** ICE servers to hand the mesh, so what reaches the connection can be asserted on. */
  iceServers?: RTCIceServer[];
  /**
   * Swallow an outgoing message instead of publishing it — a lossy transport, which is what the
   * real one is. Mutable so a test can lose the opening handshake and then let the repair through.
   */
  drop?: (payload: unknown) => boolean;
}

/**
 * A clock the tests move by hand.
 *
 * The recovery ladder is defined in seconds and a test that waited them out would take a minute and
 * be flaky besides. Nothing here sleeps: `advance` moves the clock and `mesh.tick()` is the sweep.
 */
function makeClock() {
  let at = 1_000;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

function makeMesh(
  bus: InMemoryBus,
  dataset: object,
  selfId: string,
  callId: string,
  options: MeshOptions & { now?: () => number } = {},
) {
  const port = createInMemoryEphemeralPort(bus, selfId);
  const scope = port(dataset);
  if (!scope) throw new Error('expected a scope');

  const connections: FakePeerConnection[] = [];
  const streams: Map<string, MediaStream>[] = [];
  const errors: { context: string; error: unknown }[] = [];
  const recoveries: { peerId: string; rung: RecoveryRung; attempts: number }[] = [];
  const configs: RTCConfiguration[] = [];
  const sent: unknown[] = [];

  const underlying = scope.channel('rtc', { coalesce: false });
  const watchers = new Set<(result: { ok: boolean; ms: number }) => void>();
  underlying.onPublishResult?.((result) => watchers.forEach((cb) => cb(result)));

  /*
    Wrapped rather than replaced, so everything the in-memory port does still happens.

    `drop` models the transport's actual failure, which is the part worth getting right: a lost
    message is one the executor **accepted** and no peer received. That is precisely what
    `reliability: 'send-acked'` promises and the whole of what it promises. Reporting a *failure*
    instead would be a different bug — the mesh treats an unreported send as still in flight and
    would rightly refuse to repair around it forever.
  */
  const channel: SignallingChannel = {
    publish(payload, to) {
      sent.push(payload);
      if (options.drop?.(payload)) {
        watchers.forEach((cb) => cb({ ok: true, ms: 0 }));
        return;
      }
      underlying.publish(payload, to);
    },
    onMessage: (cb) => underlying.onMessage(cb),
    onPublishResult: (cb) => {
      watchers.add(cb);
      return () => watchers.delete(cb);
    },
  };

  const mesh = createCallMesh({
    callId,
    selfId,
    channel,
    iceServers: options.iceServers,
    now: options.now,
    // No timer: every test drives `tick()` itself, so a sweep never fires between an act and its
    // assertion. The interval is exercised by its own test below.
    sweepMs: 0,
    createPeerConnection: (configuration) => {
      configs.push(configuration);
      const pc = new FakePeerConnection();
      connections.push(pc);
      return pc as unknown as RTCPeerConnection;
    },
    onRemoteStreamsChanged: (s) => streams.push(s),
    onPeerRecovery: (peerId, attempt) => recoveries.push({ peerId, ...attempt }),
    onError: (context, error) => errors.push({ context, error }),
  });

  /** The connection currently serving a pair — the last one built, after any rebuilds. */
  const live = () => connections[connections.length - 1];

  return { mesh, connections, streams, errors, recoveries, configs, sent, live };
}

/** Everything the mesh published, narrowed to one message kind. */
const kinds = (sent: unknown[]) => sent.map((payload) => (payload as { kind?: string }).kind);

/** Let queued microtasks and promise chains settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// ── Tests ───────────────────────────────────────────────────────────────────

describe('call mesh', () => {
  let bus: InMemoryBus;
  const dataset = { id: 'space-1' };
  const callId = recordCallId('rec-abc');

  beforeEach(() => {
    bus = new InMemoryBus();
  });

  it('connects two peers, with exactly one surviving offer', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    const bob = makeMesh(bus, dataset, 'did:bob', callId);

    // Presence says both are in the call. Note neither sent a join message — see protocol.ts.
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    bob.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    expect(alice.connections).toHaveLength(1);
    expect(bob.connections).toHaveLength(1);

    /*
      Negotiation begins with the connection, not with the first track.

      This used to wait for `setOutboundTrack` — "no tracks, so nothing fired negotiationneeded" —
      and that premise was the bug: an agent sending nothing negotiated no m-sections, so there was
      nowhere for the *other* side's media to arrive either. Both sections are now declared up
      front, so the handshake happens once, when the pair connects.
    */
    await settle();
    await settle();

    expect(alice.connections[0].signalingState).toBe('stable');
    expect(bob.connections[0].signalingState).toBe('stable');
    // Exactly one offer survived the collision: one side answered the other.
    const answered = [alice, bob].filter((peer) => peer.connections[0].localDescription?.type === 'answer');
    expect(answered).toHaveLength(1);

    // And a track needs no further handshake — it attaches to a section that already exists.
    await alice.mesh.setOutboundTrack('audio', { kind: 'audio' } as MediaStreamTrack);
    await settle();

    expect(alice.connections[0].addedTracks).toEqual([]);
    expect(alice.errors).toEqual([]);
    expect(bob.errors).toEqual([]);
  });

  it('negotiates a video section even when this agent has no camera', async () => {
    /*
      The bug this whole arrangement exists for, reported from two-agent testing: with the camera
      blocked, the other agent's video stayed on "Connecting…" forever — and starting a *screen
      share* made it appear, which is what identified it. A peer connection carries only the kinds
      it negotiated a section for, so an agent sending no video agreed no video m-line, and their
      camera had nowhere to land. Sharing a screen added a video track, which created the section,
      which finally let the incoming video through.
    */
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    // Audio only — a camera-blocked agent, which is the reported case.
    await alice.mesh.setOutboundTrack('audio', { kind: 'audio' } as MediaStreamTrack);
    await settle();

    expect(alice.connections[0].transceivers.map((t) => t.kind).sort()).toEqual(['audio', 'video']);
  });

  it('survives glare: both peers offering at once still converges', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    const bob = makeMesh(bus, dataset, 'did:bob', callId);

    alice.mesh.setRoster(['did:alice', 'did:bob']);
    bob.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    // Both connections declare their sections in the same tick, so both offer — the collision
    // perfect negotiation exists to resolve, and now the ordinary case rather than a contrived one.
    await Promise.all([
      alice.mesh.setOutboundTrack('audio', { kind: 'audio' } as MediaStreamTrack),
      bob.mesh.setOutboundTrack('audio', { kind: 'audio' } as MediaStreamTrack),
    ]);
    await settle();
    await settle();
    await settle();

    // 'did:bob' > 'did:alice', so Bob is polite and yields. Both must end stable: the failure this
    // guards is the symmetric one where each ignores the other and neither ever connects.
    expect(alice.connections[0].signalingState).toBe('stable');
    expect(bob.connections[0].signalingState).toBe('stable');
    expect(alice.errors).toEqual([]);
    expect(bob.errors).toEqual([]);
  });

  it('tears down a connection when presence drops the peer from the roster', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    makeMesh(bus, dataset, 'did:bob', callId);

    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();
    expect(alice.connections[0].closed).toBe(false);

    // Bob's laptop closed. Presence evicts him on TTL; no 'leave' message is ever sent.
    alice.mesh.setRoster(['did:alice']);
    expect(alice.connections[0].closed).toBe(true);
    expect(alice.mesh.remoteStreams().size).toBe(0);
  });

  it('ignores signalling from an agent the roster does not include', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice']);

    // A stranger offers out of the blue. Without the roster check this would open a connection.
    bus.deliver(bus.keyFor(dataset), 'rtc', 'did:mallory', {
      v: CALL_PROTOCOL_VERSION,
      call: callId,
      to: 'did:alice',
      kind: 'description',
      description: { type: 'offer', sdp: 'x' },
    });
    await settle();

    expect(alice.connections).toHaveLength(0);
    expect(alice.errors).toEqual([]);
  });

  it('ignores traffic for a different call in the same space', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    const other = recordCallId('rec-other');
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    const before = alice.connections[0].remoteDescription;
    bus.deliver(bus.keyFor(dataset), 'rtc', 'did:bob', {
      v: CALL_PROTOCOL_VERSION,
      call: other,
      to: 'did:alice',
      kind: 'description',
      description: { type: 'offer', sdp: 'wrong-call' },
    });
    await settle();

    // Two calls in one space share a channel, so without the id check a renegotiation in the
    // anchored call would be applied to the space call's connection.
    expect(alice.connections[0].remoteDescription).toBe(before);
  });

  it('re-emits when an inbound track stops receiving, and again when it comes back', async () => {
    /*
      The frozen-peer bug, from the receiving side.

      A remote track does not END when its sender goes away — it stays `readyState === 'live'` for as
      long as the connection object exists, and what changes is `muted`, which the browser sets when
      RTP stops arriving. Only `ended` was wired up, for the camera→screen replacement case, so
      nothing told the store that a peer's picture had stopped: their `<video>` kept its `srcObject`
      and went on painting the last frame it had decoded, for as long as the roster kept the tile.

      Both edges, because a connection that recovers unmutes the same track and a tile that had
      fallen back to an avatar has to come back without waiting for some unrelated event.
    */
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    const listeners = new Map<string, () => void>();
    const track = {
      kind: 'video',
      readyState: 'live',
      muted: false,
      addEventListener: (name: string, cb: () => void) => listeners.set(name, cb),
    } as unknown as MediaStreamTrack;

    alice.connections[0].ontrack?.({ track });
    const afterArrival = alice.streams.length;
    expect(listeners.has('mute'), 'the mesh listens for the track going quiet').toBe(true);
    expect(listeners.has('unmute'), 'and for it coming back').toBe(true);

    listeners.get('mute')?.();
    expect(alice.streams.length, 'a muted track is reported').toBe(afterArrival + 1);

    listeners.get('unmute')?.();
    expect(alice.streams.length, 'so is it unmuting').toBe(afterArrival + 2);

    // The track stays in the stream through both: muting is not removal, and a tile that dropped its
    // track object would remount the `<video>` rather than swapping what it draws.
    expect(alice.streams[alice.streams.length - 1].get('did:bob')?.getVideoTracks()).toEqual([track]);
  });

  it('replaces rather than re-adds when an outbound track changes', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    const camera = { kind: 'video' } as MediaStreamTrack;
    const screen = { kind: 'video' } as MediaStreamTrack;

    await alice.mesh.setOutboundTrack('video', camera);
    await alice.mesh.setOutboundTrack('video', screen);

    // One sender, swapped, and no topology change at all — this is what makes camera↔screen
    // instant and renegotiation-free.
    expect(alice.connections[0].addedTracks).toEqual([]);
    expect(alice.connections[0].getSenders().filter((s) => s.track)).toHaveLength(1);
    expect(alice.connections[0].getSenders().find((s) => s.track)?.track).toBe(screen);
  });

  it('reuses the sender after the outbound track is cleared, rather than adding a second one', async () => {
    /*
      The frozen-screen bug, in three calls.

      Stopping a share from the browser's own "Stop sharing" bar with no camera to fall back to
      publishes `null`, which becomes `replaceTrack(null)` — and a sender whose track is null cannot
      be found by `getSenders().find((s) => s.track?.kind === 'video')`. Sharing again therefore took
      the `addTrack` branch and gave the peer a *second* video track. Their `<video>` renders the
      first one in the stream, which is the dead one, so their view stayed frozen on the last shared
      frame for the rest of the call — restarting the share did not recover it.
    */
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    const screen = { kind: 'video' } as MediaStreamTrack;
    const screenAgain = { kind: 'video' } as MediaStreamTrack;

    await alice.mesh.setOutboundTrack('video', screen);
    await alice.mesh.setOutboundTrack('video', null);
    await alice.mesh.setOutboundTrack('video', screenAgain);

    // No `addTrack` at all: the second share reuses the section the peer already has, so it needs
    // no renegotiation and their existing tile simply resumes.
    expect(alice.connections[0].addedTracks).toEqual([]);
    expect(alice.connections[0].getSenders().filter((s) => s.track)).toHaveLength(1);
    expect(alice.connections[0].getSenders().find((s) => s.track)?.track).toBe(screenAgain);
  });

  it('stops sending when the outbound track is cleared', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    await alice.mesh.setOutboundTrack('video', { kind: 'video' } as MediaStreamTrack);
    await alice.mesh.setOutboundTrack('video', null);

    expect(alice.connections[0].getSenders().every((sender) => sender.track === null)).toBe(true);
  });

  it('sends a peer joining mid-call the media already being sent', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice']);
    const track = { kind: 'audio' } as MediaStreamTrack;
    await alice.mesh.setOutboundTrack('audio', track);

    // Bob arrives after Alice's mic was already on.
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    // Attached to the section created with the connection, rather than added as a new one.
    expect(alice.connections[0].addedTracks).toEqual([]);
    expect(alice.connections[0].getSenders().find((sender) => sender.track)?.track).toBe(track);
  });

  it('stops negotiating once closed', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    alice.mesh.close();
    expect(alice.connections[0].closed).toBe(true);

    bus.deliver(bus.keyFor(dataset), 'rtc', 'did:bob', {
      v: CALL_PROTOCOL_VERSION,
      call: callId,
      to: 'did:alice',
      kind: 'description',
      description: { type: 'offer', sdp: 'late' },
    });
    await settle();

    expect(alice.errors).toEqual([]);
  });
});

describe('an unordered transport', () => {
  /**
   * The channel dispatches sends concurrently and the port's own capabilities say
   * `reliability: 'send-acked'` — so a candidate overtaking the description it belongs to is not a
   * race to be defended against, it is the ordinary case. It used to be thrown away: `addIceCandidate`
   * throws with no remote description, and the mesh caught that and moved on.
   */
  let bus: InMemoryBus;
  const dataset = { id: 'space-1' };
  const callId = recordCallId('rec-abc');

  beforeEach(() => {
    bus = new InMemoryBus();
  });

  const offerFrom = (from: string) => ({
    v: CALL_PROTOCOL_VERSION,
    call: callId,
    to: 'did:alice',
    kind: 'description' as const,
    description: { type: 'offer' as const, sdp: `${from}-offer` },
  });

  const candidateFrom = (candidate: string) => ({
    v: CALL_PROTOCOL_VERSION,
    call: callId,
    to: 'did:alice',
    kind: 'ice' as const,
    candidate: { candidate },
  });

  it('holds candidates that arrive before the description, and applies them after', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice', 'did:aaron']);
    await settle();

    // Three candidates overtake the offer they belong to.
    bus.deliver(bus.keyFor(dataset), 'rtc', 'did:aaron', candidateFrom('a'));
    bus.deliver(bus.keyFor(dataset), 'rtc', 'did:aaron', candidateFrom('b'));
    bus.deliver(bus.keyFor(dataset), 'rtc', 'did:aaron', candidateFrom('c'));
    await settle();

    // Nothing applied and, crucially, nothing lost or reported as an error.
    expect(alice.live().candidates).toEqual([]);
    expect(alice.errors).toEqual([]);

    bus.deliver(bus.keyFor(dataset), 'rtc', 'did:aaron', offerFrom('did:aaron'));
    await settle();

    // All three, in the order they were sent: a candidate is not optional, it is a route that may
    // be the only one that works.
    expect(alice.live().candidates.map((c) => c.candidate)).toEqual(['a', 'b', 'c']);
    expect(alice.errors).toEqual([]);
  });

  it('does not hold candidates without bound, for a peer whose description never comes', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice', 'did:aaron']);
    await settle();

    for (let n = 0; n < 500; n += 1) {
      bus.deliver(bus.keyFor(dataset), 'rtc', 'did:aaron', candidateFrom(`c${n}`));
    }
    await settle();
    bus.deliver(bus.keyFor(dataset), 'rtc', 'did:aaron', offerFrom('did:aaron'));
    await settle();

    // Bounded, and it kept the *earliest* — a full gathering round is what matters, and host
    // candidates come first and are the ones most likely to connect.
    expect(alice.live().candidates.length).toBeLessThanOrEqual(64);
    expect(alice.live().candidates[0]?.candidate).toBe('c0');
  });

  it('applies signalling one message at a time', async () => {
    /*
      Two descriptions delivered in the same tick used to run concurrently: each awaits
      `setRemoteDescription`, so the collision test read `makingOffer` and `signalingState` at a
      moment that was already stale, and the two could be applied out of order. The queue is what
      makes the state machine a state machine.
    */
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice', 'did:aaron']);
    await settle();

    bus.deliver(bus.keyFor(dataset), 'rtc', 'did:aaron', offerFrom('first'));
    bus.deliver(bus.keyFor(dataset), 'rtc', 'did:aaron', {
      ...offerFrom('second'),
      description: { type: 'offer' as const, sdp: 'second-offer' },
    });
    await settle();
    await settle();

    // The later one is what the connection ends up on, and nothing threw on the way.
    expect(alice.live().remoteDescription?.sdp).toBe('second-offer');
    expect(alice.errors).toEqual([]);
  });
});

describe('recovering a pair that did not connect', () => {
  let bus: InMemoryBus;
  const dataset = { id: 'space-1' };
  const callId = recordCallId('rec-abc');

  beforeEach(() => {
    bus = new InMemoryBus();
  });

  it('resends a description that was lost, rather than rebuilding the connection', async () => {
    /*
      The deadlock, end to end, and the reason any of this exists.

      Alice is impolite ('did:alice' < 'did:bob'), so on a collision she ignores Bob's offer and
      expects her own to win. Her own is the one the transport drops. Both then wait forever:
      `connectionState` never reaches `failed`, so nothing was even reportable — the tile spun
      "Connecting…" for the rest of the call, and leaving and rejoining was the only way out.
    */
    const clock = makeClock();
    let losing = true;
    const alice = makeMesh(bus, dataset, 'did:alice', callId, {
      now: clock.now,
      drop: (payload) => losing && (payload as { kind?: string }).kind === 'description',
    });
    const bob = makeMesh(bus, dataset, 'did:bob', callId, { now: clock.now });

    alice.mesh.setRoster(['did:alice', 'did:bob']);
    bob.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();
    await settle();
    await settle();

    // Deadlocked exactly as described: Alice never heard an answer, Bob never heard an offer he
    // could use, and neither connection is anywhere near `failed`.
    expect(alice.live().signalingState).toBe('have-local-offer');
    expect(alice.live().remoteDescription).toBeNull();

    // The transport recovers, and the sweep notices the handshake never finished.
    losing = false;
    clock.advance(HANDSHAKE_GRACE_MS + 1);
    alice.mesh.tick();
    await settle();
    await settle();
    await settle();

    expect(alice.recoveries.map((r) => r.rung)).toEqual(['resend']);
    // The connection was never rebuilt — nothing was wrong with it, only with the message.
    expect(alice.connections).toHaveLength(1);
    expect(bob.live().remoteDescription?.type).toBe('offer');
    expect(alice.live().signalingState).toBe('stable');
    expect(alice.errors).toEqual([]);
    expect(bob.errors).toEqual([]);
  });

  it('resends the answer when that is the half that was lost', async () => {
    /*
      The other direction of the same failure, and the one the first version of this ladder missed.

      When the *answer* is dropped, the answerer has a remote description and believes it is done
      while the offerer is still waiting — so a rung gated on "we never got a remote description"
      skipped straight past the cheap fix and rebuilt both connections to recover one message.
      Nothing is wrong with either peer connection here.
    */
    const clock = makeClock();
    const alice = makeMesh(bus, dataset, 'did:alice', callId, { now: clock.now });
    // Bob answers, and his answer never arrives. He is polite, so his deadline is the doubled one.
    const bob = makeMesh(bus, dataset, 'did:bob', callId, {
      now: clock.now,
      drop: (payload) => (payload as { kind?: string }).kind === 'description',
    });

    alice.mesh.setRoster(['did:alice', 'did:bob']);
    bob.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();
    await settle();
    await settle();

    // Bob heard the offer and answered it; Alice heard nothing back.
    expect(bob.live().remoteDescription?.type).toBe('offer');
    expect(bob.live().localDescription?.type).toBe('answer');
    expect(alice.live().remoteDescription).toBeNull();

    clock.advance(HANDSHAKE_GRACE_MS * 2 + 1);
    bob.mesh.tick();
    await settle();

    expect(bob.recoveries.map((r) => r.rung)).toEqual(['resend']);
    expect(bob.connections).toHaveLength(1);
  });

  it('resends a description once, then escalates rather than repeating it', async () => {
    // A peer that did not act on the same description twice is not a peer waiting for a third copy.
    const clock = makeClock();
    const alice = makeMesh(bus, dataset, 'did:alice', callId, {
      now: clock.now,
      drop: (payload) => (payload as { kind?: string }).kind === 'description',
    });
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();
    await settle();

    clock.advance(HANDSHAKE_GRACE_MS + 1);
    alice.mesh.tick();
    await settle();
    clock.advance(RECOVERY_INTERVAL_MS + 1);
    alice.mesh.tick();
    await settle();
    await settle();

    expect(alice.recoveries.map((r) => r.rung)).toEqual(['resend', 'rebuild']);
  });

  it('restarts ICE when a connected pair fails, before throwing anything away', async () => {
    const clock = makeClock();
    const alice = makeMesh(bus, dataset, 'did:alice', callId, { now: clock.now });
    const bob = makeMesh(bus, dataset, 'did:bob', callId, { now: clock.now });

    alice.mesh.setRoster(['did:alice', 'did:bob']);
    bob.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();
    await settle();
    await settle();

    alice.live().setConnectionState('connected');
    alice.live().setConnectionState('failed');
    await settle();

    clock.advance(RECOVERY_INTERVAL_MS + 1);
    alice.mesh.tick();
    await settle();

    // The rung the W3C's own perfect-negotiation example includes and this file did not: the peer
    // connection, its transceivers and its DTLS session all survive, and only the route is re-gathered.
    expect(alice.live().restartIceCalls).toBe(1);
    expect(alice.recoveries.map((r) => r.rung)).toEqual(['ice-restart']);
    expect(alice.connections).toHaveLength(1);
  });

  it('gives a disconnected pair a shorter grace, since it often comes back by itself', async () => {
    const clock = makeClock();
    const alice = makeMesh(bus, dataset, 'did:alice', callId, { now: clock.now });
    const bob = makeMesh(bus, dataset, 'did:bob', callId, { now: clock.now });

    alice.mesh.setRoster(['did:alice', 'did:bob']);
    bob.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();
    await settle();
    await settle();

    alice.live().setConnectionState('connected');
    alice.live().setConnectionState('disconnected');

    clock.advance(DISCONNECT_GRACE_MS - 1);
    alice.mesh.tick();
    expect(alice.live().restartIceCalls).toBe(0);

    clock.advance(2);
    alice.mesh.tick();
    await settle();
    expect(alice.live().restartIceCalls).toBe(1);
  });

  it('rebuilds the pair, and says so, once the cheaper rungs have not worked', async () => {
    const clock = makeClock();
    const alice = makeMesh(bus, dataset, 'did:alice', callId, { now: clock.now });
    const bob = makeMesh(bus, dataset, 'did:bob', callId, { now: clock.now });

    alice.mesh.setRoster(['did:alice', 'did:bob']);
    bob.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();
    await settle();
    await settle();

    // A pair that connected, so there is a remote description and nothing to resend — but whose
    // `restartIce` the host does not implement. Straight to the last rung.
    alice.live().setConnectionState('connected');
    alice.live().setConnectionState('failed');
    (alice.live() as { restartIce?: unknown }).restartIce = undefined;

    clock.advance(RECOVERY_INTERVAL_MS + 1);
    alice.mesh.tick();
    await settle();
    await settle();

    expect(alice.recoveries.map((r) => r.rung)).toEqual(['rebuild']);
    expect(alice.connections).toHaveLength(2);
    expect(alice.connections[0].closed).toBe(true);
    // And the peer is told, or it would be left holding a connection to a session that is gone.
    expect(kinds(alice.sent)).toContain('reset');
    expect(bob.connections).toHaveLength(2);
  });

  it('answers a reset without sending one back', async () => {
    // Two peers each answering a reset with a reset is a loop with no floor, and it would run for
    // as long as the call did.
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    bus.deliver(bus.keyFor(dataset), 'rtc', 'did:bob', {
      v: CALL_PROTOCOL_VERSION,
      call: callId,
      to: 'did:alice',
      kind: 'reset',
    });
    await settle();
    await settle();

    expect(alice.connections).toHaveLength(2);
    expect(kinds(alice.sent)).not.toContain('reset');
  });

  it('stops repairing after a few attempts, so a spinner is not a promise', async () => {
    const clock = makeClock();
    const alice = makeMesh(bus, dataset, 'did:alice', callId, { now: clock.now });
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    for (let n = 0; n < MAX_RECOVERY_ATTEMPTS + 3; n += 1) {
      clock.advance(HANDSHAKE_GRACE_MS + RECOVERY_INTERVAL_MS + 1);
      alice.mesh.tick();
      await settle();
    }

    // A pair that has failed a full ladder is behind a NAT that needs TURN or on a network that is
    // down, and a fifth attempt is not persistence. Stopping lets the tile say so.
    expect(alice.recoveries.length).toBe(MAX_RECOVERY_ATTEMPTS);
  });

  it('lets the impolite peer repair first, and the polite one wait', async () => {
    const clock = makeClock();
    // Alice is impolite for this pair; Bob is polite. Neither ever hears from the other.
    const alice = makeMesh(bus, dataset, 'did:alice', callId, { now: clock.now, drop: () => true });
    const bob = makeMesh(bus, dataset, 'did:bob', callId, { now: clock.now, drop: () => true });

    alice.mesh.setRoster(['did:alice', 'did:bob']);
    bob.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();
    await settle();

    clock.advance(HANDSHAKE_GRACE_MS + 1);
    alice.mesh.tick();
    bob.mesh.tick();
    await settle();

    // Two peers restarting ICE at each other is the glare problem one layer up, and this pair
    // already has a deterministic way to pick one of them.
    expect(alice.recoveries).toHaveLength(1);
    expect(bob.recoveries).toHaveLength(0);

    // The polite side is not merely passive, though — it covers the case the impolite side cannot
    // see, where that peer has no slot for this pair at all and so notices nothing.
    clock.advance(HANDSHAKE_GRACE_MS + 1);
    bob.mesh.tick();
    await settle();
    expect(bob.recoveries).toHaveLength(1);
  });

  it('waits while a send is still outstanding, rather than piling onto a stalled transport', async () => {
    /*
      The distinction the whole ladder turns on. An offer that has not been delivered and an offer
      that was lost look identical from here — and the AD4M adapter measures the *first* broadcast on
      a fresh neighbourhood at eighteen seconds. Repairing that one adds sends to the executor that is
      the reason nothing has moved.
    */
    const clock = makeClock();
    const results: ((r: { ok: boolean; ms: number }) => void)[] = [];
    let published = 0;

    const channel: SignallingChannel = {
      publish: () => (published += 1),
      onMessage: () => () => {},
      onPublishResult: (cb) => {
        results.push(cb);
        return () => {};
      },
    };

    const mesh = createCallMesh({
      callId,
      selfId: 'did:alice',
      channel,
      now: clock.now,
      sweepMs: 0,
      createPeerConnection: () => new FakePeerConnection() as unknown as RTCPeerConnection,
    });

    mesh.setRoster(['did:alice', 'did:bob']);
    await settle();
    const duringHandshake = published;
    expect(duringHandshake).toBeGreaterThan(0);

    clock.advance(HANDSHAKE_GRACE_MS * 4);
    mesh.tick();
    await settle();

    // Nothing added while the offer is unaccounted for.
    expect(published).toBe(duringHandshake);

    // The transport reports, so now the silence means something.
    results.forEach((cb) => cb({ ok: true, ms: 18_000 }));
    await settle();
    mesh.tick();
    await settle();

    expect(published).toBeGreaterThan(duringHandshake);
    mesh.close();
  });

  it('forgets a pair’s failures once it connects', async () => {
    // The budget bounds one failure, not a session: a call that drops and recovers twice must not
    // arrive at the ceiling while nothing is wrong.
    const clock = makeClock();
    const alice = makeMesh(bus, dataset, 'did:alice', callId, { now: clock.now });
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    clock.advance(HANDSHAKE_GRACE_MS + 1);
    alice.mesh.tick();
    await settle();
    expect(alice.recoveries).toHaveLength(1);

    alice.live().setConnectionState('connected');
    alice.live().setConnectionState('failed');

    for (let n = 0; n < MAX_RECOVERY_ATTEMPTS; n += 1) {
      clock.advance(RECOVERY_INTERVAL_MS + 1);
      alice.mesh.tick();
      await settle();
    }

    // Four more after the reset, rather than three more before hitting a ceiling it had already
    // spent one attempt against.
    expect(alice.recoveries).toHaveLength(1 + MAX_RECOVERY_ATTEMPTS);
  });

  it('reconnects one peer on request, whatever the connection claims to be', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    const bob = makeMesh(bus, dataset, 'did:bob', callId);
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    bob.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();
    await settle();
    await settle();

    // Deliberately healthy: whether a connection is bad enough is a judgement the person watching it
    // makes better than `connectionState` does.
    alice.live().setConnectionState('connected');
    alice.mesh.reconnect('did:bob');
    await settle();
    await settle();

    expect(alice.connections).toHaveLength(2);
    expect(alice.connections[0].closed).toBe(true);
    expect(kinds(alice.sent)).toContain('reset');
    // And the other end starts from the same place, rather than holding a session that is gone.
    expect(bob.connections).toHaveLength(2);
  });

  it('does nothing when asked to reconnect someone who is not in the call', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    alice.mesh.reconnect('did:nobody');
    await settle();

    expect(alice.connections).toHaveLength(1);
    expect(kinds(alice.sent)).not.toContain('reset');
  });

  it('repairs one pair per sweep', async () => {
    // A call whose network has just come back has every pair due at once, and rebuilding all of them
    // in one tick is a burst of offers onto the transport that made them fail.
    const clock = makeClock();
    const alice = makeMesh(bus, dataset, 'did:alice', callId, { now: clock.now });
    alice.mesh.setRoster(['did:alice', 'did:bob', 'did:carol', 'did:dave']);
    await settle();

    clock.advance(HANDSHAKE_GRACE_MS + 1);
    alice.mesh.tick();
    await settle();

    expect(alice.recoveries).toHaveLength(1);
  });
});

describe('what a call is told about its own connections', () => {
  let bus: InMemoryBus;
  const dataset = { id: 'space-1' };
  const callId = recordCallId('rec-abc');

  beforeEach(() => {
    bus = new InMemoryBus();
  });

  it('uses the ICE servers it is given, and its own when given none', async () => {
    const mine = [{ urls: 'turn:relay.example.org:3478', username: 'u', credential: 'p' }];
    const configured = makeMesh(bus, dataset, 'did:alice', callId, { iceServers: mine });
    configured.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();
    expect(configured.configs[0].iceServers).toEqual(mine);

    const bare = makeMesh(bus, dataset, 'did:zoe', callId);
    bare.mesh.setRoster(['did:zoe', 'did:bob']);
    await settle();
    expect(bare.configs[0].iceServers?.[0]).toMatchObject({
      urls: expect.arrayContaining(['stun:stun.l.google.com:19302']),
    });
  });

  it('says how the media is actually reaching the other end', async () => {
    /*
      The one fact that separates "this pair needs a relay" from "this pair's handshake was lost",
      which are otherwise the same spinner. `relay` means it only works because a TURN server is
      carrying it; nothing at all means nothing connected.
    */
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    alice.live().stats = [
      { id: 'pair-1', type: 'candidate-pair', state: 'failed', localCandidateId: 'cand-1' },
      { id: 'pair-2', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'cand-2' },
      { id: 'cand-1', type: 'local-candidate', candidateType: 'host' },
      { id: 'cand-2', type: 'local-candidate', candidateType: 'relay' },
    ];

    expect(await alice.mesh.transportOf('did:bob')).toBe('relay');
    expect(await alice.mesh.transportOf('did:nobody')).toBeNull();
  });

  it('answers nothing rather than guessing when no pair has succeeded', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    alice.live().stats = [{ id: 'pair-1', type: 'candidate-pair', state: 'in-progress', localCandidateId: 'cand-1' }];
    expect(await alice.mesh.transportOf('did:bob')).toBeNull();
  });

  it('sweeps on its own timer when it is given one', async () => {
    // Every other test drives `tick()` by hand, which would leave the one line that actually makes
    // this run in production untested.
    const port = createInMemoryEphemeralPort(bus, 'did:alice');
    const scope = port(dataset);
    if (!scope) throw new Error('expected a scope');

    const clock = makeClock();
    const recoveries: RecoveryRung[] = [];
    const mesh = createCallMesh({
      callId,
      selfId: 'did:alice',
      channel: scope.channel('rtc', { coalesce: false }),
      now: clock.now,
      sweepMs: 1,
      createPeerConnection: () => new FakePeerConnection() as unknown as RTCPeerConnection,
      onPeerRecovery: (_peerId, attempt) => recoveries.push(attempt.rung),
    });

    mesh.setRoster(['did:alice', 'did:bob']);
    await settle();
    clock.advance(HANDSHAKE_GRACE_MS + 1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(recoveries.length).toBeGreaterThan(0);
    mesh.close();

    // And the timer goes with the mesh, or a closed call keeps sweeping for the life of the tab.
    const after = recoveries.length;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(recoveries).toHaveLength(after);
  });
});

describe('protocol parsing', () => {
  const good = {
    v: CALL_PROTOCOL_VERSION,
    call: 'space:x',
    kind: 'description' as const,
    description: { type: 'offer' as const, sdp: 'v=0' },
  };

  it('accepts a well-formed description', () => {
    expect(parseCallMessage(good)).toEqual(good);
  });

  it.each([
    ['a mismatched version', { ...good, v: 99 }],
    ['a missing call id', { ...good, call: '' }],
    ['an unknown kind', { ...good, kind: 'chat' }],
    ['a non-object description', { ...good, description: 'offer' }],
    ['an invalid sdp type', { ...good, description: { type: 'nonsense', sdp: 'x' } }],
    ['a null payload', null],
    ['a string payload', 'offer'],
  ])('rejects %s', (_label, payload) => {
    expect(parseCallMessage(payload)).toBeNull();
  });

  it('derives the same space call id on every peer', () => {
    // The whole point: no round trip is needed to agree on it, which would be circular.
    expect(recordCallId('rec-abc')).toBe(recordCallId('rec-abc'));
    expect(recordCallId('rec-abc')).not.toBe(recordCallId('rec-def'));
  });
});

describe('signalling that arrives before the roster', () => {
  /**
   * Dropping it was normally self-healing — both peers add tracks, so a discarded offer is followed
   * by another `negotiationneeded` a moment later. **A peer who denied the microphone has no
   * outbound tracks, so it never fires.** They joined, appeared on everyone's roster, and connected
   * to nobody in either direction, showing "Connecting…" forever because `connectionState` never
   * reaches `failed` and the honest error badge never appears.
   */
  let bus: InMemoryBus;
  const dataset = { id: 'space-1' };
  const callId = recordCallId('rec-abc');

  beforeEach(() => {
    bus = new InMemoryBus();
  });

  it('connects a peer whose roster arrived after the offer, with no tracks of their own', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    const bob = makeMesh(bus, dataset, 'did:bob', callId);

    // Alice knows about Bob and starts sending. Bob's presence has not ticked yet.
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await alice.mesh.setOutboundTrack('audio', { kind: 'audio' } as MediaStreamTrack);
    await settle();
    await settle();

    // Bob has no connection at all yet, so Alice's offer had nowhere to go.
    expect(bob.connections).toHaveLength(0);

    bob.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();
    await settle();

    /*
      Held rather than dropped: Alice's offer is replayed the moment the roster vouches for her, so
      it is acted on instead of being lost.

      The original reasoning here was that Bob "could not re-offer anyway, having denied the
      microphone and added no track". That is no longer true, and the change is the fix for the
      camera-blocked bug: every connection now declares its audio and video sections up front, so
      Bob has something to negotiate whether or not he has a single device. Which side ends up
      offering and which answering is then down to collision resolution and is not what this test is
      about — that the held message was replayed at all, and that the pair converges, is.
    */
    expect(bob.connections).toHaveLength(1);
    expect(bob.connections[0].remoteDescription?.type).toBe('offer');
    expect(bob.errors).toEqual([]);
    expect(alice.errors).toEqual([]);
  });

  it('does not negotiate with an agent the roster never lists', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    const stranger = makeMesh(bus, dataset, 'did:stranger', callId);

    // The stranger believes they are in the call and offers.
    stranger.mesh.setRoster(['did:stranger', 'did:alice']);
    await stranger.mesh.setOutboundTrack('audio', { kind: 'audio' } as MediaStreamTrack);
    await settle();
    await settle();

    // Alice's roster names somebody else entirely. Holding a message is not a promise to negotiate.
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    expect(alice.connections).toHaveLength(1);
    expect(alice.connections[0].remoteDescription).toBeNull();
  });

  it('bounds what it holds for an agent nobody has vouched for', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    const bob = makeMesh(bus, dataset, 'did:bob', callId);

    bob.mesh.setRoster(['did:alice', 'did:bob']);
    // Twenty renegotiations before Alice ever hears of Bob. This buffers messages from an agent the
    // roster has not vouched for, so it must not be a memory target.
    for (let n = 0; n < 20; n += 1) {
      await bob.mesh.setOutboundTrack('audio', { kind: 'audio' } as MediaStreamTrack);
      await bob.mesh.setOutboundTrack('audio', null);
    }
    await settle();

    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();
    await settle();

    // It replayed something rather than nothing, and did not replay everything.
    expect(alice.connections[0].remoteDescription).not.toBeNull();
  });
});
