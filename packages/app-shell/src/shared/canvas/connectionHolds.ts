/**
 * Connections written and not yet seen: what each hold draws, and what it waits to see.
 *
 * The record store holds a connection change in `@we/optimism` under a key, and keeps the change itself
 * beside it — the optimism package holds one comparable value per key, and a line needs its two ends to
 * be drawn at all. These are the rules for turning those holds into what the graph draws ahead of the
 * data, and for reading what the graph reports drawing back as the value each hold waits for.
 */
import { DEFAULT_TTL_MS, type Holds, keyOf } from '@we/optimism';

/**
 * One change held ahead of the data, in record ids.
 *
 * - **added** — a line between two records. Waits for the connection's own id to appear, which it
 *   learns when the create returns; until then there is nothing to recognise it by, and the write is
 *   still in flight anyway, so the hold stands regardless.
 * - **moved** — one end re-attached. Waits for the connection to say the new end.
 * - **removed** — a connection being deleted. Waits for it to be gone.
 */
export type ConnectionHold =
  | { kind: 'added'; source: string; target: string; id?: string; data?: Record<string, string> }
  | { kind: 'moved'; id: string; end: 'source' | 'target'; to: string }
  | { kind: 'removed'; id: string };

/** Connections held ahead of the data, as the graph draws them. Record ids throughout. */
export interface PendingConnectionWrites {
  added: { key: string; source: string; target: string; data?: Record<string, string> }[];
  moved: { id: string; end: 'source' | 'target'; to: string }[];
  removed: string[];
}

/** A connection the graph is drawing from its own data. */
export interface DrawnConnection {
  id: string;
  source: string;
  target: string;
}

/**
 * The key a change is held under, and the value it holds. An added line has no id to key by yet, so it
 * takes the next `serial`; a moved end is keyed by the connection and the end, so moving it again
 * replaces the hold rather than stacking a second.
 */
export function connectionHoldKey(change: ConnectionHold, serial: number): { key: string; value: string | number } {
  if (change.kind === 'added') return { key: keyOf('added', String(serial)), value: 1 };
  if (change.kind === 'moved') return { key: keyOf('moved', change.id, change.end), value: change.to };
  return { key: keyOf('removed', change.id), value: 0 };
}

/** What the holds draw, leaving out any past the backstop at `now`. */
export function pendingConnectionsOf(
  holds: Holds<string | number>,
  changes: ReadonlyMap<string, ConnectionHold>,
  now: number,
): PendingConnectionWrites {
  const out: PendingConnectionWrites = { added: [], moved: [], removed: [] };
  for (const [key, entry] of Object.entries(holds)) {
    const change = changes.get(key);
    if (!change || now - entry.at > DEFAULT_TTL_MS) continue;
    if (change.kind === 'added') {
      out.added.push({
        key,
        source: change.source,
        target: change.target,
        ...(change.data ? { data: change.data } : {}),
      });
    } else if (change.kind === 'moved') {
      out.moved.push({ id: change.id, end: change.end, to: change.to });
    } else {
      out.removed.push(change.id);
    }
  }
  return out;
}

/**
 * What the graph's drawing says about one held change, in the value it was held as — or undefined when
 * the drawing cannot say yet (a line whose id has not come back, a key with no change beside it).
 */
export function observedConnection(
  change: ConnectionHold | undefined,
  drawn: ReadonlyMap<string, DrawnConnection>,
): string | number | undefined {
  if (!change) return undefined;
  if (change.kind === 'added') return change.id ? (drawn.has(change.id) ? 1 : 0) : undefined;
  if (change.kind === 'removed') return drawn.has(change.id) ? 1 : 0;
  return drawn.get(change.id)?.[change.end];
}
