/**
 * Presence — the first consumer of the {@link EphemeralChannel} port.
 *
 * Everything here is backend-agnostic and DOM-free: given a channel, it gossips this agent's state on
 * a timer and decays peers who go quiet. The only backend-specific piece is the transport itself.
 * (Flux welds these together — its `useSignallingService` owns the timers, the decay ladder, the
 * handshake, profile hydration, *and* an unrelated WebRTC protocol, all inside one AD4M-coupled
 * composable. Splitting them is the point.)
 *
 * Two shape decisions carry the design; see notes/we/August-2026/presence-port.md for the reasoning.
 *
 * 1. **`focus` is one value; `activities` is a list.** A call is not a place you are *instead of* the
 *    Kanban board — it is something you are *in* while also being somewhere. Routes are exclusive;
 *    participation is not. Flux discovered this and modelled it flatly (`currentRoute` + `callRoute` +
 *    `inCall` + `mediaSettings`); this is the same insight, generalised, so a feature module can add
 *    an activity type without touching the schema.
 * 2. **`availability` (declared) and `liveness` (measured) are separate.** Flux fuses them into one
 *    union and carries a standing TODO about it. They are orthogonal — an agent can be `busy` and
 *    `online`, or `available` and `stale`.
 *
 * Profile hydration deliberately lives elsewhere: presence carries `agentId` only, and the UI resolves
 * it through the host's `$identities` directory. Flux re-fetches every peer profile on every heartbeat
 * because its agent map and its profile cache are the same object; keeping them apart avoids that
 * entirely.
 */

import { trace } from './trace';

/** Where an agent is. Hierarchical so consumers can slice at whichever depth they render. */
export interface Focus {
  /**
   * The dataset, by **global** uri — never a local handle id.
   *
   * AD4M perspective uuids are local per-agent: the same shared neighbourhood has a different uuid on
   * every peer, so a broadcast uuid is meaningless to whoever receives it. This is the local-id vs
   * global-uri split from `DatasetHandle`, one layer down, and getting it wrong half-works — correct
   * in single-agent testing, silently broken across peers.
   */
  datasetUri?: string;
  /** Route path within the template, e.g. "/kanban". */
  path?: string;
  /** Optional finer grain — which post, card, or block. Enables "3 people are viewing this". */
  nodeId?: string;
}

export interface MediaSettings {
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenShareEnabled: boolean;
}

/**
 * What an agent is participating in. Open-ended by design: a feature module contributes a variant
 * rather than extending {@link PresenceState}.
 *
 * Activities inherit presence's self-healing property. When an agent's laptop closes, its heartbeat
 * stops, it is evicted on TTL, and its activities go with it — no leave message required. A
 * message-based roster ("Ana left") breaks on crash, tab close, and network partition, leaving ghosts
 * in the call and work permanently claimed by a dead peer.
 */
export type Activity =
  /** In a call. `anchor` is what the call is *about* ("the call on the Kanban"); absent = space-wide. */
  | { type: 'call'; id: string; anchor?: Focus; media?: MediaSettings }
  /** Has the composer open on a node. */
  | { type: 'edit'; nodeId: string }
  /** Typing into a node. */
  | { type: 'typing'; nodeId: string }
  /** Claiming a unit of peer-elected work (AI processing, indexing) — a self-releasing lease. */
  | { type: 'processing'; anchor?: Focus; step?: number }
  /** Escape hatch for feature-module activity types not known to this package. */
  | { type: string; [key: string]: unknown };

/** Declared by the user, as opposed to {@link Liveness}, which is measured. */
export type Availability = 'available' | 'busy' | 'away' | 'invisible';

/** What actually travels. */
export interface PresenceState {
  /** DID, or whatever the host's `$identities` directory keys on. */
  agentId: string;
  /** ms epoch, stamped by the sender. */
  updatedAt: number;
  availability: Availability;
  /** Omitted entirely when the agent hides their location — see {@link FocusDepth}. */
  focus?: Focus;
  activities?: Activity[];
  /** Open payload for module state that is *not* participation (preferences, transient hints). */
  custom?: Record<string, unknown>;
}

