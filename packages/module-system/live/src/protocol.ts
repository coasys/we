/**
 * What travels between two people looking at the same thing — and nothing else.
 *
 * ## What is deliberately absent: who is here, and who is driving
 *
 * There is no join, no leave, no roster and no "I am the driver" message. All of that is presence,
 * as activities:
 *
 * ```ts
 * { type: 'live', cursors: true }        // my cursors are on, so publish yours
 * { type: 'driving', id: <callId> }      // I have the wheel
 * { type: 'following', id: <driverDid> } // I am following them
 * ```
 *
 * This is the same reasoning the call module's protocol records, and it holds for the same reason:
 * presence expires on a TTL, so a driver whose laptop closes releases every follower on their own,
 * where a message-based roster leaves a room following somebody who is not there. It also means the
 * only thing on this channel is data that is *worthless a second later*, which is what lets it be
 * lossy, coalesced, and eventually moved onto a faster transport with no consumer noticing.
 *
 * Drop every message here and cursors stop appearing while presence stays exactly right.
 *
 * ## Sequence numbers, because a faster transport will not be ordered
 *
 * Every message carries `seq`, monotonic per sender per kind, and a receiver drops anything not newer
 * than what it holds. On today's transport that is nearly free insurance: sends are dispatched
 * concurrently, so two cursor positions can land out of order and the older one would win, leaving a
 * cursor that jitters backwards.
 *
 * It is not only insurance, though. The plan for this traffic is a WebRTC data channel once sessions
 * are a port — unordered and unreliable by choice, because a late cursor is worth less than a prompt
 * one — and `seq` is the whole of what makes that substitution invisible. Designing it in now costs
 * one integer.
 *
 * ## Versioning
 *
 * `v` is checked and mismatches are dropped, as in presence and in the call. A new `kind` degrades on
 * its own — {@link parseLiveMessage} answers `null` for one it does not know — so adding a kind does
 * not need a bump, where changing the meaning of an existing field does.
 */
import type { LiveAnchor, ViewFrame } from '@we/module-shared';

export const LIVE_PROTOCOL_VERSION = 1;

/** What every message carries regardless of kind. */
export interface LiveEnvelope {
  v: number;
  /** Monotonic per sender per kind. See the note above. */
  seq: number;
}

export type LiveBody =
  /**
   * Where this agent's pointer is, or `null` as it leaves the shared surface.
   *
   * The `null` is worth sending rather than waiting for the TTL: leaving a page is a deliberate act
   * and a cursor that lingers three seconds after somebody navigated away is telling everyone they
   * are somewhere they are not.
   */
  | { kind: 'cursor'; at: LiveAnchor | null }
  /**
   * What this agent has in view, for anybody following them.
   *
   * Sent on change *and* on a slow repeat. The repeat is what serves a follower who joined while the
   * driver was sitting still: nothing changes, so nothing would be sent, and they would stare at
   * wherever they happened to be until the driver moved.
   */
  | { kind: 'view'; frame: ViewFrame };

export type LiveMessage = LiveEnvelope & LiveBody;

/** How much precision a coordinate is worth on the wire. */
const WORLD_DP = 1;
const FRACTION_DP = 4;

const round = (value: number, dp: number) => {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
};

/**
 * Trim an anchor to what is worth sending.
 *
 * World units are rounded to a tenth of a unit and fractions to four places, which on a 2000px box is
 * a fifth of a pixel — finer than anybody can point. It is not really about bytes: rounding is what
 * makes "has this moved?" answerable, so a pointer jittering by a thousandth of a fraction stops
 * producing a message a frame.
 */
export function trimAnchor(at: LiveAnchor): LiveAnchor {
  const dp = at.kind === 'world' ? WORLD_DP : FRACTION_DP;
  return {
    surface: at.surface,
    kind: at.kind,
    x: round(at.x, dp),
    y: round(at.y, dp),
    ...(at.record ? { record: at.record } : {}),
  };
}

/** Whether two anchors are the same place, to the precision that travels. */
export function sameAnchor(a: LiveAnchor | null, b: LiveAnchor | null): boolean {
  if (!a || !b) return a === b;
  return a.surface === b.surface && a.kind === b.kind && a.x === b.x && a.y === b.y && a.record === b.record;
}

