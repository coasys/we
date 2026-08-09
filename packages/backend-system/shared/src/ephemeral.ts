/**
 * The ephemeral seam — WE's renderer ↔ backend contract for **transient** agent-to-agent state.
 *
 * Sibling to `dataSource.ts`. Where that port carries durable, queryable records, this one carries
 * state that is lossy, last-write-wins, and gone on reload: live presence, WebRTC signalling, cursors,
 * typing indicators, work claims.
 *
 * **Why it is not part of `QueryIR`.** The IR assumes durable entities declared in a model manifest,
 * each with a globally-stable `id`. Ephemeral state has none of those: no manifest entity to name, no
 * id that survives a restart, no persistence to query. Routing it through `$query` would either
 * corrupt the IR's guarantees or require inventing a phantom entity type. The test, applied every time
 * something is proposed for this port:
 *
 * > **If it must still be there after a refresh, it is not ephemeral.**
 *
 * Durable messaging (chat, DMs) therefore belongs to `DataSource`, never here — see
 * notes/we/August-2026/presence-port.md.
 *
 * **Shape.** A scope is bound to one dataset (a space, a DM neighbourhood); within a scope, each
 * protocol takes a named `channel(tag)`. Both are load-bearing: a call happens *in* a space, and a
 * third-party feature module needs a namespace it cannot collide with. The payload is deliberately
 * opaque — presence, RTC, and cursors all ride the same pipe, so the transport must not know about any
 * of them.
 *
 * The tag maps cleanly onto every real backend: a Socket.io event name, a Supabase Realtime channel
 * topic, a Matrix to-device message type, a gossipsub topic, a Yjs awareness field.
 */
import type { DatasetHandle } from './dataSource';

/**
 * What a backend can do natively. Declared by the adapter, consumed by {@link planEphemeral} so a
 * consumer that needs more than the backend offers fails loudly rather than silently misbehaving.
 */
export interface EphemeralCapabilities {
  /**
   * Send to everyone in the dataset. Always true — a transport that cannot fan out cannot carry
   * presence, and is better modelled as absent (see {@link EphemeralPort} returning null).
   */
  fanout: true;

  /**
   * Send to one named peer.
   *
   * Tri-state rather than boolean **on purpose**, because `emulated` and `native` differ in a way that
   * matters for security, not just efficiency:
   *
   * - `native` — the transport routes to that peer alone.
   * - `emulated` — addressed but *broadcast*; every peer receives the payload and is trusted to
   *   discard it. The adapter filters on receipt. Acceptable for SDP/ICE (not secret in most threat
   *   models); **never** acceptable for anything confidential.
   * - `none` — no addressing at all (e.g. Yjs awareness is fan-out only).
   *
   * Were this a boolean, a consumer would eventually build a private feature on `unicast: true` and it
   * would silently not be private. Confidentiality comes from membrane or encryption, never from
   * addressing.
   */
  unicast: 'native' | 'emulated' | 'none';

  /**
   * - `best-effort` — fire and forget, no confirmation of anything.
   * - `send-acked` — the send is confirmed, delivery is not (AD4M: `Promise<boolean>`).
   * - `at-least-once` — delivery is confirmed, possibly more than once.
   */
  reliability: 'best-effort' | 'send-acked' | 'at-least-once';

  /**
   * True when peers must gossip their own liveness on a timer because the transport cannot report
   * disconnects. P1/P2 backends (AD4M) set this; a P3 backend that knows who is connected sets false
   * and implements a presence source directly instead of using `createHeartbeatPresence`.
   */
  heartbeatRequired: boolean;