/** Derived locally from `updatedAt`. Never transmitted. */
export type Liveness = 'online' | 'idle' | 'stale' | 'offline';

export interface Peer extends PresenceState {
  liveness: Liveness;
}

/**
 * How much of {@link Focus} to publish — a progressive-disclosure privacy control.
 *
 * - `off` — "this agent is online", nothing more.
 * - `space` — "…is in this space".
 * - `route` — "…is looking at the budget page".
 * - `precise` — "…is reading your post".
 *
 * Distinct from `availability: 'invisible'`, which is the stronger control that stops publishing
 * altogether.
 */
export type FocusDepth = 'off' | 'space' | 'route' | 'precise';

export interface LivenessThresholds {
  /** ms since `updatedAt` after which a peer is `idle`. */
  idleAfter: number;
  /** ms after which a peer is `stale`. */
  staleAfter: number;
  /** ms after which a peer is `offline`. */
  offlineAfter: number;
  /** ms after which a peer is dropped entirely. Flux never evicts, so its agent map grows forever. */
  evictAfter: number;
}

/** Tuned from Flux's ladder (5s heartbeat / 30s asleep / 60s offline), with eviction added. */
export const DEFAULT_THRESHOLDS: LivenessThresholds = {
  idleAfter: 15_000,
  staleAfter: 30_000,
  offlineAfter: 60_000,
  evictAfter: 300_000,
};

export const DEFAULT_HEARTBEAT_INTERVAL = 5_000;

/**
 * How long to wait before each repeat of the join handshake, until somebody answers.
 *
 * Successive delays, so `[1000]` means one repeat a second after the first attempt.
 *
 * The handshake is a single fire-and-forget broadcast over a best-effort transport, and one lost
 * packet costs a full heartbeat interval of looking at an empty space. That is the shape of the
 * complaint that produced this: sometimes instant, sometimes ten seconds, no pattern, and the two
 * agents disagreeing about what happened because loss is independent per direction.
 *
 * Only one repeat, because it is not the only safety net: a heartbeat sent while this agent still
 * has no peers is itself a `hello` (see `schedule`), so the second second is covered by the retry
 * and every fifth second after that by the ordinary beat. Repeating harder in between would be
 * three mechanisms covering one gap.
 */
export const HANDSHAKE_RETRIES = [1_000];

/**
 * How long after a state change to send it a second time.
 *
 * The transport acks the send and never the delivery, so any single message can vanish. For a
 * heartbeat that costs nothing — the next one carries the same state, and it is five seconds away at
 * worst. For a *change* it costs the whole interval, during which every peer confidently displays
 * the opposite of what is true: a muted microphone still showing as live is the visible case, and it
 * looks like lag rather than like loss.
 *
 * One repeat, not a stream of them. It cuts the exposure to a lost change from one heartbeat to a
 * fraction of a second, at the price of one extra message per mute — and mutes are rare, while
 * heartbeats are not, which is exactly why this is worth doing here and nowhere else.
 *
 * Long enough that the repeat is not lost to the same momentary outage as the original, short enough
 * that nobody reads it as lag.
 */
export const STATE_CHANGE_ECHO = 700;

/**
 * First delay after a send the backend *refused*, doubling each consecutive failure.
 *
 * Distinct from every other timer here because it answers a different question. The others guard
 * against loss the transport cannot see and therefore fire on the chance something went wrong; this
 * one fires on a refusal, where nothing was sent and there is no chance about it.
 *
 * Backed off rather than immediate: a refusal usually means the executor is unreachable, and
 * retrying hard at an unreachable executor is how a blip becomes an outage — the reasoning that put
 * coalescing in the transport in the first place. Capped at the heartbeat interval, beyond which the
 * ordinary beat *is* the retry.
 */
export const RETRY_BASE = 400;

/** Trim a focus to the depth the agent has consented to publish. */
export function applyFocusDepth(focus: Focus | undefined, depth: FocusDepth): Focus | undefined {
  if (!focus || depth === 'off') return undefined;
  if (depth === 'space') return { datasetUri: focus.datasetUri };
  if (depth === 'route') return { datasetUri: focus.datasetUri, path: focus.path };
  return focus;
}

