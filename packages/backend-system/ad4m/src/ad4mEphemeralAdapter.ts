/**
 * The AD4M ephemeral adapter — the {@link EphemeralPort} presence and (later) the call module ride.
 *
 * Sibling to `ad4mAdapter.ts`, and deliberately the same size and shape: a capability profile plus the
 * minimum translation between the neutral port and this backend's API. No timers, no liveness
 * derivation, no profile fetching — those are neutral and live in `@we/schema-shared`'s `presence.ts`.
 * If this file grows past ~120 lines, something backend-agnostic has leaked into it.
 *
 * ## What AD4M gives us
 *
 * `NeighbourhoodProxy.sendBroadcastU({ links })` — an *unsigned* broadcast that is never written to
 * the perspective, which is exactly right for state that must not persist. Inbound arrives through
 * `addSignalHandler`, and crucially the sender arrives as `link.author`, supplied by the executor
 * rather than by the payload. That is why `authenticatedSender` is true: a peer cannot write into
 * another agent's presence slot, which in turn is what makes a work-claim lease trustworthy.
 *
 * ## Why unicast is emulated
 *
 * AD4M *does* expose real directed send (`sendSignal` / `sendSignalU`), but it is known-broken, so
 * this adapter addresses over broadcast: the recipient DID goes in the link's `target` and receivers
 * drop anything not addressed to them. That is `unicast: 'emulated'` — **addressing, not privacy**:
 * every peer still receives the payload. Consumers that need confidentiality are refused by
 * `planEphemeral` rather than silently exposed.
 *
 * This mirrors the drill-down predicate workaround in `ad4mAdapter.ts`: a backend defect degrades to
 * an adapter workaround, not a WE outage. When `sendSignalU` is fixed, flip `unicast` to `'native'`,
 * route `publish(..., { agentId })` through it, and delete `TARGET_ALL` plus the receive-side filter —
 * grep `unicast:emulated`. No consumer changes.
 */
import type { PerspectiveExpression, PerspectiveProxy } from '@coasys/ad4m';
import type { EphemeralCapabilities, EphemeralChannel, EphemeralPort, EphemeralScope } from '@we/backend-shared';
import { trace } from '@we/backend-shared';

/** Namespaces this traffic so it can never be confused with another protocol's links. */
const PREDICATE_PREFIX = 'we://ephemeral/';

/** `target` value meaning "everyone" — see `unicast:emulated` above. */
const TARGET_ALL = '*';

/**
 * A send this slow is a defect somewhere, and it must not take a trace to notice.
 *
 * Measured: the *first* `sendBroadcastU` after joining a neighbourhood has been seen to take
 * eighteen seconds, on both peers, unblocking within a few hundred milliseconds of each other —
 * which is the signature of the two conductors finally discovering one another rather than of a
 * per-call cost. Later sends on the same channel take tens of milliseconds.
 *
 * Nothing above this layer can do anything about it, but everything above it looks broken while it
 * happens: presence is silent, so peers appear absent and calls appear empty. Saying so once, out
 * loud, is the difference between a known backend cost and a bug hunt.
 */
const SLOW_SEND_MS = 5_000;

export const ad4mEphemeralCapabilities: EphemeralCapabilities = {
  fanout: true,
  // Real unicast exists upstream but `sendSignalU` is broken; we address over broadcast instead.
  unicast: 'emulated',
  // `sendBroadcastU` resolves `Promise<boolean>` — the send is confirmed, delivery is not.
  reliability: 'send-acked',
  // No connect/disconnect feed, so peers must gossip their own liveness.
  heartbeatRequired: true,
  // `link.author` is supplied by the executor, not the payload.
  authenticatedSender: true,
};

/**
 * Build the port. `getMyDid` is used only to drop our own echo — AD4M's `sendBroadcastU` takes a
 * `loopback` flag that defaults to false, but a self-addressed signal can still arrive through other
 * paths, and a presence source that ingests its own state as a peer double-counts.
 */
