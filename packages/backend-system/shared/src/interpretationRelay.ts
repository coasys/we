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
  INTERPRETATION_ACTIVITY_TTL_MS,
  type InterpretationActivity,
  type InterpretationPhase,
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
   *
   * Accepts a function so a host can bind it to a live setting. Read per publish rather than at
   * construction, because the alternative is tearing down and rebuilding the relay when somebody
   * flips a switch — which would drop every row it is holding, including the pass they turned the
   * switch on to look at.
   */
  shareDetail?: boolean | (() => boolean);
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
  /**
   * Re-broadcast this peer's own rows.
   *
   * For the moment `shareDetail` is turned on. The flag is read per publish, and a finished pass
   * publishes nothing further — so without this, enabling sharing reaches only passes that have not
   * happened yet. Which is precisely backwards: the switch is offered while somebody is looking at a
   * prompt, and the pass they are looking at is the one it would fail to share.
   *
   * Only rows this peer runs. A relayed row's payload never left the machine that produced it, so
   * re-broadcasting somebody else's would send a copy of nothing while claiming their work as ours.
   */
  resend(): void;
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
/**
 * How much of one side of the exchange goes on the wire.
 *
 * The doc above calls the detail "tens of KB per pass" and that was the *typical* case, not a
 * bound: the prompt is built from a transcript, so an hour-long call's prompt is as long as the
 * hour-long call, and both halves went out uncapped to every peer in the space, once per phase.
 * A single meeting could therefore push megabytes of ephemeral traffic at everybody present — and
 * a peer sending an oversized payload has the same effect on every receiver whether or not it meant
 * to.
 *
 * 64KB is roughly the largest thing worth reading in a debug panel, which is what this is for. The
 * marker says the text was cut rather than letting a truncated JSON blob read as a malformed one.
 */
const MAX_DETAIL_CHARS = 64_000;
const TRUNCATION_MARKER = '\n… (truncated for sharing)';

function clampDetail(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= MAX_DETAIL_CHARS) return text;
  return text.slice(0, MAX_DETAIL_CHARS) + TRUNCATION_MARKER;
}

export function createInterpretationRelay(channel: EphemeralChannel, options: RelayOptions = {}): InterpretationRelay {
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? INTERPRETATION_ACTIVITY_TTL_MS;
  const sharingDetail = () =>
    typeof options.shareDetail === 'function' ? options.shareDetail() : (options.shareDetail ?? false);
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

  /**
   * Put one row on the wire.
   *
   * Shared by `publish` and `resend` so the two cannot disagree about what a peer receives — and
   * `sharingDetail()` is read here, at send time, which is what makes the switch take effect on the
   * next thing sent rather than on the next relay built.
   */
  function broadcast(activity: InterpretationActivity): void {
    const message: ActivityMessage = {
      k: 'activity',
      passId: activity.passId,
      watchId: activity.watchId,
      phase: activity.phase,
      ids: activity.ids,
      detail: activity.detail,
      ...(sharingDetail()
        ? { prompt: clampDetail(activity.llm?.prompt), response: clampDetail(activity.llm?.response) }
        : {}),
    };
    // Fire and forget, matching the channel's own contract. A dropped update costs one frame of
    // staleness on a peer's bar and is corrected by the next phase; awaiting it here would make
    // every caller choose between blocking a pass on a broadcast and an unhandled rejection.
    channel.publish(message);
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
      /*
        Clamped on the way in as well as on the way out. What this peer sends is under its own
        control; what arrives is not, and a peer that sends an unbounded prompt is holding that
        much of every receiver's memory for the row's whole ten-minute lifetime — once per pass,
        for as long as it cares to keep sending. A cap on the sender alone is a request.
      */
      llm:
        payload.prompt || payload.response
          ? { prompt: clampDetail(payload.prompt), response: clampDetail(payload.response) }
          : undefined,
    });
    notify();
  });

  return {
    publish(activity) {
      mergeActivity(rows, activity);
      notify();
      /*
        Only this peer's own passes go on the wire — the same rule `resend` applies.

        A host feeds this everything its backend reports, and on a hosted executor that includes
        passes run for *other* users of the same node, delivered with `mine: false` over the
        perspective-scoped stream. Broadcasting those would put this agent's name on somebody
        else's work on every other member's bar — the transport stamps the sender as the runner,
        and that is the whole trust model. Merging them locally is still right: this peer did
        observe them.
      */
      if (activity.mine) broadcast(activity);
    },

    rows: current,

    resend() {
      for (const row of current()) if (row.mine) broadcast(row);
    },

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
