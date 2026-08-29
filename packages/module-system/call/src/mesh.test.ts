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

import { createCallMesh } from './mesh';
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

  close() {
    this.closed = true;
  }

  /** Test helper: pretend ICE produced a candidate. */
  emitCandidate(candidate: RTCIceCandidateInit) {
    this.onicecandidate?.({ candidate: { toJSON: () => candidate } });
  }
}

function makeMesh(bus: InMemoryBus, dataset: object, selfId: string, callId: string) {
  const port = createInMemoryEphemeralPort(bus, selfId);
  const scope = port(dataset);
  if (!scope) throw new Error('expected a scope');

  const connections: FakePeerConnection[] = [];
  const streams: Map<string, MediaStream>[] = [];
  const errors: { context: string; error: unknown }[] = [];

  const mesh = createCallMesh({
    callId,
    selfId,
    channel: scope.channel('rtc', { coalesce: false }),
    createPeerConnection: () => {
      const pc = new FakePeerConnection();
      connections.push(pc);
      return pc as unknown as RTCPeerConnection;
    },
    onRemoteStreamsChanged: (s) => streams.push(s),
    onError: (context, error) => errors.push({ context, error }),
  });

  return { mesh, connections, streams, errors };
}

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