/**
 * Map raw peer states onto {@link Peer}s, dropping anyone past `evictAfter`.
 *
 * Pure: same inputs, same output. This is Flux's `evaluateAgents` with the mutation, the reactive
 * framework, and the `me` special-case removed — all three of which made it untestable there.
 */
export function derivePeers(
  states: Iterable<PresenceState>,
  now: number,
  thresholds: LivenessThresholds = DEFAULT_THRESHOLDS,
): Peer[] {
  const peers: Peer[] = [];
  for (const state of states) {
    const age = now - state.updatedAt;
    if (age >= thresholds.evictAfter) continue;
    peers.push({ ...state, liveness: livenessFor(age, thresholds) });
  }
  return peers;
}

function livenessFor(age: number, t: LivenessThresholds): Liveness {
  if (age < t.idleAfter) return 'online';
  if (age < t.staleAfter) return 'idle';
  if (age < t.offlineAfter) return 'stale';
  return 'offline';
}

// ── Selectors ────────────────────────────────────────────────────────────────
// Space / route / node presence is not a granularity *decision* — publish the deepest focus you have
// and let each consumer slice. These are the slices.

/**
 * Peers whose focus matches every field supplied. The one primitive; the depth of the partial focus
 * *is* the granularity.
 *
 * Deliberately not offered as a bare `peersAtPath(peers, '/kanban')`: **a route path is only
 * meaningful within a dataset**, and two spaces routinely have the same one. A path-only selector
 * silently unions peers across spaces, which is the kind of bug that looks correct in single-space
 * testing — the same class of mistake as broadcasting a local perspective uuid. Requiring the caller
 * to write the whole focus they mean removes the hazard rather than documenting it.
 *
 * Excludes `offline` peers unless `includeOffline`.
 */
export function peersMatching(peers: Peer[], focus: Partial<Focus>, includeOffline = false): Peer[] {
  const keys = Object.keys(focus) as Array<keyof Focus>;
  return peers.filter((p) => {
    if (!includeOffline && p.liveness === 'offline') return false;
    if (!p.focus) return false;
    return keys.every((k) => p.focus![k] === focus[k]);
  });
}

/** Peers whose focus is in this dataset. Sugar for the unambiguous case. */
export function peersInDataset(peers: Peer[], datasetUri: string, includeOffline = false): Peer[] {
  return peersMatching(peers, { datasetUri }, includeOffline);
}

// ── Presentation ─────────────────────────────────────────────────────────────
// Semantic only — no colours, no opacity values. The design system owns how these render; this owns
// what they mean.

/** Semantic colour for a peer. The design system maps these to tokens; this only says what they mean. */
export type PresenceTone = 'success' | 'warning' | 'danger' | 'neutral';

const TONE_BY_LIVENESS: Record<Liveness, PresenceTone> = {
  online: 'success',
  idle: 'warning',
  stale: 'danger',
  // Offline peers are filtered before rendering; neutral is the safe answer if one slips through.
  offline: 'neutral',
};

/**
 * Colour a peer by **liveness** — the decaying signal, which is what a viewer needs to read at a
 * glance: green here, amber going, red nearly gone.
 *
 * An earlier attempt split this across two channels — ring colour for declared `availability`,
 * opacity for measured `liveness` — so both could be read at once. It was rejected in practice for a
 * concrete reason worth recording: **avatars in a stack overlap**, so reducing opacity lets the
 * avatar behind show through the one in front. The opaque separator ring is exactly what stops that.
 * Opacity and overlap are incompatible, and the two-axis encoding was harder to read besides.
 *
 * `availability` is therefore not shown yet. Nothing can set it today (no idle detector, no manual
 * control), so every peer reports `available` and the channel would be dead weight. When that UI
 * lands, the likely rule is that availability wins while a peer is `online` and liveness takes over
 * as they degrade — but that is a decision to make with the feature, not to guess at now.
 */
export function peerTone(peer: Peer): PresenceTone {
  return TONE_BY_LIVENESS[peer.liveness] ?? 'neutral';
}

const LIVENESS_RANK: Record<Liveness, number> = { online: 0, idle: 1, stale: 2, offline: 3 };

