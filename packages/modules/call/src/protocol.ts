/**
 * The call module's wire protocol — the WebRTC handshake, and nothing else.
 *
 * ## What is deliberately absent: membership
 *
 * There is no `join`, no `leave`, and no roster message. Who is in a call is already expressed by
 * presence, as an activity:
 *
 * ```ts
 * { type: 'call'; id: string; anchor?: Focus; media?: MediaSettings }
 * ```
 *
 * The mesh reconciles against that roster: a peer that appears gets a connection, a peer that
 * disappears has its connection torn down. This is not a shortcut — it is the only version that
 * survives contact with reality. A message-based roster breaks on exactly the cases calls hit most:
 * a closed laptop, a killed tab, a network partition. Each leaves a participant who never sent
 * `leave`, and the call shows a frozen tile forever. Presence expires on TTL, so a dead peer leaves
 * on its own, and its activities go with it.
 *
 * The consequence worth internalising: **this channel is not authoritative about anything.** Drop
 * every message on it and the call fails to connect but the roster stays correct. That is the right
 * way round.
 *
 * ## Versioning
 *
 * `v` is checked on receipt and mismatches are dropped, as in presence. A peer running a newer
 * protocol should fail to connect visibly rather than half-negotiate into a broken session.
 */

export const CALL_PROTOCOL_VERSION = 1;

/**
 * A signalling message.
 *
 * `call` scopes every message to one call id, because a space can host several at once (the
 * space-wide call, plus a call anchored to a particular node). Without it a renegotiation in one
 * call would be applied to the peer connection of another.
 *
 * SDP travels as the plain `{ type, sdp }` init object rather than a class instance — it has to
 * survive JSON serialisation across the transport, and `RTCSessionDescription` does not.
 */
export type CallMessage = CallEnvelope & CallBody;

/** What every message carries regardless of kind. */
export interface CallEnvelope {
  v: number;
  call: string;
}

/**
 * The kind-specific half, split out so it can be named on its own.
 *
 * `Omit<CallMessage, 'v' | 'call'>` would not do: `Omit` on a union collapses it to the properties
 * they share, losing the discriminant and with it the narrowing that makes handling each kind safe.
 */
export type CallBody =
  { kind: 'description'; description: RTCSessionDescriptionInit } | { kind: 'ice'; candidate: RTCIceCandidateInit };

/**
 * Narrow an untrusted payload off the transport.
 *
 * Everything arriving here was published by another agent, so it is shape-checked before use. The
 * sender id is supplied by the transport rather than the payload — a self-reported `from` would be
 * trivially spoofable, and `EphemeralCapabilities.authenticatedSender` is what says whether even the
 * transport's version can be trusted.
 */
export function parseCallMessage(payload: unknown): CallMessage | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const msg = payload as Partial<CallMessage>;

  if (msg.v !== CALL_PROTOCOL_VERSION) return null;
  if (typeof msg.call !== 'string' || !msg.call) return null;

  if (msg.kind === 'description') {
    const description = (msg as { description?: unknown }).description;
    if (typeof description !== 'object' || description === null) return null;
    const { type, sdp } = description as RTCSessionDescriptionInit;
    if (type !== 'offer' && type !== 'answer' && type !== 'pranswer' && type !== 'rollback') return null;
    if (sdp !== undefined && typeof sdp !== 'string') return null;
    return { v: msg.v, call: msg.call, kind: 'description', description: { type, sdp } };
  }

  if (msg.kind === 'ice') {
    const candidate = (msg as { candidate?: unknown }).candidate;
    if (typeof candidate !== 'object' || candidate === null) return null;
    return { v: msg.v, call: msg.call, kind: 'ice', candidate: candidate as RTCIceCandidateInit };
  }

  return null;
}

/**
 * The id of the space-wide call in a dataset.
 *
 * Derived rather than generated, so every peer computes the same id without having to agree on one
 * first — the chicken-and-egg a generated id would create (you cannot signal to agree on the channel
 * you would signal over).
 */
export function spaceCallId(datasetUri: string): string {
  return `space:${datasetUri}`;
}

/**
 * The id of a call anchored to a particular node — "the call on this post".
 *
 * Same derivation, same reason. Anchoring is what lets several calls coexist in one space, which
 * `callRosters()` already groups for free because presence models activities as a list rather than a
 * single value.
 */
export function anchoredCallId(datasetUri: string, nodeId: string): string {
  return `node:${datasetUri}:${nodeId}`;
}
