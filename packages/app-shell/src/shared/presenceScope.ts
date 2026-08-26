/**
 * Which spaces presence runs in, and how their peers combine into one list.
 *
 * Pure, and separate from `PresenceStore` for the reason `solveStrip` is separate from the call
 * stage: this is the part with rules in it, and the store cannot be driven through those rules
 * without a session, a dataset, a profile cache and a router behind it.
 *
 * The store owns the sources, the transport and the reactivity. This owns the three decisions:
 * which spaces are wanted, what that means for the sources currently running, and how their
 * separate views of the world become one.
 */
import type { Peer } from '@we/backend-shared';

/**
 * A ceiling on how many spaces presence may beat into at once — a tripwire, not a limit.
 *
 * Nothing should reach it. The wanted set is the space on screen plus the space you are calling in,
 * and starting a second call tears the first down before it begins, so two is the realistic maximum
 * and four is slack. Reaching it means an activity is being pinned and never cleared, which costs a
 * heartbeat per space per interval and would otherwise be entirely invisible.
 */
export const MAX_LEASES = 4;

/**
 * The spaces that need a presence source.
 *
 * The one on screen, plus wherever this agent is doing something live. Order matters on the way out:
 * the current space is first, so that if the ceiling is ever hit it is a *pinned* space that goes
 * unscoped rather than the one being looked at.
 *
 * `undefined` for the current space is ordinary — a personal space has no neighbourhood and so no
 * uri, and the app has none at all before the first switch.
 */
export function wantedUris(currentUri: string | undefined, activityUris: readonly string[]): string[] {
  const uris = new Set<string>();
  if (currentUri) uris.add(currentUri);
  for (const uri of activityUris) uris.add(uri);
  return [...uris];
}

export interface LeaseReconciliation {
  /** Spaces to open a source for, in priority order. */
  open: string[];
  /** Spaces whose source should stop. */
  close: string[];
  /** Wanted but refused because {@link MAX_LEASES} was reached. Worth saying out loud. */
  refused: string[];
}

/**
 * What to change about the running sources so they match the wanted set.
 *
 * A diff rather than "stop everything and start what is wanted", and that is the whole point of the
 * change this belongs to: stopping a source broadcasts a `bye` and drops its peers, so a space that
 * is wanted both before and after must be left strictly alone. Rebuilding it would tell a call's
 * peers that this agent had left and come back, mid-call, for no reason.
 */
export function reconcileLeases(running: readonly string[], wanted: readonly string[]): LeaseReconciliation {
  const want = new Set(wanted);
  const close = running.filter((uri) => !want.has(uri));

  const open: string[] = [];
  const refused: string[] = [];
  let budget = MAX_LEASES - (running.length - close.length);
  for (const uri of wanted) {
    if (running.includes(uri)) continue;
    if (budget > 0) {
      open.push(uri);
      budget -= 1;
    } else {
      refused.push(uri);
    }
  }

  return { open, close, refused };
}

/**
 * Every peer any source can see, as one list.
 *
 * Deduplicated by agent, because one person can be visible from two sources at once — they are in
 * the call you are in *and* in the space you have wandered into. Freshest beat wins: the two reports
 * are the same agent's state seen through different channels, so the later one is simply the more
 * current. Picking arbitrarily would make their liveness flicker as the maps iterate.
 */
export function unionPeers(peersByUri: Readonly<Record<string, readonly Peer[]>>): Peer[] {
  const byAgent = new Map<string, Peer>();
  for (const peers of Object.values(peersByUri)) {
    for (const peer of peers) {
      const seen = byAgent.get(peer.agentId);
      if (!seen || peer.updatedAt > seen.updatedAt) byAgent.set(peer.agentId, peer);
    }
  }
  return [...byAgent.values()];
}