export function createAd4mEphemeralPort(getMyDid: () => string | undefined): EphemeralPort {
  /**
   * One scope per dataset, shared by every consumer.
   *
   * Without this, each caller builds its own scope and registers its own `addSignalHandler`, so
   * presence and the call module on the same space would mean two executor subscriptions, every
   * message parsed twice, and one consumer's `dispose()` silently not affecting the other. Sharing
   * is refcounted: the underlying handler is removed only when the last holder disposes.
   */
  const scopes = new Map<PerspectiveProxy, { scope: EphemeralScope; refs: number; teardown: () => void }>();

  return (dataset) => {
    const perspective = dataset as PerspectiveProxy | null;
    // A personal (unshared) space has no neighbourhood, so there is nobody to signal. Null rather
    // than a no-op scope, so consumers degrade deliberately instead of silently publishing into a void.
    if (!perspective?.sharedUrl) return null;

    const neighbourhood = perspective.getNeighbourhoodProxy?.();
    if (!neighbourhood) return null;

    const shared = scopes.get(perspective);
    if (shared) {
      shared.refs += 1;
      return handleFor(perspective, shared);
    }

    const channels = new Map<string, EphemeralChannel>();
    const subscribers = new Map<string, Set<(from: string, payload: unknown) => void>>();

    // One AD4M handler for the whole scope, fanned out to channels by predicate suffix. Registering
    // per-channel would mean N executor subscriptions for what is one stream.
    const handler = (signal: PerspectiveExpression) => {
      const link = signal?.data?.links?.[0];
      if (!link?.author) return;

      const { source, predicate, target } = link.data ?? {};
      if (typeof predicate !== 'string' || !predicate.startsWith(PREDICATE_PREFIX)) return;

      const tag = predicate.slice(PREDICATE_PREFIX.length);

      // unicast:emulated — the payload reached us either way; honour the addressing.
      const myDid = getMyDid();
      if (target && target !== TARGET_ALL && target !== myDid) {
        trace('ephemeral', 'recv:drop', { tag, from: link.author, reason: 'addressed-elsewhere' });
        return;
      }
      if (link.author === myDid) return;

      const listeners = subscribers.get(tag);
      if (!listeners?.size) {
        // Worth seeing: the signal arrived and nothing was listening for it. Usually a scope torn
        // down mid-flight, but it is also what a mis-tagged channel looks like.
        trace('ephemeral', 'recv:drop', { tag, from: link.author, reason: 'no-listener' });
        return;
      }

      trace('ephemeral', 'recv', { tag, from: link.author });

      let payload: unknown;
      try {
        payload = JSON.parse(source as string);
      } catch {
        // A peer on a newer/older protocol, or a corrupted signal. Dropping one message is correct —
        // presence is idempotent, so the next heartbeat repairs the gap.
        return;
      }

      listeners.forEach((cb) => cb(link.author as string, payload));
    };

    /**
     * Registration is a round trip to the executor, and nothing may be published before it lands.
     *
     * `addSignalHandler` returns a promise for a reason: it sets up a subscription on the executor,
     * not a local callback. Fire-and-forget was a race with the presence handshake, and the losing
     * side was always the same one — a joiner broadcasts `hello` the instant its scope exists, every
     * peer answers within milliseconds, and any answer arriving before this resolves is delivered to
     * nobody. The joiner then sees an empty space until each peer's next heartbeat, which is exactly
     * the "wait a while for the members to appear" that made this worth finding.
     *
     * The rejection is swallowed rather than propagated: a failed registration means this agent
     * cannot hear, which is bad, but refusing to publish as well would also stop it being heard.
     */
    const subscribeStartedAt = Date.now();
    const listening = neighbourhood
      .addSignalHandler(handler)
      .then(() => trace('ephemeral', 'subscribed', { ms: Date.now() - subscribeStartedAt }))
      .catch((error: unknown) => {
        trace('ephemeral', 'subscribe:fail', { ms: Date.now() - subscribeStartedAt, error: String(error) });
        console.warn('ephemeral: signal handler registration failed — inbound traffic will be missed', error);
      });

    const scope: EphemeralScope = {
      capabilities: ad4mEphemeralCapabilities,

      channel(tag, options) {
        const existing = channels.get(tag);
        if (existing) return existing;

        const predicate = PREDICATE_PREFIX + tag;
        let inFlight = false;
        let failures = 0;
        /** The one message waiting for the in-flight send to finish. See `publish` below. */
        let queued: { payload: unknown; to?: { agentId?: string } } | null = null;

        async function dispatch(payload: unknown, to?: { agentId?: string }): Promise<void> {
          // Set before the first await, or a burst all pass the coalesce check below and the
          // backpressure this exists for never engages.
          inFlight = true;
          const startedAt = Date.now();
          try {
            await listening;
            await neighbourhood.sendBroadcastU({
              links: [{ source: JSON.stringify(payload), predicate, target: to?.agentId ?? TARGET_ALL }],
            });
            // The number that settles "is it us or the transport": a send that acks in 20ms and a
            // peer that never sees it is the network's problem, not ours.
            const elapsed = Date.now() - startedAt;
            trace('ephemeral', 'send:ok', { tag, ms: elapsed });
            if (elapsed >= SLOW_SEND_MS) {
              console.warn(
                `ephemeral: "${tag}" broadcast took ${Math.round(elapsed / 1000)}s to be accepted. ` +
                  `Nothing this agent publishes reaches anyone until it returns — peers will look absent for that long.`,
              );
            }
            if (failures > 0) {
              console.info(`ephemeral: "${tag}" recovered after ${failures} failed send(s)`);
              failures = 0;
            }
          } catch (error: unknown) {
            // A failed send is not worth escalating to the user — presence repairs itself on the
            // next beat — but it must not be silent either. Log the first, then back off
            // geometrically: an unreachable neighbourhood otherwise emits a warning every 5s and
            // buries whatever the actual problem is.
            //
            // `try`/`catch` around the call itself, not `.catch` on the promise: a synchronous throw
            // from `sendBroadcastU` would never reach a `.finally`, leaving `inFlight` stuck true and
            // this channel silently muted for the rest of the session.
            failures += 1;
            trace('ephemeral', 'send:fail', { tag, ms: Date.now() - startedAt, failures, error: String(error) });
            if ((failures & (failures - 1)) === 0) {
              console.warn(`ephemeral: send failed on "${tag}" (${failures} consecutive)`, error);
            }
          } finally {
            inFlight = false;
            const next = queued;
            queued = null;
            if (next) void dispatch(next.payload, next.to);
          }
        }

        const channel: EphemeralChannel = {
          publish(payload, to) {
            // Backpressure for idempotent traffic. When the executor is unhealthy `sendBroadcast`
            // hangs until a 30s RPC timeout, so a 5s heartbeat accumulates six stuck calls — piling
            // load onto the thing that is already failing.
            //
            // The message is **held and sent next**, not dropped, and that difference is the whole
            // point. Coalescing is defined over last-write-wins traffic, where losing a message is
            // supposed to cost nothing because the next one carries the same state — true of a
            // heartbeat, false of the state *change* that heartbeat is about to start repeating.
            // Joining a call, leaving one, and answering a peer's `hello` all go down this channel,
            // and dropping one of those did not cost nothing: it cost a full heartbeat interval of
            // the other agent not knowing, or longer if the next beat lost the race too. Holding the
            // latest keeps exactly one send in flight and one waiting, so nothing piles up and
            // nothing is lost.
            if (options?.coalesce && inFlight) {
              trace('ephemeral', 'publish:queued', { tag });
              queued = { payload, to };
              return;
            }
            void dispatch(payload, to);
          },
          onMessage(cb) {
            let listeners = subscribers.get(tag);
            if (!listeners) {
              listeners = new Set();
              subscribers.set(tag, listeners);
            }
            listeners.add(cb);
            return () => listeners!.delete(cb);
          },
        };

        channels.set(tag, channel);
        return channel;
      },

      // Replaced below by the refcounted handle; the real teardown is `teardown`.
      dispose() {},
    };

    const entry = {
      scope,
      refs: 1,
      teardown: () => {
        neighbourhood.removeSignalHandler(handler);
        subscribers.clear();
        channels.clear();
        scopes.delete(perspective);
      },
    };
    scopes.set(perspective, entry);
    return handleFor(perspective, entry);
  };

  /**
   * A per-caller view of a shared scope. `capabilities` and `channel` delegate; only `dispose` is
   * per-holder, so one consumer releasing its handle cannot tear the transport out from under
   * another. Idempotent — a double dispose must not over-decrement the refcount.
   */
  function handleFor(
    perspective: PerspectiveProxy,
    entry: { scope: EphemeralScope; refs: number; teardown: () => void },
  ): EphemeralScope {
    let released = false;
    return {
      capabilities: entry.scope.capabilities,
      channel: (tag, options) => entry.scope.channel(tag, options),
      dispose() {
        if (released) return;
        released = true;
        entry.refs -= 1;
        if (entry.refs <= 0) entry.teardown();
      },
    };
  }
}
