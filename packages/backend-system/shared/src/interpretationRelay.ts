/**
 * Make one peer's interpretation passes visible to everyone else in the space.
 *
 * ## The gap this fills
 *
 * A pass runs on exactly one peer, and every backend event stream that reports it is local to that
 * peer's node. AD4M is explicit about this — its own PR notes that cross-executor visibility is not
 * covered and that a consumer wanting it should watch the graph for claim links — so out of five
 * people in a call, four see nothing at all while the fifth watches a full step-by-step readout.
 *
 * Which of the five is arbitrary: the runner is chosen by an election. So the rich view lands on
 * whoever won a coin flip, and the person asking "why did that extract nothing?" is usually not
 * them.
 *
 * ## Why ephemeral, and not the graph
 *
 * Extraction progress is a presence fact. It has the lifetime of a speaking indicator, it is
 * worthless five minutes later, and nobody should be able to find it after a refresh — which is
 * exactly the test {@link EphemeralPort} exists to answer. The alternative, writing a status node
 * per phase, would churn the shared graph with records nobody wants and deliver them on sync
 * latency, which is the wrong order of magnitude for a bar that claims to be live.
 *
 * ## What crosses, and what does not
 *
 * Phase, runner and elapsed always. The model exchange only when the host asks for it via
 * {@link RelayOptions.shareDetail}, because it is tens of KB per pass and every peer would receive
 * every byte of it on every pass forever.
 *
 * That is a bandwidth decision, not a privacy one, and the distinction matters for how the knob
 * should be set: in a call the prompt is built from the transcript every participant already holds,
 * so sharing it leaks nothing. Turning it on for a space that is actively debugging extraction is
 * entirely reasonable. Leaving it on by default for every space forever is not.
 *
 * ## Trust
 *
 * `runner` is taken from the transport's `from`, never from the payload. A peer can therefore
 * report its own passes and nobody else's. On a transport with `authenticatedSender: false` that
 * guarantee is only as good as the transport, which is why {@link createInterpretationRelay}
 * declares the requirement rather than assuming it — a host that plans an audit trail on top of
 * this should check the plan first.
 */

import type { EphemeralChannel } from './ephemeral';
import {
  type InterpretationActivity,
  type InterpretationPhase,
  INTERPRETATION_ACTIVITY_TTL_MS,
  isSettled,
  mergeActivity,
} from './interpretationActivity';

/** The channel tag interpretation activity rides on. Namespaced like every other protocol's. */
export const INTERPRETATION_ACTIVITY_CHANNEL = 'interpretation-activity';

/** What one peer broadcasts about one of its passes. The wire form — deliberately not
 *  {@link InterpretationActivity}, which carries fields only the receiver can fill in. */
interface ActivityMessage {
  /** Discriminator, so this channel can carry a second message kind later without ambiguity. */
  k: 'activity';
  passId: string;
  watchId?: string;
  phase: InterpretationPhase;
  ids?: string[];
  detail?: string;
  prompt?: string;
  response?: string;
}

function isActivityMessage(payload: unknown): payload is ActivityMessage {
  if (typeof payload !== 'object' || payload === null) return false;
  const m = payload as Partial<ActivityMessage>;
  return m.k === 'activity' && typeof m.passId === 'string' && typeof m.phase === 'string';
}

export interface RelayOptions {
  /**
   * Include the raw prompt and response in what is broadcast. Default `false` — see the module
   * docs on why this is a bandwidth switch rather than a privacy one.
   */
  shareDetail?: boolean;
  /** Injectable for tests. */
  now?: () => number;
  /** How long a peer's unsettled row is believed. Defaults to
   *  {@link INTERPRETATION_ACTIVITY_TTL_MS}. */
  ttlMs?: number;
}

