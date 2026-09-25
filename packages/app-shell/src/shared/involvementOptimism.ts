/**
 * Involvements that have been written and not yet seen come back.
 *
 * Ticking a member in an assign menu, or pressing Going, writes a record and then waits for the
 * subscription to carry it back — about a second, during which the tick is gone and the button
 * reads as though nothing happened. So the answer somebody gave is held here and drawn at once.
 *
 * `@we/optimism` holds the rules; this holds the state, and is a module singleton for the reason
 * `boardOptimism` is: this is wiring between a write and the read that supersedes it, not something
 * a template has any use for, and so not a store member it would be able to name.
 *
 * The value held is whether the pair is *present* — an involvement is a record that exists or does
 * not, so a boolean is the whole of it. Everything else about the rules is the same as the board's,
 * which is what made this the fourth implementation worth stopping to unify.
 */
import { createOptimism, keyOf, sameValue } from '@we/optimism';
import { createSignal } from 'solid-js';

import { relationId } from './involvements';
import type { InvolvementRowInput, PendingInvolvement } from './sources/involvement';

const optimism = createOptimism<boolean>(createSignal, { same: sameValue });

/** Node, agent and kind — joined on NUL, which cannot appear in any of the three. */
const key = (node: string, agent: string, kind: string) => keyOf(node, agent, kind);

/** The three parts back out of a key, for a `settle` that reports per pair. */
const parts = (k: string): [string, string, string] => k.split('\u0000') as [string, string, string];

export const involvementOptimism = {
  /** What `createInvolvementActions` is given. */
  ports: {
    hold: (node: string, agent: string, kind: string, on: boolean) => optimism.hold(key(node, agent, kind), on),
    /** A write for the pair has returned. When it was the last, the rows are listened to again. */
    done: (node: string, agent: string, kind: string) => optimism.done(key(node, agent, kind)),
    /** A write failed. The hold goes with it — unless a later press is still on its way. */
    release: (node: string, agent: string, kind: string) => optimism.release(key(node, agent, kind)),
  },

  /**
   * The holds, in the shape `involvement` and `arrangedBoard` take.
   *
   * Reading it makes their memos redraw on a click. Every held pair is listed, whether or not the
   * data has caught up — `settle` is what removes one, and it is the *drawing* that proves an
   * overlay is spent.
   */
  overlay: (): PendingInvolvement[] =>
    Object.entries(optimism.holds()).map(([k, entry]) => {
      const [node, agent, kind] = parts(k);
      return { node, agent, kind, on: entry.value };
    }),

  /**
   * Report what the drawn rows say about each held pair, and forget what they have overtaken.
   *
   * Called by whatever just drew, deferred to a microtask by its caller — this writes a signal, and a
   * write during a render is a re-entrancy bug waiting to happen.
   */
  settle(observed: (node: string, agent: string, kind: string) => boolean): void {
    optimism.settle((k) => observed(...parts(k)));
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
   * until one exists. The hold then stands until its backstop, drawing what was written, which is
   * also what the data says.
   */
  settleFromRows(rows: unknown): void {
    if (!Array.isArray(rows) || !rows.length) return;
    const present = new Set(
      (rows as InvolvementRowInput[]).map((row) => key(relationId(row?.node), row?.agent ?? '', row?.kind ?? '')),
    );
    involvementOptimism.settle((node, agent, kind) => present.has(key(node, agent, kind)));
  },

  /** Forget everything — for a change of space, where a hold is a promise about records nobody is showing. */
  reset: () => optimism.reset(),
};