  /**
   * Whether the `from` in {@link EphemeralChannel.onMessage} is asserted by the **transport** or by
   * the payload.
   *
   * AD4M supplies `link.author`, so identity is authenticated: a peer cannot impersonate another in
   * the presence map, and a work claim can be trusted enough to act on. A naive relay or unsigned
   * pubsub carries the sender id in the payload, where it is forgeable — a host could implement this
   * port entirely correctly and still ship spoofable presence and hijackable leases. Anything
   * security-relevant (leases, moderation, call admission) must check this rather than assume it.
   */
  authenticatedSender: boolean;
}

/** A protocol's namespaced slice of a dataset's ephemeral traffic. */
/**
 * What became of a published message, as far as the transport can tell.
 *
 * The limit is stated in the name of {@link EphemeralCapabilities.reliability}: `send-acked` means
 * the backend confirms it *took* the message, never that a peer received it. So `ok: false` is
 * actionable — nothing left, retrying is worth it — while `ok: true` says only that the failure
 * modes past this point are somebody else's.
 *
 * That distinction is the whole value. Without it every repair is a blind timer, which is what
 * presence had: five separate schedules, none able to tell a stalled executor from a lossy network,
 * all guessing. One of those failures is worth reacting to immediately and the other is not.
 */
export interface PublishResult {
  /** The backend accepted the message. Delivery remains unconfirmed — see above. */
  ok: boolean;
  /** How long the attempt took, which is how a stalled executor is recognised. */
  ms: number;
  /** Why it failed, for logs. Absent when `ok`. */
  error?: string;
  /** A newer message replaced this one before it was sent — see {@link ChannelOptions.coalesce}. */
  superseded?: boolean;
}

export interface EphemeralChannel {
  /**
   * Fire-and-forget. Passing `to.agentId` requires `unicast !== 'none'`; under `'emulated'` the
   * payload still reaches every peer, so treat it as addressing, not privacy.
   *
   * Returns nothing on purpose. Most callers genuinely do not want to await a broadcast, and a
   * promise here would make every one of them choose between awaiting and an unhandled rejection.
   * Consumers that care about outcomes observe them with {@link onPublishResult} instead.
   */
  publish(payload: unknown, to?: { agentId?: string }): void;

  /**
   * Subscribe to this channel. `from` is the sender's id — see
   * {@link EphemeralCapabilities.authenticatedSender} before trusting it. Returns an unsubscribe.
   */
  onMessage(cb: (from: string, payload: unknown) => void): () => void;

  /**
   * Observe what happens to published messages. Returns an unsubscribe.
   *
   * Optional, because a transport that cannot tell should not pretend: absent means "no idea", which
   * a consumer must treat as neither success nor failure. Present, it is what lets a consumer
   * respond to a *real* failure — an executor that is stalled or gone — instead of waiting out a
   * heartbeat interval on the theory that something might have gone wrong.
   *
   * Results are not correlated with individual messages, and do not need to be: this channel's
   * traffic is last-write-wins, so "the most recent publish failed" is the only question worth
   * asking, and the answer to it is "send the current state again".
   */
  onPublishResult?(cb: (result: PublishResult) => void): () => void;
}

export interface ChannelOptions {
  /**
   * Hold a publish while a previous one is still in flight, and send the latest when it lands —
   * rather than letting sends pile up.
   *
   * Correct only for **idempotent last-write-wins** traffic — presence, cursors, typing — where a
   * superseded message is genuinely worthless because the newer one it is waiting behind carries
   * everything it did. It is wrong for a handshake: an RTC offer is not superseded by the next one.
   *
   * Earns its place from a real failure. On a struggling AD4M executor `sendBroadcast` hangs until a
   * 30s RPC timeout while presence heartbeats every 5s, so six stuck calls accumulate at steady
   * state, each adding load to the backend that is already the problem. Coalescing turns that into
   * one in-flight send and at most one waiting.
   *
   * **Hold, not drop** — and an implementation that drops is wrong even though the difference looks
   * academic. "The next message carries the same state" is true of a heartbeat and false of the
   * state *change* that the heartbeat has not started repeating yet: joining a call, leaving one,
   * answering a peer's hello. Dropping those costs a full heartbeat interval of the other side not
   * knowing, which is precisely the latency this option looks like it could not possibly cause.
   */
  coalesce?: boolean;
}

