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
 *
 * ## Nothing settles while a write is still going
 *
 * Pressing a tick on, off and on again is three writes for one pair, and the first one's echo can
 * arrive while the third press is what is on screen. "The data moved" was then true of data the
 * person had already changed their mind about: the hold lifted, the card drew the first answer, and
 * the face blinked back and forward as the later writes came in. So a hold counts the writes behind
 * it, and is only judged against the rows once the last of them has returned — against a fresh
 * baseline, since whatever the rows said before that is the history of the earlier presses.
 */
import { createSignal } from 'solid-js';

import { relationId } from './involvements';
import type { InvolvementRowInput, PendingInvolvement } from './sources/involvement';

interface Held extends PendingInvolvement {
  /** Whether the pair read as present at the first draw after the write — absent until then. */
  before?: boolean;
  at: number;
  /**
   * Writes for this pair not yet finished. While any is, the hold stands whatever the rows say — see
   * "Nothing settles while a write is still going".
   */
  writing: number;
}

/** How long a hold may stand before it is disbelieved — see `PENDING_ORDER_TTL_MS`. */
export const PENDING_INVOLVEMENT_TTL_MS = 10_000;

const key = (node: string, agent: string, kind: string) => `${node}\u0000${agent}\u0000${kind}`;

const [held, setHeld] = createSignal<Record<string, Held>>({});

export const involvementOptimism = {
  /** What `createInvolvementActions` is given. */
  ports: {
    hold: (node: string, agent: string, kind: string, on: boolean) => {
      setHeld((all) => {
        const k = key(node, agent, kind);
        const writing = (all[k]?.writing ?? 0) + 1;
        return { ...all, [k]: { node, agent, kind, on, at: Date.now(), writing } };
      });
    },
    /** A write for the pair has returned. When it was the last, the rows are listened to again. */
    done: (node: string, agent: string, kind: string) =>
      setHeld((all) => {
        const k = key(node, agent, kind);
        const entry = all[k];
        if (!entry) return all;
        const writing = Math.max(0, entry.writing - 1);
        return { ...all, [k]: { ...entry, writing, before: writing ? entry.before : undefined } };
      }),
    /** A write failed. The hold goes with it — unless a later press is still on its way. */
    release: (node: string, agent: string, kind: string) =>
      setHeld((all) => {
        const k = key(node, agent, kind);
        const entry = all[k];
        if (!entry) return all;
        if (entry.writing > 1) return { ...all, [k]: { ...entry, writing: entry.writing - 1 } };
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
        if (entry.writing > 0 && now - entry.at <= PENDING_INVOLVEMENT_TTL_MS) {
          next[k] = entry;
          continue;
        }
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

  /**
   * Report the rows a surface drew from — `settle`, for the shape every surface has.
   *
   * **A surface with no rows reports nothing.** Several surfaces draw involvements at once — the
   * board's cards, the inspector's People — and one that has just mounted holds an empty list until
   * its query answers. Read as data, that empty list says every held pair is absent: an *off* hold
   * reads as already agreed with, and an *on* hold as overtaken, so either is released and the card
   * falls back to rows that do not have the write in them yet. Taking yourself off a card put you
   * back on it for as long as the round trip took, and whichever way the next push landed decided
   * whether you stayed there.
   *
   * The cost is a space with no involvements at all, where an *off* hold has nothing to agree with
   * until one exists. The hold then stands until its TTL, drawing what was written, which is also
   * what the data says.
   */
  settleFromRows(rows: unknown): void {
    if (!Array.isArray(rows) || !rows.length) return;
    const present = new Set(
      (rows as InvolvementRowInput[]).map((row) => key(relationId(row?.node), row?.agent ?? '', row?.kind ?? '')),
    );
    involvementOptimism.settle((node, agent, kind) => present.has(key(node, agent, kind)));
  },

  /** Forget everything — for a change of space, where a hold is a promise about records nobody is showing. */
  reset: () => setHeld({}),
};
