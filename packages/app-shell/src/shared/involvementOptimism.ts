/**
 * Involvements that have been written and not yet seen come back.
 *
 * Ticking a member in an assign menu, or pressing Going, writes a record and then waits for the
 * subscription to carry it back — about a second, during which the tick is gone and the button
 * reads as though nothing happened. So the answer somebody gave is held here and drawn at once.
 *
 * The same arrangement `boardOptimism` has with the board, and a module singleton for its reason:
 * this is wiring between a write and the read that supersedes it, not something a template has any
 * use for, and so not a store member it would be able to name.
 *
 * ## Settling on the data moving, not on it agreeing
 *
 * `shapes/pendingOrder` records why, and it holds here in miniature. "Hold until the pair reads as I
 * wrote it" can hang: somebody else can take the assignment back off in the same second, and then
 * the data never agrees. What is wanted is *has an answer arrived that is later than my write*, and
 * the presence the pair had at the first draw after the write answers it — the moment that changes,
 * or the data already says what was written, the hold has been overtaken.
 *
 * Released explicitly only when a write **fails**. Releasing on success would put the old answer
 * back for the rest of the round trip.
 */
import { createSignal } from 'solid-js';

import type { PendingInvolvement } from './sources/involvement';

interface Held extends PendingInvolvement {
  /** Whether the pair read as present at the first draw after the write — absent until then. */
  before?: boolean;
  at: number;
}

/** How long a hold may stand before it is disbelieved — see `PENDING_ORDER_TTL_MS`. */
export const PENDING_INVOLVEMENT_TTL_MS = 10_000;

const key = (node: string, agent: string, kind: string) => `${node}\u0000${agent}\u0000${kind}`;

const [held, setHeld] = createSignal<Record<string, Held>>({});

export const involvementOptimism = {
  /** What `createInvolvementActions` is given. */
  ports: {
    hold: (node: string, agent: string, kind: string, on: boolean) =>
      setHeld((all) => ({ ...all, [key(node, agent, kind)]: { node, agent, kind, on, at: Date.now() } })),
    release: (node: string, agent: string, kind: string) =>
      setHeld((all) => {
        const k = key(node, agent, kind);
        if (!(k in all)) return all;
        const { [k]: _gone, ...rest } = all;
        return rest;
      }),
  },

  /** The holds, in the shape `involvement` and `arrangedBoard` take. Reading it makes their memos redraw on a click. */
  overlay: (): PendingInvolvement[] => Object.values(held()),

  /**
   * Report what the drawn rows say about each held pair, and forget what they have overtaken.
   *
   * Called by whatever just drew, deferred to a microtask by its caller — this writes a signal, and a
   * write during a render is a re-entrancy bug waiting to happen.
   */
  settle(observed: (node: string, agent: string, kind: string) => boolean): void {
    setHeld((all) => {
      let changed = false;
      const now = Date.now();
      const next: Record<string, Held> = {};
      for (const [k, entry] of Object.entries(all)) {
        const present = observed(entry.node, entry.agent, entry.kind);
        if (entry.before === undefined) {
          // The first draw after the write: this is the baseline, unless it already says what was
          // written — which is a write that changed nothing, or one that landed very fast.
          if (present === entry.on) {
            changed = true;
            continue;
          }
          next[k] = { ...entry, before: present };
          changed = true;
          continue;
        }
        if (present !== entry.before || present === entry.on || now - entry.at > PENDING_INVOLVEMENT_TTL_MS) {
          changed = true;
          continue;
        }
        next[k] = entry;
      }
      return changed ? next : all;
    });
  },

  /** Forget everything — for a change of space, where a hold is a promise about records nobody is showing. */
  reset: () => setHeld({}),
};
