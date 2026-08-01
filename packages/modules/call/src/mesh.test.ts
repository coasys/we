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
import { createInMemoryEphemeralPort, InMemoryBus } from '@we/schema-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { createCallMesh } from './mesh';
import { CALL_PROTOCOL_VERSION, parseCallMessage, spaceCallId } from './protocol';

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
  closed = false;

  addTrack(track: MediaStreamTrack) {
    this.addedTracks.push(track);
    const sender = {
      track: track as MediaStreamTrack | null,
      async replaceTrack(next: MediaStreamTrack | null) {
        sender.track = next;
      },
    };
    this.senders.push(sender);
    // Adding a sender is what fires renegotiation in a real connection.
    queueMicrotask(() => this.onnegotiationneeded?.());
    return sender;
  }

  getSenders() {
    return this.senders;
  }

  async setLocalDescription(description?: RTCSessionDescriptionInit) {
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
  const callId = spaceCallId('neighbourhood://abc');

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

    // Nothing has been sent yet — no tracks, so nothing fired negotiationneeded.
    await alice.mesh.setOutboundTrack('audio', { kind: 'audio' } as MediaStreamTrack);
    await settle();
    await settle();

    // Alice offered; Bob answered; both ended stable rather than stuck mid-negotiation.
    expect(bob.connections[0].remoteDescription?.type).toBe('offer');
    expect(alice.connections[0].remoteDescription?.type).toBe('answer');
    expect(alice.connections[0].signalingState).toBe('stable');
    expect(bob.connections[0].signalingState).toBe('stable');
    expect(alice.errors).toEqual([]);
    expect(bob.errors).toEqual([]);
  });

  it('survives glare: both peers offering at once still converges', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    const bob = makeMesh(bus, dataset, 'did:bob', callId);

    alice.mesh.setRoster(['did:alice', 'did:bob']);
    bob.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    // Both add a track in the same tick — the collision perfect negotiation exists to resolve.
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
    const other = spaceCallId('neighbourhood://other');
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

    // One sender, swapped — this is what makes camera↔screen instant and renegotiation-free.
    expect(alice.connections[0].addedTracks).toEqual([camera]);
    expect(alice.connections[0].getSenders()).toHaveLength(1);
    expect(alice.connections[0].getSenders()[0].track).toBe(screen);
  });

  it('sends a peer joining mid-call the media already being sent', async () => {
    const alice = makeMesh(bus, dataset, 'did:alice', callId);
    alice.mesh.setRoster(['did:alice']);
    const track = { kind: 'audio' } as MediaStreamTrack;
    await alice.mesh.setOutboundTrack('audio', track);

    // Bob arrives after Alice's mic was already on.
    alice.mesh.setRoster(['did:alice', 'did:bob']);
    await settle();

    expect(alice.connections[0].addedTracks).toEqual([track]);
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
    expect(spaceCallId('neighbourhood://abc')).toBe(spaceCallId('neighbourhood://abc'));
    expect(spaceCallId('neighbourhood://abc')).not.toBe(spaceCallId('neighbourhood://def'));
  });
});