/** Ephemeral traffic for one dataset. Obtain channels from it; dispose to detach from the backend. */
export interface EphemeralScope {
  capabilities: EphemeralCapabilities;
  /**
   * Namespaced sub-channel. Repeated calls with the same tag return the same channel; options are
   * read on first creation.
   */
  channel(tag: string, options?: ChannelOptions): EphemeralChannel;
  dispose(): void;
}

/**
 * The port a host injects. Returns `null` for a dataset with no transport — a personal (unshared)
 * space has no neighbourhood, so there is nobody to signal. Consumers must degrade rather than throw.
 */
export type EphemeralPort = (dataset: DatasetHandle) => EphemeralScope | null;

/** What a consumer (presence, a call module, a cursor overlay) needs from the transport. */
export interface EphemeralRequirements {
  /** Human name of the consumer, used in the failure message. */
  consumer: string;
  /** Minimum addressing this consumer needs. `'emulated'` accepts emulated or native. */
  unicast?: 'native' | 'emulated';
  /** True when this consumer carries confidential payloads and so cannot accept emulated addressing. */
  confidential?: boolean;
  /** True when this consumer acts on the sender's identity (leases, admission control). */
  requiresAuthenticatedSender?: boolean;
}

export interface EphemeralGap {
  /** Greppable feature name, e.g. "unicast", "unicast:confidential", "authenticatedSender". */
  feature: string;
  note: string;
}

export interface EphemeralPlan {
  /** False if any requirement is unmet — the consumer must not be mounted. */
  runnable: boolean;
  gaps: EphemeralGap[];
}

const UNICAST_RANK = { none: 0, emulated: 1, native: 2 } as const;

/**
 * Classify a consumer's requirements against a backend's capabilities.
 *
 * Mirrors `planQuery` in `queryCapabilities.ts`: the point is to **fail loudly at registration**
 * rather than mount a feature that silently cannot work. A Yjs-backed host, for instance, has
 * `unicast: 'none'` — a call module asking for `'emulated'` gets a clear refusal instead of a
 * handshake that never completes.
 */
export function planEphemeral(req: EphemeralRequirements, cap: EphemeralCapabilities): EphemeralPlan {
  const gaps: EphemeralGap[] = [];

  if (req.unicast && UNICAST_RANK[cap.unicast] < UNICAST_RANK[req.unicast]) {
    gaps.push({
      feature: 'unicast',
      note: `${req.consumer} needs unicast "${req.unicast}" but the backend offers "${cap.unicast}"`,
    });
  }

  // Emulated addressing is broadcast-plus-filter, so it provides no confidentiality at all.
  if (req.confidential && cap.unicast !== 'native') {
    gaps.push({
      feature: 'unicast:confidential',
      note:
        `${req.consumer} carries confidential payloads, which requires native unicast; ` +
        `the backend offers "${cap.unicast}" (addressing is not privacy)`,
    });
  }

  if (req.requiresAuthenticatedSender && !cap.authenticatedSender) {
    gaps.push({
      feature: 'authenticatedSender',
      note: `${req.consumer} acts on sender identity, but this backend's sender id is self-asserted and forgeable`,
    });
  }

  return { runnable: gaps.length === 0, gaps };
}

// ── Reference implementation ─────────────────────────────────────────────────

export const inMemoryEphemeralCapabilities: EphemeralCapabilities = {
  fanout: true,
  // A shared in-process bus can address a single peer exactly, and knows who is connected, so it is
  // deliberately the *opposite* profile to AD4M's on every axis that matters. That is the point: it
  // exercises the branches a single backend would leave dead.
  unicast: 'native',
  reliability: 'at-least-once',
  heartbeatRequired: false,
  authenticatedSender: true,
};