export interface InterpretationRelay {
  /**
   * Feed a locally-observed pass in: it is broadcast to peers, and returned to the consumer
   * unchanged so a host can wire this as a pass-through in front of its own store.
   */
  publish(activity: InterpretationActivity): void;
  /** Every pass this peer knows about — its own and its neighbours' — freshest first is the
   *  consumer's business; this returns them keyed. */
  rows(): InterpretationActivity[];
  /** Called whenever `rows()` would return something different. */
  onChange(cb: (rows: InterpretationActivity[]) => void): () => void;
  /** Drop the subscription. Does not clear rows — a host disposing a relay is usually tearing down
   *  the surface that displayed them anyway. */
  dispose(): void;
}

/**
 * Wire a local activity stream to a channel, and a channel to a merged view.
 *
 * Backend-neutral by construction: it takes a channel and gives back rows, and knows nothing about
 * how either side produces a pass. That is what lets the in-memory transport exercise it in tests
 * against the same code path AD4M runs in production — the reason the ephemeral port has a
 * reference implementation at all.
 */
export function createInterpretationRelay(
  channel: EphemeralChannel,
  options: RelayOptions = {},
): InterpretationRelay {
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? INTERPRETATION_ACTIVITY_TTL_MS;
  const rows = new Map<string, InterpretationActivity>();
  const watchers = new Set<(rows: InterpretationActivity[]) => void>();

  /*
    Peer rows are keyed by sender as well as pass, and that prefix is the whole defence against a
    peer overwriting somebody else's row.

    Two peers can legitimately run passes that share a `passId`: on a one-shot pass the id is
    chosen client-side, so two people pressing Extract at the same moment on the same collection
    can pick the same one. Without the prefix the second broadcast would land on the first's row
    and one of the two would silently vanish from every bar in the space.
  */
  const keyFor = (from: string, passId: string) => `${from}::${passId}`;

  function notify(): void {
    if (watchers.size === 0) return;
    const snapshot = current();
    watchers.forEach((cb) => cb(snapshot));
  }

  /** Rows minus anything whose runner stopped reporting. See `INTERPRETATION_ACTIVITY_TTL_MS`. */
  function current(): InterpretationActivity[] {
    const at = now();
    const live: InterpretationActivity[] = [];
    for (const [key, row] of rows) {
      if (!isSettled(row.phase) && at - row.at > ttlMs) {
        // Dropped rather than marked failed. This peer does not know that the pass failed — only
        // that it stopped hearing about it, which is as likely to be a closed laptop as an error,
        // and reporting somebody else's work as failed on that evidence would be a guess presented
        // as a fact.
        rows.delete(key);
        continue;
      }
      live.push(row);
    }
    return live;
  }

  const unsubscribe = channel.onMessage((from, payload) => {
    if (!isActivityMessage(payload)) return;
    mergeActivity(rows, {
      passId: keyFor(from, payload.passId),
      watchId: payload.watchId,
      // The transport's `from`, never the payload's word for it — see the module docs on trust.
      runner: from,
      // Anything arriving over the channel is by definition somebody else's: the in-memory bus and
      // AD4M both decline to loop a broadcast back to its sender.
      mine: false,
      phase: payload.phase,
      at: now(),
      ids: payload.ids,
      detail: payload.detail,
      llm: payload.prompt || payload.response ? { prompt: payload.prompt, response: payload.response } : undefined,
    });
    notify();
  });

  return {
    publish(activity) {
      mergeActivity(rows, activity);
      notify();

      const message: ActivityMessage = {
        k: 'activity',
        passId: activity.passId,
        watchId: activity.watchId,
        phase: activity.phase,
        ids: activity.ids,
        detail: activity.detail,
        ...(options.shareDetail
          ? { prompt: activity.llm?.prompt, response: activity.llm?.response }
          : {}),
      };
      // Fire and forget, matching the channel's own contract. A dropped update costs one frame of
      // staleness on a peer's bar and is corrected by the next phase; awaiting it here would make
      // every caller choose between blocking a pass on a broadcast and an unhandled rejection.
      channel.publish(message);
    },

    rows: current,

    onChange(cb) {
      watchers.add(cb);
      return () => watchers.delete(cb);
    },

    dispose() {
      unsubscribe();
      watchers.clear();
    },
  };
}