function isAnchor(value: unknown): value is LiveAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const at = value as Partial<LiveAnchor>;
  if (typeof at.surface !== 'string' || !at.surface) return false;
  if (at.kind !== 'world' && at.kind !== 'record' && at.kind !== 'viewport') return false;
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return false;
  // A record anchor without a record cannot be resolved, so it is malformed rather than partial.
  if (at.kind === 'record' && (typeof at.record !== 'string' || !at.record)) return false;
  if (at.record !== undefined && typeof at.record !== 'string') return false;
  return true;
}

function isFrame(value: unknown): value is ViewFrame {
  if (typeof value !== 'object' || value === null) return false;
  const frame = value as Partial<ViewFrame>;
  if (typeof frame.path !== 'string') return false;
  if (frame.surface !== undefined && typeof frame.surface !== 'string') return false;
  if (frame.region !== undefined) {
    const region = frame.region as Partial<NonNullable<ViewFrame['region']>>;
    if (typeof region !== 'object' || region === null) return false;
    if (![region.x, region.y, region.width, region.height].every((n) => Number.isFinite(n))) return false;
    // A zero-sized region frames a follower onto nothing; a negative one is inside out and the
    // camera's own arithmetic would answer with a rectangle nobody asked for.
    if (!(region.width! > 0) || !(region.height! > 0)) return false;
  }
  if (frame.anchor !== undefined) {
    const anchor = frame.anchor as Partial<NonNullable<ViewFrame['anchor']>>;
    if (typeof anchor !== 'object' || anchor === null) return false;
    if (typeof anchor.record !== 'string' || !anchor.record) return false;
    if (!Number.isFinite(anchor.offset)) return false;
  }
  return true;
}

/**
 * Narrow an untrusted payload off the transport.
 *
 * Everything here arrived from another agent, so every field is checked before it can reach a
 * coordinate. The sender's id is **not** in the payload and is never read from one: the transport
 * supplies it, and `EphemeralCapabilities.authenticatedSender` is what says whether even that can be
 * trusted. A self-reported id would let one peer draw a cursor wearing somebody else's name.
 */
export function parseLiveMessage(payload: unknown): LiveMessage | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const msg = payload as Partial<LiveMessage>;
  if (msg.v !== LIVE_PROTOCOL_VERSION) return null;
  if (!Number.isFinite(msg.seq)) return null;

  if (msg.kind === 'cursor') {
    const at = (msg as { at?: unknown }).at;
    if (at === null) return { v: msg.v, seq: msg.seq!, kind: 'cursor', at: null };
    if (!isAnchor(at)) return null;
    return { v: msg.v, seq: msg.seq!, kind: 'cursor', at: trimAnchor(at) };
  }

  if (msg.kind === 'view') {
    const frame = (msg as { frame?: unknown }).frame;
    if (!isFrame(frame)) return null;
    return { v: msg.v, seq: msg.seq!, kind: 'view', frame };
  }

  return null;
}

// ── Rates and expiry ─────────────────────────────────────────────────────────

/**
 * How long a cursor nobody has heard about stays on screen.
 *
 * **Deliberately shorter than a known stall, not longer.** coasys/ad4m#1133 measures telepresence
 * broadcasts queueing 12–21s behind unrelated zome calls on this transport, and the tempting reading is
 * that a TTL must outlast that so a cursor does not vanish mid-stall. The opposite is right: a cursor
 * twenty seconds behind is not a cursor, it is a claim about where somebody is pointing that is false.
 * Three seconds means a stall makes the feature visibly stop — everybody's cursor disappears, together,
 * and comes back when the transport does — which is honest, and self-explaining in a way that a smoothly
 * wrong position is not.
 *
 * So this is a *freshness* bound rather than a timeout. It is also short enough that somebody who closed
 * their laptop is gone before you try to talk to them. A deliberate `null` on leaving is the fast path;
 * this is the backstop.
 */
export const CURSOR_TTL_MS = 3_000;