/**
 * Most-present first.
 *
 * The `agentId` tiebreak is not cosmetic: peers arrive from a `Map`, so equal-liveness peers would
 * otherwise order by insertion and **reshuffle on every heartbeat**, making a stable group of people
 * look like it is constantly churning. Returns a new array; does not mutate.
 */
export function sortByPresence(peers: Peer[]): Peer[] {
  return [...peers].sort(
    (a, b) => LIVENESS_RANK[a.liveness] - LIVENESS_RANK[b.liveness] || a.agentId.localeCompare(b.agentId),
  );
}

/** Every activity of a type, paired with the peer performing it. */
export function activitiesOfType<T extends Activity['type']>(
  peers: Peer[],
  type: T,
): Array<{ peer: Peer; activity: Extract<Activity, { type: T }> }> {
  const out: Array<{ peer: Peer; activity: Extract<Activity, { type: T }> }> = [];
  for (const peer of peers) {
    for (const activity of peer.activities ?? []) {
      if (activity.type === type) out.push({ peer, activity: activity as Extract<Activity, { type: T }> });
    }
  }
  return out;
}

/**
 * Group call participants by call id.
 *
 * Multiple concurrent calls in one space fall out for free from activities-being-a-list. Flux cannot
 * express this — `callRoute` is a single value, so one call per agent, identified by channel.
 */
export function callRosters(peers: Peer[]): Map<string, Peer[]> {
  const rosters = new Map<string, Peer[]>();
  for (const { peer, activity } of activitiesOfType(peers, 'call')) {
    const roster = rosters.get(activity.id);
    if (roster) roster.push(peer);
    else rosters.set(activity.id, [peer]);
  }
  return rosters;
}

// ── The heartbeat driver ─────────────────────────────────────────────────────

/** The transport surface the driver needs — structurally an `EphemeralChannel`, restated so this
 *  module is testable with a fake and carries no import-time dependency on the port. */
export interface PresenceChannel {
  publish(payload: unknown, to?: { agentId?: string }): void;
  onMessage(cb: (from: string, payload: unknown) => void): () => void;
  /** Optional — see `EphemeralChannel.onPublishResult`. Absent means the transport cannot tell. */
  onPublishResult?(cb: (result: { ok: boolean; ms: number; superseded?: boolean }) => void): () => void;
}

export interface HeartbeatOptions {
  /** ms between heartbeats when nothing else has been published. */
  interval?: number;
  thresholds?: LivenessThresholds;
  /** Injected for testability and because `Date.now` is the one impurity here. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Called whenever the peer map changes, with freshly derived peers. */
  onPeersChanged?: (peers: Peer[]) => void;
}

export interface PresenceSource {
  /** Begin publishing and listening. Sends the join handshake. */
  start(state: PresenceState): void;
  /**
   * Re-run the join handshake: publish with `hello` so every peer answers at once.
   *
   * `start` already does this, and that is enough only when the transport was able to carry it. A
   * host may gate publishing — WE lets one tab per agent do the talking — and a `hello` sent before
   * that gate opens is simply gone. Nothing retries it, because the driver has no idea it was
   * dropped: it looks like an ordinary send, and the space it is joining looks empty until every
   * peer's next heartbeat happens to arrive.
   *
   * So the host calls this when it becomes the one that publishes. Idempotent — an extra handshake
   * costs one round trip of answers and cannot leave anything inconsistent.
   */
  announce(): void;
  /** Merge a patch into this agent's state and publish immediately. */
  update(patch: Partial<Omit<PresenceState, 'agentId' | 'updatedAt'>>): void;
  /** Add or replace an activity, matched on `type` plus `id` when present. */
  setActivity(activity: Activity): void;
  /** Remove activities of a type, optionally narrowed to one id. */
  clearActivity(type: string, id?: string): void;
  /** Current peers, derived at call time so liveness is never stale. */
  peers(): Peer[];
  /** Stop publishing and listening. Idempotent. */
  stop(): void;
}

