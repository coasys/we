/**
 * Reactions given and not yet seen come back.
 *
 * Pressing a heart, or moving a rating from three stars to four, writes a record and then waits for
 * the subscription to carry it back. Against a real node that is about a second, and the executor's
 * own subscription loop debounces for 250ms before it will even look — so a reaction is the worst
 * case there is for a press-and-see control: the glyph stays unfilled, the count stays put, and the
 * press reads as having failed.
 *
 * `@we/optimism` holds the rules; this holds the state, and is a module singleton for the reason
 * `boardOptimism` is — it is wiring between a write and the read that supersedes it, not something a
 * template has any use for.
 *
 * ## The value held is the agent's own reaction, and zero means withdrawn
 *
 * A signal is one agent's record on one node for one type, so the held value is a number and the
 * absence of one is a zero. That matches `upsertSignal`, where a zero deletes rather than storing a
 * nought, so nothing downstream has to know the difference: the overlay either puts this agent's
 * reaction into the list or takes it out.
 *
 * ## Why the list rather than the count
 *
 * Everything a reaction surface draws comes off the same list — `signalTally` reads it for the
 * number, `CountMark` reads it for whether the reaction is yours, and `SignalControl` reads it for
 * which star to fill. Overlaying the *list* means all three agree by construction. Overlaying the
 * count instead would have left the heart unfilled beside a number that had moved, which reads as
 * somebody else's reaction arriving rather than as your own registering.
 */
import { createOptimism, keyOf, sameValue } from '@we/optimism';
import { createSignal } from 'solid-js';

/** One reaction held: which record, which type, and what this agent's value for it now is. */
export interface PendingSignal {
  record: string;
  type: string;
  /** The value written. `0` is a withdrawal, which is how `upsertSignal` spells one. */
  value: number;
}

const optimism = createOptimism<number>(createSignal, { same: sameValue });

const key = (record: string, type: string) => keyOf(record, type);
const parts = (k: string): [string, string] => k.split('\u0000') as [string, string];

export const signalOptimism = {
  /** Note a reaction going out — `0` for a withdrawal. */
  hold: (record: string, type: string, value: number) => optimism.hold(key(record, type), value),
  /** The write returned. Not a release — what retires a hold is the data moving. */
  done: (record: string, type: string) => optimism.done(key(record, type)),
  /** The write failed, so what is on screen is a lie. */
  release: (record: string, type: string) => optimism.release(key(record, type)),

  /** Everything held, in the shape the `reactions` source takes. */
  overlay: (): PendingSignal[] =>
    Object.entries(optimism.holds()).map(([k, entry]) => {
      const [record, type] = parts(k);
      return { record, type, value: entry.value };
    }),

  /**
   * Report what one record's stored reactions say about the holds on it.
   *
   * **A record whose reactions have not arrived reports nothing.** An absent or empty list read as
   * data says this agent has not reacted — so a hold for a *withdrawal* reads as already agreed
   * with and one for a reaction reads as overtaken, and either way the mark falls back to rows that
   * do not have the write in them yet. The same rule `involvementOptimism.settleFromRows` records,
   * and the same cost: on a record nobody has reacted to, a withdrawal stands until the backstop,
   * drawing what was written, which is also what the data says.
   */
  settleFromSignals(record: string, me: string, signals: unknown): void {
    if (!record || !me || !Array.isArray(signals) || !signals.length) return;
    const mine = new Map<string, number>();
    for (const row of signals as { author?: unknown; signalTypeId?: unknown; value?: unknown }[]) {
      if (row?.author !== me || typeof row.signalTypeId !== 'string') continue;
      mine.set(row.signalTypeId, typeof row.value === 'number' ? row.value : 0);
    }
    optimism.settle((k) => {
      const [held, type] = parts(k);
      // Only about the record that was drawn — another record's holds are not this list's business.
      return held === record ? (mine.get(type) ?? 0) : undefined;
    });
  },

  /** Forget everything — for a change of space, where a hold is about records nobody is showing. */
  reset: () => optimism.reset(),
};