/** How often a driver repeats their view even when it has not changed. See `LiveBody`. */
export const VIEW_REPEAT_MS = 2_000;

/**
 * How often to publish a moving pointer, given how many peers are listening.
 *
 * ## Why it is not one number
 *
 * Every publish is a broadcast, so the cost of one message is already proportional to the number of
 * peers — and on today's transport each one crosses the executor's RPC boundary and lands in reactive
 * state on every peer's main thread. A fixed twelve a second is comfortable in a call of three and is
 * three hundred messages a second through one executor in a call of twelve, which is the sort of load
 * that makes the *rest* of the app feel broken and gives no sign why.
 *
 * ## Why a ladder rather than a formula
 *
 * A smooth function of the peer count means the rate changes on every join, so a cursor's smoothness
 * is never quite the same twice and nobody can tell a busy space from a slow network. Three steps are
 * learnable: fine in a small call, visibly coarser in a large one, and the step where it changes is a
 * number somebody can be told.
 *
 * The values interact with the 90ms CSS transition that smooths them: at the top of the ladder the
 * gap is wider than the transition, so movement is drawn as short slides rather than as continuous
 * motion. That is the honest rendering of a coarse signal, and better than interpolating over a third
 * of a second, which shows everybody a cursor that is visibly behind where its owner is pointing.
 */
export function cursorIntervalMs(watchers: number): number {
  if (watchers <= 4) return 80;
  if (watchers <= 8) return 160;
  return 320;
}

/** A peer's cursor as this agent holds it. */
export interface HeldCursor {
  at: LiveAnchor;
  /** When it was last heard about, for the TTL. */
  at_ms: number;
  /** The highest `seq` seen from this sender, so a late duplicate cannot move them backwards. */
  seq: number;
  /** How long it had been since the position before this one — see {@link easeMsFor}. */
  gap_ms: number;
}

/**
 * The shortest and longest an eased cursor should take to cover one gap.
 *
 * The floor is there because a burst of positions arriving together must not each animate for longer
 * than the next one takes to arrive, or the cursor falls permanently behind its own data. The ceiling
 * is the more interesting one: a gap of several seconds is real, and easing across the whole of it
 * would leave the cursor seconds behind where the peer actually is, which is worse than being still.
 * Past the ceiling the honest drawing is a quick glide and then a wait.
 */
export const EASE_MIN_MS = 60;
export const EASE_MAX_MS = 400;

/**
 * How long to ease a cursor that arrived `gap` after the position before it.
 *
 * The whole point of easing a cursor is to cover the time until the next one, so the duration is a
 * measurement rather than a setting. The alternative, which this replaced, was a fixed duration chosen
 * for the rate the sender aims at: right when the transport keeps up and wrong the moment it does not,
 * when it draws a tenth of a second of movement followed by a second of stillness and reads as the
 * stutter the easing exists to remove.
 *
 * A first sighting has no gap to measure and gets the ceiling, so somebody's cursor arrives with a
 * glide rather than snapping into place.
 */
export function easeMsFor(gap: number): number {
  if (!Number.isFinite(gap) || gap <= 0) return EASE_MAX_MS;
  return Math.min(EASE_MAX_MS, Math.max(EASE_MIN_MS, Math.round(gap)));
}

/**
 * Whether a message is newer than what is already held.
 *
 * `>` rather than `>=`: a repeat of the same sequence carries the same position, so applying it
 * changes nothing except the timestamp — and refreshing the TTL from a duplicate would keep a cursor
 * alive on retransmissions alone.
 */
export function isNewer(held: { seq: number } | undefined, seq: number): boolean {
  return !held || seq > held.seq;
}

/** The cursors still worth drawing, and the ids that have expired. */
export function liveCursors(
  held: Map<string, HeldCursor>,
  now: number,
  ttl = CURSOR_TTL_MS,
): { live: Map<string, HeldCursor>; expired: string[] } {
  const live = new Map<string, HeldCursor>();
  const expired: string[] = [];
  for (const [did, cursor] of held) {
    if (now - cursor.at_ms > ttl) expired.push(did);
    else live.set(did, cursor);
  }
  return { live, expired };
}