/**
 * Why a publish is happening — and therefore what to do if it does not arrive.
 *
 * A first-class reason rather than an optional lifecycle flag, because three separate repair
 * policies now key off it and the code had been inferring them from context. It read badly too: a
 * mute logged as `"beat"` in the trace, which is the one line you would look at to find out whether
 * a mute had been sent.
 *
 * - `beat` — routine. Losing one costs nothing; the next carries the same state.
 * - `change` — something became true. Losing one leaves peers asserting the opposite until the next
 *   beat, so it is repeated once. See {@link STATE_CHANGE_ECHO}.
 * - `hello` — arriving, and asking everyone to answer.
 * - `solicit` — a beat that asks, sent while this agent knows no peers.
 * - `bye` — leaving, so peers drop this agent rather than watching it decay.
 */
export type PublishReason = 'beat' | 'change' | 'hello' | 'solicit' | 'bye';

/** Wire protocol. Kept minimal: a full state, plus two one-bit lifecycle hints. */
interface PresenceMessage {
  v: 1;
  state: PresenceState;
  /** Set on join. Peers seeing it re-broadcast so the joiner populates in one round trip. */
  hello?: true;
  /**
   * Set on leave. Peers drop the agent immediately instead of watching it decay.
   *
   * Without this, leaving a space is indistinguishable from a crashed laptop: the agent simply stops
   * heartbeating and runs the full ladder, so it lingers for a full `offlineAfter` in a space it left
   * instantly. Arrival was already one round trip via `hello`; this makes departure symmetric.
   *
   * An **optimisation, not a guarantee** — the transport is lossy and fire-and-forget, so a lost
   * `bye` just means the peer decays as before. TTL remains the backstop; this is the fast path.
   */
  bye?: true;
}

function isPresenceMessage(payload: unknown): payload is PresenceMessage {
  if (typeof payload !== 'object' || payload === null) return false;
  const msg = payload as Partial<PresenceMessage>;
  return msg.v === 1 && typeof msg.state === 'object' && msg.state !== null;
}

/**
 * Lift a fan-out channel into a presence source by gossiping on a timer — the P1/P2 path.
 *
 * A P3 backend (one that reports connects and disconnects itself) should implement
 * {@link PresenceSource} directly and never call this: forcing a server that already knows who is
 * online to emulate 5-second gossip is exactly the lowest-common-denominator trap the capability tiers
 * exist to avoid.
 *
 * Two behaviours lifted from Flux because they are genuinely load-bearing:
 *
 * - **Adaptive scheduling.** A state change publishes immediately and pushes the next tick out a full
 *   interval, so a peer navigating quickly does not double-send.
 * - **Join handshake.** A joiner sets `hello`; peers seeing it re-announce at once. Without it a
 *   joiner waits a whole interval to see anyone, because the transport is stateless and lossy.
 */
