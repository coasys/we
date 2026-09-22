/*
  From `@we/components/signals`, not `/solid`: the aggregate rules carry no Solid, and importing
  them through the component barrel pulled a client-only API into a module the node tests load
  without a document.
*/
import { tallyEverything, tallySignals } from '@we/components/signals';

/**
 * What a record's reactions say, as one number.
 *
 * ## Why the host lends this
 *
 * How a type's signals read as one number is not a style choice — it is the type's own declaration
 * and a set of rules about which aggregates a mode can express. A toggle counts, a vote nets out, a
 * rating averages; a `median` a community asked for is honoured; a `count` on a rating is refused,
 * because a rating drawn as a headcount is a number of voters where the stars say a score.
 *
 * All of that lived inside `SignalControl`, which meant the only way for a surface to get the
 * number was to mount the control. That is the constraint that produces a second copy of the
 * drawing: a board cell that wants "3.4" has no way to ask, so somebody writes their own averaging
 * in a template and it disagrees with the control the first time a community sets an aggregate.
 *
 * With it lent here, a mark and its count are an expression, the compact and total displays are
 * arrangement rather than components, and there is one definition of what the number means.
 *
 * ## Two questions, one function
 *
 * With a `type`, it answers for that type. Without one, it answers **how many people reacted at
 * all** — records, never values. "Twelve" summing seven likes, three stars and two downvotes is not
 * a number; "twelve people reacted" is, and it is the only honest thing one mark standing for a
 * whole vocabulary can say.
 *
 * Retired types count toward that total, which is a decision: somebody reacted, and a number that
 * fell when a community tidied its vocabulary would be reporting the tidying.
 *
 * Total, like every function an expression can call — anything that is not a list of signals
 * answers 0 rather than throwing.
 */
export function signalTally(options: unknown): number {
  const { signals, type } = (options ?? {}) as { signals?: unknown; type?: unknown };
  if (!Array.isArray(signals)) return 0;
  const rows = signals.filter(
    (s) => s && typeof s === 'object' && typeof (s as { value?: unknown }).value === 'number',
  );
  if (!type || typeof type !== 'object' || typeof (type as { mode?: unknown }).mode !== 'string') {
    return tallyEverything(rows as never);
  }
  return tallySignals(type as never, rows as never);
}

/**
 * A record's reactions with this agent's own newest answer in place, whether or not it has been read
 * back yet.
 *
 * The overlay every reaction surface draws through. A reaction is a press-and-see control, and the
 * write it makes is answered by a subscription a second later — so without this the glyph stays
 * unfilled, the count stays put, and the press reads as having failed. `signalOptimism` holds what
 * was written; this is where the holds meet the list.
 *
 * The **list**, rather than the count, because everything a surface draws comes off it: the tally
 * reads it for the number, the mark reads it for whether the reaction is yours, and the control
 * reads it for which star to fill. Overlaying the list is what makes all three agree by
 * construction — overlay the count alone and the heart sits unfilled beside a number that moved,
 * which reads as somebody else's reaction arriving rather than as your own registering.
 *
 * Returns the **same array** when nothing is held for this record and type, which is the ordinary
 * case on every frame: a fresh array per call would defeat every identity check downstream and
 * re-render each mark on every push.
 *
 * Total, like every function an expression can call.
 */
export function reactions(options: unknown): unknown[] {
  const { signals, record, type, me, pending } = (options ?? {}) as {
    signals?: unknown;
    record?: unknown;
    type?: unknown;
    me?: unknown;
    pending?: unknown;
  };
  const rows = Array.isArray(signals) ? signals : [];
  if (!Array.isArray(pending) || typeof record !== 'string' || typeof type !== 'string' || typeof me !== 'string') {
    return rows;
  }
  const held = (pending as { record?: unknown; type?: unknown; value?: unknown }[]).find(
    (entry) => entry?.record === record && entry?.type === type,
  );
  // `null` is a held WITHDRAWAL and has to reach the branch below; only an entry holding neither a
  // number nor a withdrawal is nothing to apply.
  if (!held || (typeof held.value !== 'number' && held.value !== null)) return rows;

  // This agent's stored reaction of this type goes, whatever it says — the held one stands in for
  // it, so changing a rating does not count twice and withdrawing one does not leave it behind.
  const others = rows.filter((row) => (row as { author?: unknown } | null)?.author !== me);
  // A withdrawal is `null`, not a zero: a zero is an ordinary reaction and is put back like any
  // other. See `upsertSignal` for why the two stopped being the same thing.
  return held.value === null ? others : [...others, { author: me, signalTypeId: type, value: held.value }];
}