/**
 * An in-process {@link EphemeralPort}, for tests and as the reference a new backend copies.
 *
 * The sibling of `executeQueryIR`'s in-memory dataset on the query side. It exists for a reason
 * beyond convenience: **an abstraction with one implementation is a hypothesis.** Until a second
 * backend runs against this contract, "backend-neutral" is an argument rather than a fact — and the
 * usual way that argument fails is that the seam turns out to sit in the wrong place. This is the
 * cheapest possible refutation attempt.
 *
 * Each agent gets its own port over a shared `bus`; messages are delivered to every *other* agent on
 * that bus, matching real broadcast semantics (a sender never receives its own).
 */
export function createInMemoryEphemeralPort(bus: InMemoryBus, agentId: string): EphemeralPort {
  return (dataset) => {
    const key = bus.keyFor(dataset);
    const channels = new Map<string, EphemeralChannel>();

    const scope: EphemeralScope = {
      capabilities: inMemoryEphemeralCapabilities,

      channel(tag) {
        const existing = channels.get(tag);
        if (existing) return existing;

        const watchers = new Set<(result: PublishResult) => void>();

        const channel: EphemeralChannel = {
          publish(payload, to) {
            bus.deliver(key, tag, agentId, payload, to?.agentId);
            // Reported even though it cannot fail, and that is the point of a reference
            // implementation: a consumer that only ever sees the AD4M adapter's mix of outcomes
            // could quietly come to depend on failures arriving, and the branch where everything
            // succeeds would be the untested one.
            watchers.forEach((cb) => cb({ ok: true, ms: 0 }));
          },
          onPublishResult(cb) {
            watchers.add(cb);
            return () => watchers.delete(cb);
          },
          onMessage(cb) {
            return bus.subscribe(key, tag, agentId, cb);
          },
        };
        channels.set(tag, channel);
        return channel;
      },

      dispose() {
        bus.unsubscribeAll(key, agentId);
        channels.clear();
      },
    };

    return scope;
  };
}

type Subscriber = { agentId: string; cb: (from: string, payload: unknown) => void };

/** The shared medium every in-memory port publishes into. One bus stands in for one network. */
export class InMemoryBus {
  /** dataset key → tag → subscribers */
  #routes = new Map<string, Map<string, Subscriber[]>>();
  #keys = new WeakMap<object, string>();
  #next = 0;

  /** Datasets are opaque handles, so identity is by reference — the same rule the renderer follows. */
  keyFor(dataset: unknown): string {
    if (typeof dataset !== 'object' || dataset === null) return String(dataset);
    const existing = this.#keys.get(dataset);
    if (existing) return existing;
    const key = `ds-${this.#next++}`;
    this.#keys.set(dataset, key);
    return key;
  }

  subscribe(key: string, tag: string, agentId: string, cb: Subscriber['cb']): () => void {
    const tags = this.#routes.get(key) ?? new Map<string, Subscriber[]>();
    this.#routes.set(key, tags);
    const subs = tags.get(tag) ?? [];
    tags.set(tag, subs);
    const entry = { agentId, cb };
    subs.push(entry);
    return () => {
      const i = subs.indexOf(entry);
      if (i !== -1) subs.splice(i, 1);
    };
  }

  deliver(key: string, tag: string, from: string, payload: unknown, to?: string): void {
    for (const sub of this.#routes.get(key)?.get(tag) ?? []) {
      // Never loop back to the sender; honour addressing when a recipient is named.
      if (sub.agentId === from) continue;
      if (to && sub.agentId !== to) continue;
      sub.cb(from, payload);
    }
  }

  unsubscribeAll(key: string, agentId: string): void {
    for (const subs of this.#routes.get(key)?.values() ?? []) {
      for (let i = subs.length - 1; i >= 0; i--) if (subs[i].agentId === agentId) subs.splice(i, 1);
    }
  }
}