export function createHeartbeatPresence(channel: PresenceChannel, options: HeartbeatOptions = {}): PresenceSource {
  const interval = options.interval ?? DEFAULT_HEARTBEAT_INTERVAL;
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  const states = new Map<string, PresenceState>();
  let self: PresenceState | null = null;
  let unsubscribe: (() => void) | null = null;
  let unsubscribeResults: (() => void) | null = null;
  let timer: unknown = null;
  let handshakeTimer: unknown = null;
  let echoTimer: unknown = null;
  let retryTimer: unknown = null;
  /** Consecutive failed sends, for the backoff. Reset by any success. */
  let sendFailures = 0;
  /** What the last publish was for, so a retry can repeat the right kind of message. */
  let lastReason: PublishReason = 'beat';
  let running = false;

  function notify(): void {
    const peers = derivePeers(states.values(), now(), thresholds);
    trace('presence', 'peers', { count: peers.length });
    options.onPeersChanged?.(peers);
  }

  /** Have we heard from anybody? `states` always holds our own entry, so one means nobody. */
  const alone = () => states.size <= 1;

  function cancelHandshake(): void {
    if (handshakeTimer !== null) {
      clearTimer(handshakeTimer);
      handshakeTimer = null;
    }
  }

  function cancelRetry(): void {
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
  }

  /**
   * React to a send that actually failed, rather than waiting to find out by accident.
   *
   * This is the one repair here that is *closed-loop*, and it is worth distinguishing from the
   * others. The echo, the handshake retry and the soliciting beat all guard against loss the
   * transport cannot see — a message it accepted and the network then dropped — so they can only
   * ever be timers firing on the chance that something went wrong. A refusal is different: the
   * backend said no, nothing was sent, and there is no chance about it.
   *
   * Retried on a backoff rather than immediately, because a refusal usually means the executor is
   * unreachable, and hammering an unreachable executor is how a blip becomes an outage — the same
   * reasoning that put coalescing in the transport. Capped at the heartbeat interval, since past
   * that the ordinary beat is the retry.
   */
  function onSendFailed(): void {
    sendFailures += 1;
    const delay = Math.min(RETRY_BASE * 2 ** (sendFailures - 1), interval);
    trace('presence', 'send:retry', { failures: sendFailures, delay });
    cancelRetry();
    retryTimer = setTimer(() => {
      retryTimer = null;
      if (!running) return;
      // The reason is carried over: a `hello` that failed must go out as a `hello`, or nobody
      // answers it and the join is silently downgraded to a plain announcement.
      send(lastReason === 'bye' ? 'beat' : lastReason);
    }, delay);
  }

  /**
   * Publish a state change, and publish it once more shortly after in case the first is lost.
   *
   * At most one repeat is ever pending: a second change replaces the first's, which is the same
   * last-write-wins rule the transport's coalescing follows, and stops a run of quick toggles from
   * queueing a repeat each. See {@link STATE_CHANGE_ECHO}.
   */
  function publishChange(): void {
    send('change');
    schedule(interval);
    if (echoTimer !== null) clearTimer(echoTimer);
    echoTimer = setTimer(() => {
      echoTimer = null;
      if (!running) return;
      trace('presence', 'change:echo');
      send('change');
      schedule(interval);
    }, STATE_CHANGE_ECHO);
  }

  /**
   * Say hello, and say it again if nobody answers.
   *
   * Each repeat is cancelled the instant any peer state arrives, so a healthy space sends exactly
   * one. See {@link HANDSHAKE_RETRIES} for why a single broadcast is not enough on this transport.
   */
  function handshake(attempt = 0): void {
    send('hello');
    cancelHandshake();
    const delay = HANDSHAKE_RETRIES[attempt];
    if (delay === undefined) return;
    handshakeTimer = setTimer(() => {
      handshakeTimer = null;
      if (!running || !alone()) return;
      trace('presence', 'handshake:retry', { attempt: attempt + 1 });
      handshake(attempt + 1);
    }, delay);
  }

  function send(reason: PublishReason = 'beat'): void {
    if (!running || !self) return;
    lastReason = reason;
    self = { ...self, updatedAt: now() };
    states.set(self.agentId, self);
    // `invisible` is a hard stop, not a client-side filter. Flux keeps broadcasting full state
    // (including route) when invisible and merely hides it on receipt, so any modified client sees
    // invisible agents and where they are.
    //
    // `bye` is the one exception: an invisible agent has published nothing, so peers hold no state
    // to retract, and sending one would disclose their departure — and therefore their presence.
    if (self.availability !== 'invisible') {
      const message: PresenceMessage = { v: 1, state: self };
      if (reason === 'hello' || reason === 'solicit') message.hello = true;
      if (reason === 'bye') message.bye = true;
      trace('presence', 'send', { reason, activities: self.activities?.length ?? 0 });
      channel.publish(message);
    }
    notify();
  }

  function schedule(delay: number): void {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      if (!running || !self) return;
      // Another publish may have happened since this tick was scheduled; wait out the remainder
      // rather than sending twice inside one interval.
      const sinceLast = now() - self.updatedAt;
      if (sinceLast < interval) schedule(interval - sinceLast);
      else {
        /**
         * A beat sent while we know nobody is a `hello`, so it solicits rather than just announces.
         *
         * Same message, same rate — the only difference is that peers answer it. It matters because
         * "no peers" is reached two ways: nobody is here, in which case nothing is listening and the
         * flag costs nothing; or the transport dropped out from under us and took the peer map with
         * it. The second is routine against a remote executor, whose client backs its reconnect off
         * to thirty seconds — and coming back deaf, waiting passively for everyone else's next beat,
         * is how a blip becomes the better part of a minute.
         */
        send(alone() ? 'solicit' : 'beat');
        schedule(interval);
      }
    }, delay);
  }

  function receive(from: string, payload: unknown): void {
    if (!running || !isPresenceMessage(payload)) {
      trace('presence', 'recv:drop', { from, reason: running ? 'malformed' : 'stopped' });
      return;
    }
    if (self && from === self.agentId) {
      trace('presence', 'recv:drop', { from, reason: 'self' });
      return;
    }

    trace('presence', 'recv', {
      from,
      hello: payload.hello ?? false,
      bye: payload.bye ?? false,
      activities: payload.state.activities?.length ?? 0,
    });

    // A departure retracts the agent outright rather than leaving it to decay.
    if (payload.bye) {
      states.delete(from);
      notify();
      return;
    }

    // Trust the transport's sender id over the payload's — a peer must not be able to write into
    // another agent's slot. Where `authenticatedSender` is false this is still the best available
    // key, and the capability flag is what warns a consumer not to act on it.
    states.set(from, { ...payload.state, agentId: from, updatedAt: now() });

    // Somebody is there, so stop repeating our own introduction.
    cancelHandshake();

    // Answer a joiner immediately so they do not wait out a full interval. Not itself a hello, or
    // two peers would ping-pong forever.
    if (payload.hello) send();
    else notify();
  }

  function evictStale(): void {
    const cutoff = now() - thresholds.evictAfter;
    for (const [id, state] of states) {
      if (state.updatedAt <= cutoff && id !== self?.agentId) states.delete(id);
    }
  }

  return {
    start(state) {
      if (running) return;
      running = true;
      self = { ...state, updatedAt: now() };
      states.set(self.agentId, self);
      unsubscribe = channel.onMessage(receive);
      unsubscribeResults =
        channel.onPublishResult?.((result) => {
          // A superseded message was replaced by a newer one carrying the same state or better, so
          // it is not a failure to repair — reporting it exists so this cannot be inferred wrongly.
          if (result.superseded) return;
          if (result.ok) {
            sendFailures = 0;
            cancelRetry();
            return;
          }
          onSendFailed();
        }) ?? null;
      trace('presence', 'start', { agentId: self.agentId });
      handshake();
      schedule(interval);
    },

    announce() {
      // No `self` means `start` has not run, which is the ordinary case when a host registers its
      // leadership callback before starting the source — the callback fires immediately if this tab
      // is already the leader, and `start`'s own handshake is the one that should go out.
      if (!self) return;
      trace('presence', 'announce');
      handshake();
      schedule(interval);
    },

    update(patch) {
      if (!self) return;
      self = { ...self, ...patch };
      publishChange();
    },

    setActivity(activity) {
      if (!self) return;
      const id = 'id' in activity ? activity.id : undefined;
      const rest = (self.activities ?? []).filter(
        (a) => a.type !== activity.type || ('id' in a ? a.id : undefined) !== id,
      );
      self = { ...self, activities: [...rest, activity] };
      trace('presence', 'activity:set', { type: activity.type, activities: self.activities?.length ?? 0 });
      publishChange();
    },

    clearActivity(type, id) {
      if (!self?.activities) return;
      const activities = self.activities.filter(
        (a) => a.type !== type || (id !== undefined && ('id' in a ? a.id : undefined) !== id),
      );
      self = { ...self, activities };
      trace('presence', 'activity:clear', { type, activities: activities.length });
      publishChange();
    },

    peers() {
      evictStale();
      return derivePeers(states.values(), now(), thresholds);
    },

    stop() {
      // Announce the departure *before* tearing down, and while `running` is still true so `send`
      // does not short-circuit. Peers drop us at once instead of watching a space change decay like
      // a crash. Best-effort by design — see `PresenceMessage.bye`.
      send('bye');

      running = false;
      cancelHandshake();
      cancelRetry();
      sendFailures = 0;
      unsubscribeResults?.();
      unsubscribeResults = null;
      if (echoTimer !== null) {
        clearTimer(echoTimer);
        echoTimer = null;
      }
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      unsubscribe?.();
      unsubscribe = null;
      states.clear();
      self = null;
    },
  };
}
